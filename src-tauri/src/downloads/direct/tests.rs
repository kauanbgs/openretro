use super::*;
use std::sync::atomic::AtomicUsize;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpListener,
};

/// How the local test server behaves.
#[derive(Clone, Copy)]
struct Serve {
    ranges: bool,
    /// The ETag changes after this many requests, as if the file was replaced.
    change_after: Option<usize>,
    /// Wait before answering, so progress reports arrive mid-transfer.
    delay_ms: u64,
}

/// A minimal HTTP/1.1 server for one file, honouring single byte ranges.
async fn server(body: Arc<Vec<u8>>, serve: Serve) -> (Url, Arc<AtomicUsize>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = Url::parse(&format!("http://{}/game.bin", listener.local_addr().unwrap())).unwrap();
    let requests = Arc::new(AtomicUsize::new(0));
    let counter = requests.clone();
    tokio::spawn(async move {
        loop {
            let Ok((mut stream, _)) = listener.accept().await else { return };
            let (body, counter) = (body.clone(), counter.clone());
            tokio::spawn(async move {
                let mut request = Vec::new();
                let mut buffer = [0u8; 1024];
                while !request.windows(4).any(|w| w == b"\r\n\r\n") {
                    match stream.read(&mut buffer).await {
                        Ok(0) | Err(_) => return,
                        Ok(read) => request.extend_from_slice(&buffer[..read]),
                    }
                }
                let seen = counter.fetch_add(1, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(serve.delay_ms)).await;
                let tag = match serve.change_after {
                    Some(limit) if seen >= limit => "\"v2\"",
                    _ => "\"v1\"",
                };
                let text = String::from_utf8_lossy(&request).to_ascii_lowercase();
                let range = text.lines().find_map(|line| line.strip_prefix("range: bytes=")).and_then(|span| {
                    let (start, end) = span.trim().split_once('-')?;
                    Some((start.parse::<usize>().ok()?, end.parse::<usize>().ok()?))
                });
                let total = body.len();
                let (status, slice, extra) = match range.filter(|_| serve.ranges) {
                    Some((start, end)) => {
                        let end = end.min(total - 1);
                        (
                            "206 Partial Content",
                            &body[start..=end],
                            format!("Content-Range: bytes {start}-{end}/{total}\r\n"),
                        )
                    }
                    None => ("200 OK", &body[..], String::new()),
                };
                let head = format!(
                    "HTTP/1.1 {status}\r\nContent-Length: {}\r\nETag: {tag}\r\n{extra}Connection: close\r\n\r\n",
                    slice.len()
                );
                let _ = stream.write_all(head.as_bytes()).await;
                let _ = stream.write_all(slice).await;
            });
        }
    });
    (url, requests)
}

fn payload(size: usize) -> Arc<Vec<u8>> {
    Arc::new((0..size).map(|i| (i * 31 % 251) as u8).collect())
}

fn directory() -> PathBuf {
    let dir = std::env::temp_dir().join(format!("openretro-direct-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn downloads_blocks_in_parallel_and_assembles_the_file() {
    let body = payload(100_000);
    let (url, _) = server(body.clone(), Serve { ranges: true, change_after: None, delay_ms: 0 }).await;
    let dir = directory();
    let mut last = (0, 0);
    let target = download_with_options(
        &client().unwrap(),
        &url,
        &dir,
        Arc::new(Semaphore::new(8)),
        &CancellationToken::new(),
        7_000,
        4,
        |done, total| {
            last = (done, total);
            Ok(())
        },
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(std::fs::read(&target).unwrap(), *body);
    assert_eq!(last, (100_000, 100_000));
    assert!(!dir.join("game.bin.resume.json").exists(), "the resume map is removed");
    assert!(!dir.join("game.bin.part").exists());
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn servers_without_ranges_stream_the_whole_file() {
    let body = payload(50_000);
    let (url, requests) = server(body.clone(), Serve { ranges: false, change_after: None, delay_ms: 0 }).await;
    let dir = directory();
    let target = download_with_options(
        &client().unwrap(),
        &url,
        &dir,
        Arc::new(Semaphore::new(8)),
        &CancellationToken::new(),
        7_000,
        4,
        |_, _| Ok(()),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(std::fs::read(&target).unwrap(), *body);
    // The probe's full response is the download; nothing is fetched twice.
    assert_eq!(requests.load(Ordering::SeqCst), 1);
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_paused_download_resumes_without_refetching_finished_blocks() {
    let body = payload(80_000);
    let (url, requests) =
        server(body.clone(), Serve { ranges: true, change_after: None, delay_ms: 200 }).await;
    let dir = directory();
    let client = client().unwrap();
    let cancel = CancellationToken::new();
    let stop = cancel.clone();
    // One connection and a pause once some data has arrived.
    let paused = download_with_options(
        &client,
        &url,
        &dir,
        Arc::new(Semaphore::new(8)),
        &cancel,
        8_000,
        1,
        move |done, _| {
            if done >= 24_000 {
                stop.cancel();
            }
            Ok(())
        },
    )
    .await
    .unwrap();
    assert!(paused.is_none(), "a pause returns no file");
    let saved: Resume =
        serde_json::from_slice(&std::fs::read(dir.join("game.bin.resume.json")).unwrap()).unwrap();
    let finished = saved.done.iter().filter(|done| **done).count();
    assert!(finished > 0 && finished < saved.done.len(), "{finished} blocks kept");
    let before = requests.load(Ordering::SeqCst);

    let target = download_with_options(
        &client,
        &url,
        &dir,
        Arc::new(Semaphore::new(8)),
        &CancellationToken::new(),
        8_000,
        4,
        |_, _| Ok(()),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(std::fs::read(&target).unwrap(), *body);
    // One probe, then only the blocks that were missing.
    assert_eq!(requests.load(Ordering::SeqCst) - before, 1 + saved.done.len() - finished);
    let _ = std::fs::remove_dir_all(dir);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_file_replaced_mid_download_is_rejected_instead_of_mixed() {
    let body = payload(60_000);
    let (url, _) = server(body, Serve { ranges: true, change_after: Some(3), delay_ms: 0 }).await;
    let dir = directory();
    let result = download_with_options(
        &client().unwrap(),
        &url,
        &dir,
        Arc::new(Semaphore::new(8)),
        &CancellationToken::new(),
        6_000,
        2,
        |_, _| Ok(()),
    )
    .await;
    let message = result.unwrap_err();
    assert!(message.contains("mudou no servidor"), "{message}");
    assert!(!dir.join("game.bin").exists(), "no mixed file is published");
    let _ = std::fs::remove_dir_all(dir);
}
