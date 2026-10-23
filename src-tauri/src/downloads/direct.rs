//! Bounded async HTTP transfers with a durable map of completed byte ranges.
use crate::database::{error, Result};
use reqwest::{header, Client, Response, StatusCode, Url};
use serde::{Deserialize, Serialize};
use std::{path::{Path, PathBuf}, sync::{Arc, atomic::{AtomicU64, Ordering}}, time::{Duration, Instant}};
use tokio::{fs::{File, OpenOptions}, io::{AsyncSeekExt, AsyncWriteExt, BufWriter}, sync::Semaphore, task::JoinSet};
use tokio_util::sync::CancellationToken;

const BLOCK_BYTES: u64 = 8 * 1024 * 1024;
const CONNECTIONS: usize = 16;
const ATTEMPTS: u32 = 4;
const REPORT_INTERVAL: Duration = Duration::from_millis(750);
// Bound bookkeeping, not game size. Very large files use larger byte ranges;
// each connection still streams through a fixed 1 MiB writer buffer.
const MAX_RESUME_BLOCKS: u64 = 16_384;
const MAX_RESUME_BYTES: u64 = 256 * 1024;

pub fn client() -> Result<Client> {
    client_with_headers(header::HeaderMap::new())
}
/// Headers such as Authorization are dropped by reqwest on redirects to another host.
pub fn client_with_headers(headers: header::HeaderMap) -> Result<Client> {
    Client::builder()
        .default_headers(headers)
        .user_agent(concat!("OpenRetro/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(30))
        .pool_max_idle_per_host(CONNECTIONS)
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || super::sources::direct_url(attempt.url().as_str()).is_err() { attempt.stop() } else { attempt.follow() }
        }))
        .build().map_err(error)
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct Resume {
    version: u8,
    source: String,
    total: u64,
    validator: String,
    block_bytes: u64,
    done: Vec<bool>,
}
impl Resume {
    fn new(source: String, total: u64, validator: String, block_bytes: u64) -> Self {
        let block_bytes = block_bytes.max(1).max(total.div_ceil(MAX_RESUME_BLOCKS));
        Self { version: 1, source, total, validator, block_bytes,
            done: vec![false; total.div_ceil(block_bytes) as usize] }
    }
    fn span(&self, index: usize) -> (u64, u64) {
        let start = index as u64 * self.block_bytes;
        (start, start.saturating_add(self.block_bytes).min(self.total))
    }
    fn completed_bytes(&self) -> u64 {
        self.done.iter().enumerate().filter(|(_, done)| **done).map(|(i, _)| { let (start, end) = self.span(i); end - start }).sum()
    }
    fn compatible(&self, other: &Self) -> bool {
        self.version == other.version && self.source == other.source && self.total == other.total && self.validator == other.validator && self.block_bytes == other.block_bytes && self.done.len() == other.done.len()
    }
}
fn validator(response: &Response) -> Option<String> {
    response.headers().get(header::ETAG).and_then(|v| v.to_str().ok()).filter(|v| v.starts_with('"') && v.ends_with('"')).or_else(|| response.headers().get(header::LAST_MODIFIED).and_then(|v| v.to_str().ok())).map(String::from)
}
fn content_range(response: &Response) -> Option<(u64, u64, u64)> {
    let value = response.headers().get(header::CONTENT_RANGE)?.to_str().ok()?.strip_prefix("bytes ")?;
    let (span, total) = value.split_once('/')?;
    let (start, end) = span.split_once('-')?;
    Some((start.parse().ok()?, end.parse().ok()?, total.parse().ok()?))
}
fn identity(response: &Response) -> bool {
    response.headers().get(header::CONTENT_ENCODING).is_none_or(|v| v.as_bytes().eq_ignore_ascii_case(b"identity"))
}
async fn checkpoint(part: &Path, state_path: &Path, state: &Resume) -> Result<()> {
    // Persist payload before its completion bits. A crash can repeat a block, never skip unwritten data.
    OpenOptions::new().write(true).open(part).await.map_err(error)?.sync_data().await.map_err(error)?;
    let temporary = state_path.with_extension("json.tmp");
    let mut output = File::create(&temporary).await.map_err(error)?;
    output.write_all(&serde_json::to_vec(state).map_err(error)?).await.map_err(error)?;
    output.sync_all().await.map_err(error)?;
    drop(output);
    tokio::fs::rename(&temporary, state_path).await.map_err(error)
}
async fn restore(part: &Path, state_path: &Path, expected: Resume) -> Result<Resume> {
    if tokio::fs::metadata(part).await.is_ok_and(|m| m.len() == expected.total)
        && tokio::fs::metadata(state_path).await.is_ok_and(|m| m.len() < MAX_RESUME_BYTES) {
        if let Ok(bytes) = tokio::fs::read(state_path).await {
            if let Ok(saved) = serde_json::from_slice::<Resume>(&bytes) {
                if saved.compatible(&expected) { return Ok(saved); }
            }
        }
    }
    let output = File::create(part).await.map_err(error)?;
    output.set_len(expected.total).await.map_err(error)?;
    drop(output);
    // Overwrite any stale map before new data can be treated as resumable.
    checkpoint(part, state_path, &expected).await?;
    Ok(expected)
}

/// Returns None when paused/cancelled. No transfer-wide timeout: only stalled reads expire.
pub async fn download(
    client: &Client, url: &Url, directory: &Path, slots: Arc<Semaphore>, cancel: &CancellationToken,
    report: impl FnMut(u64, u64) -> Result<()>,
) -> Result<Option<PathBuf>> {
    download_with_options(client, url, directory, slots, cancel, BLOCK_BYTES, CONNECTIONS, report).await
}
async fn download_with_options(
    client: &Client, url: &Url, directory: &Path, slots: Arc<Semaphore>, cancel: &CancellationToken,
    block_bytes: u64, connections: usize, mut report: impl FnMut(u64, u64) -> Result<()>,
) -> Result<Option<PathBuf>> {
    let permit = tokio::select! { _ = cancel.cancelled() => return Ok(None), p = slots.clone().acquire_owned() => p.map_err(error)? };
    // Probe ranges even when Accept-Ranges is omitted. A 200 body becomes the sequential transfer.
    let response = tokio::select! {
        _ = cancel.cancelled() => return Ok(None),
        r = client.get(url.clone()).header(header::ACCEPT_ENCODING, "identity").header(header::RANGE, "bytes=0-0").send() => r.map_err(|_| "Não foi possível iniciar o download. Verifique o link e sua conexão.")?
    };
    if !identity(&response) { return Err("O servidor retornou uma codificação incompatível com o download.".into()); }
    let range = content_range(&response);
    let range_total = match (response.status(), range) {
        (StatusCode::PARTIAL_CONTENT, Some((0, 0, total))) if total > 0 => Some(total),
        (StatusCode::OK, _) => None,
        _ => return Err(format!("O servidor recusou o download ({}).", response.status())),
    };
    let requested = super::direct_filename(url);
    let is_archive = requested.rsplit_once('.').is_some_and(|(_, ext)| matches!(ext.to_ascii_lowercase().as_str(), "zip" | "7z" | "rar"));
    let name = if is_archive { requested } else { super::response_filename(response.headers()).unwrap_or(requested) };
    let target = directory.join(&name);
    let part = directory.join(format!("{name}.part"));
    let state_path = directory.join(format!("{name}.resume.json"));
    let tag = validator(&response);
    if let (Some(total), Some(tag)) = (range_total, tag) {
        let final_url = response.url().clone();
        drop(response);
        drop(permit);
        let state = Resume::new(super::sources::download_key(url.as_str()), total, tag, block_bytes);
        let state = restore(&part, &state_path, state).await?;
        if !ranges(client, &final_url, &part, &state_path, state, slots, cancel, connections, &mut report).await? { return Ok(None); }
    } else {
        // Without a validator, ranges could combine different revisions. Stream one representation.
        let response = if range_total.is_some() {
            drop(response);
            tokio::select! { _ = cancel.cancelled() => return Ok(None), r = client.get(url.clone()).header(header::ACCEPT_ENCODING, "identity").send() => r.map_err(error)? }
        } else { response };
        if response.status() != StatusCode::OK || !identity(&response) { return Err("O servidor não retornou o arquivo completo.".into()); }
        if !sequential(response, &part, cancel, &mut report).await? { return Ok(None); }
        drop(permit);
    }
    tokio::fs::rename(&part, &target).await.map_err(error)?;
    let _ = tokio::fs::remove_file(state_path).await;
    Ok(Some(target))
}
async fn sequential(mut response: Response, part: &Path, cancel: &CancellationToken, report: &mut impl FnMut(u64, u64) -> Result<()>) -> Result<bool> {
    let total = response.content_length().unwrap_or(0);
    let mut output = BufWriter::with_capacity(1024 * 1024, File::create(part).await.map_err(error)?);
    let mut downloaded = 0u64;
    let mut saved = Instant::now();
    report(0, total)?;
    loop {
        let chunk = tokio::select! { _ = cancel.cancelled() => { output.flush().await.map_err(error)?; report(downloaded, total)?; return Ok(false); }, r = response.chunk() => r.map_err(|_| "O download foi interrompido pela conexão.")? };
        let Some(chunk) = chunk else { break };
        downloaded = downloaded.checked_add(chunk.len() as u64).ok_or("O tamanho informado pelo servidor é inválido.")?;
        output.write_all(&chunk).await.map_err(error)?;
        if saved.elapsed() >= REPORT_INTERVAL { report(downloaded, total)?; saved = Instant::now(); }
    }
    if total != 0 && downloaded != total { return Err("O download terminou antes de receber todo o arquivo.".into()); }
    output.flush().await.map_err(error)?;
    report(downloaded, downloaded)?;
    Ok(true)
}
async fn ranges(client: &Client, url: &Url, part: &Path, state_path: &Path, mut state: Resume, slots: Arc<Semaphore>, cancel: &CancellationToken, connections: usize, report: &mut impl FnMut(u64, u64) -> Result<()>) -> Result<bool> {
    let downloaded = Arc::new(AtomicU64::new(state.completed_bytes()));
    report(downloaded.load(Ordering::Relaxed), state.total)?;
    let pending: Vec<_> = state.done.iter().enumerate().filter(|(_, done)| !**done).map(|(i, _)| i).collect();
    let mut pending = pending.into_iter();
    let abort = cancel.child_token();
    let mut workers = JoinSet::new();
    let mut failure = None;
    let mut saved = Instant::now();
    let mut ticker = tokio::time::interval(REPORT_INTERVAL);
    loop {
        while workers.len() < connections && !abort.is_cancelled() {
            let Some(index) = pending.next() else { break };
            let (client, url, part, slots, abort, downloaded) = (client.clone(), url.clone(), part.to_path_buf(), slots.clone(), abort.clone(), downloaded.clone());
            let (start, end) = state.span(index);
            let (total, tag) = (state.total, state.validator.clone());
            workers.spawn(async move { (index, fetch_block(&client, &url, &part, start, end, total, &tag, slots, &abort, &downloaded).await) });
        }
        if workers.is_empty() { break; }
        tokio::select! {
            joined = workers.join_next() => match joined {
                Some(Ok((index, Ok(true)))) => state.done[index] = true,
                Some(Ok((_, Ok(false)))) => {},
                Some(Ok((_, Err(message)))) => { failure.get_or_insert(message); abort.cancel(); },
                Some(Err(err)) => { failure.get_or_insert(err.to_string()); abort.cancel(); },
                None => {}
            },
            _ = ticker.tick() => {
                if let Err(err) = report(downloaded.load(Ordering::Relaxed), state.total) { failure.get_or_insert(err); abort.cancel(); }
                if saved.elapsed() >= Duration::from_secs(2) {
                    if let Err(err) = checkpoint(part, state_path, &state).await { failure.get_or_insert(err); abort.cancel(); }
                    saved = Instant::now();
                }
            }
        }
    }
    checkpoint(part, state_path, &state).await?;
    // Only completed blocks survive a pause; don't display uncheckpointed bytes as resumable.
    report(state.completed_bytes(), state.total)?;
    if let Some(message) = failure { return Err(message); }
    Ok(!cancel.is_cancelled() && state.done.iter().all(|done| *done))
}
async fn fetch_block(client: &Client, url: &Url, path: &Path, start: u64, end: u64, total: u64, tag: &str, slots: Arc<Semaphore>, cancel: &CancellationToken, downloaded: &AtomicU64) -> Result<bool> {
    let mut file = OpenOptions::new().write(true).open(path).await.map_err(error)?;
    file.seek(std::io::SeekFrom::Start(start)).await.map_err(error)?;
    let mut output = BufWriter::with_capacity(1024 * 1024, file);
    let mut position = start;
    for attempt in 0..ATTEMPTS {
        if attempt > 0 {
            tokio::select! { _ = cancel.cancelled() => return Ok(false), _ = tokio::time::sleep(Duration::from_millis(250 * (1 << attempt))) => {} }
        }
        let _permit = tokio::select! { _ = cancel.cancelled() => return Ok(false), p = slots.clone().acquire_owned() => p.map_err(error)? };
        let response = tokio::select! {
            _ = cancel.cancelled() => return Ok(false),
            r = client.get(url.clone()).header(header::ACCEPT_ENCODING, "identity").header(header::RANGE, format!("bytes={position}-{}", end - 1)).header(header::IF_RANGE, tag).send() => r
        };
        let mut response = match response {
            Ok(r) if r.status() == StatusCode::TOO_MANY_REQUESTS || r.status().is_server_error() => continue,
            Ok(r) => r,
            Err(_) => continue,
        };
        if response.status() != StatusCode::PARTIAL_CONTENT || content_range(&response) != Some((position, end - 1, total)) || !identity(&response) || validator(&response).is_some_and(|current| current != tag) {
            return Err("O arquivo mudou no servidor ou ele não aceitou a retomada. Tente novamente.".into());
        }
        loop {
            let chunk = tokio::select! { _ = cancel.cancelled() => return Ok(false), r = response.chunk() => r };
            let chunk = match chunk { Ok(Some(chunk)) => chunk, _ => break };
            if chunk.len() as u64 > end - position { return Err("O servidor retornou um bloco de tamanho incorreto.".into()); }
            output.write_all(&chunk).await.map_err(error)?;
            position += chunk.len() as u64;
            downloaded.fetch_add(chunk.len() as u64, Ordering::Relaxed);
            if position == end { output.flush().await.map_err(error)?; return Ok(true); }
        }
    }
    Err("Não foi possível completar o bloco após quatro tentativas. Retome o download para continuar.".into())
}

#[cfg(test)]
mod tests;
