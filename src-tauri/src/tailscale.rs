//! Remote access for the library server, set up without the player having to
//! know what Tailscale is. When it is missing the app downloads Tailscale's own
//! installer, checks its signature, installs it (Windows asks for permission
//! once), opens the sign-in page and waits for the PC to get its address.
//! Progress lives in `Tailscale`, which the interface polls.
use crate::database::{error, Result};
use serde::Serialize;
use std::{
    io::{BufRead, BufReader},
    net::Ipv4Addr,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{mpsc, Mutex},
    time::{Duration, Instant},
};
use tauri::Manager;
use tokio::io::AsyncWriteExt;

const INSTALLER_URL: &str = "https://pkgs.tailscale.com/stable/tailscale-setup-latest-amd64.msi";
const INSTALLER_HOST: &str = "pkgs.tailscale.com";
const MAX_INSTALLER_BYTES: u64 = 120 * 1024 * 1024;
const LOGIN_HOST_PREFIX: &str = "https://login.tailscale.com/";
const LOGIN_TIMEOUT: Duration = Duration::from_secs(15 * 60);

#[derive(Default)]
pub struct Tailscale(Mutex<Setup>);

/// What the setup is doing now, for the interface.
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct Setup {
    running: bool,
    /// "downloading", "installing", "login" or "failed" while there is news.
    stage: String,
    percent: u8,
    message: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TailscaleStatus {
    /// "missing" (not installed), "needsLogin" (installed, no account yet) or "ready".
    state: &'static str,
    address: Option<String>,
    setup: Setup,
}

// ---- finding and running the command line ----

fn hidden(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    command
}

fn executables() -> Vec<PathBuf> {
    let mut found = vec![PathBuf::from("tailscale")];
    for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(root) = std::env::var_os(variable) {
            found.push(PathBuf::from(root).join("Tailscale").join("tailscale.exe"));
        }
    }
    found
}

fn run(args: &[&str]) -> Option<std::process::Output> {
    executables()
        .into_iter()
        .find_map(|exe| hidden(Command::new(exe).args(args)).output().ok())
}

fn is_installed() -> bool {
    run(&["version"]).is_some_and(|output| output.status.success())
}

/// This PC's Tailscale address, once it has signed in.
pub fn address() -> Option<String> {
    let output = run(&["ip", "-4"]).filter(|output| output.status.success())?;
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.trim().parse::<Ipv4Addr>().ok())
        .find(|ip| crate::library_server::is_tailscale(*ip))
        .map(|ip| ip.to_string())
}

fn state() -> (&'static str, Option<String>) {
    if !is_installed() {
        return ("missing", None);
    }
    match address() {
        Some(address) => ("ready", Some(address)),
        None => ("needsLogin", None),
    }
}

fn status_of(app: &tauri::AppHandle) -> TailscaleStatus {
    let (state, address) = state();
    TailscaleStatus {
        state,
        address,
        setup: app
            .state::<Tailscale>()
            .0
            .lock()
            .map(|setup| setup.clone())
            .unwrap_or_default(),
    }
}

fn set(app: &tauri::AppHandle, stage: &str, percent: u8, message: Option<String>) {
    if let Ok(mut setup) = app.state::<Tailscale>().0.lock() {
        setup.stage = stage.into();
        setup.percent = percent;
        setup.message = message;
    }
}

// ---- commands ----

#[tauri::command(async)]
pub fn tailscale_status(app: tauri::AppHandle) -> TailscaleStatus {
    status_of(&app)
}

/// Starts the setup in the background and returns at once; the interface
/// follows it through `tailscale_status`.
#[tauri::command(async)]
pub fn tailscale_setup(app: tauri::AppHandle) -> Result<TailscaleStatus> {
    {
        let state = app.state::<Tailscale>();
        let mut setup = state.0.lock().map_err(error)?;
        if setup.running {
            drop(setup);
            return Ok(status_of(&app));
        }
        *setup = Setup {
            running: true,
            ..Setup::default()
        };
    }
    let background = app.clone();
    tauri::async_runtime::spawn(async move {
        let result = setup(&background).await;
        if let Ok(mut setup) = background.state::<Tailscale>().0.lock() {
            setup.running = false;
            match result {
                Ok(()) => *setup = Setup::default(),
                Err(message) => {
                    log::warn!("Tailscale setup failed: {message}");
                    setup.stage = "failed".into();
                    setup.message = Some(message);
                }
            }
        }
    });
    Ok(status_of(&app))
}

// ---- the setup ----

async fn setup(app: &tauri::AppHandle) -> Result<()> {
    if !is_installed() {
        install(app).await?;
    }
    if address().is_none() {
        sign_in(app).await?;
    }
    Ok(())
}

async fn install(app: &tauri::AppHandle) -> Result<()> {
    if !cfg!(all(windows, target_arch = "x86_64")) {
        return Err("A instalação automática só funciona no Windows de 64 bits.".into());
    }
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(error)?
        .join("tailscale-setup");
    std::fs::create_dir_all(&directory).map_err(error)?;
    let installer = directory.join("tailscale.msi");
    let result: Result<()> = async {
        set(app, "downloading", 0, None);
        download(app, &installer).await?;
        set(app, "installing", 100, None);
        let checked = installer.clone();
        tauri::async_runtime::spawn_blocking(move || {
            verify_signature(&checked)?;
            run_installer(&checked)
        })
        .await
        .map_err(error)??;
        Ok(())
    }
    .await;
    let _ = std::fs::remove_dir_all(&directory);
    result?;
    // The service takes a moment to start after the installer ends.
    let deadline = Instant::now() + Duration::from_secs(60);
    while !is_installed() {
        if Instant::now() > deadline {
            return Err("O Tailscale foi instalado, mas não respondeu. Reinicie o computador e tente de novo.".into());
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
    Ok(())
}

async fn download(app: &tauri::AppHandle, target: &Path) -> Result<()> {
    let client = reqwest::Client::builder()
        .user_agent(concat!("OpenRetro/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            let url = attempt.url();
            if attempt.previous().len() < 5
                && url.scheme() == "https"
                && url.host_str() == Some(INSTALLER_HOST)
            {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .map_err(error)?;
    let mut response = client
        .get(INSTALLER_URL)
        .send()
        .await
        .map_err(|_| "Não foi possível baixar o instalador. Verifique sua conexão.")?;
    if !response.status().is_success() {
        return Err("O site do Tailscale não entregou o instalador agora. Tente de novo mais tarde.".into());
    }
    let total = response.content_length().unwrap_or(0);
    if total > MAX_INSTALLER_BYTES {
        return Err("O instalador veio maior que o esperado e foi descartado.".into());
    }
    let mut file = tokio::fs::File::create(target).await.map_err(error)?;
    let mut received = 0u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "A conexão caiu durante o download. Tente de novo.")?
    {
        received += chunk.len() as u64;
        if received > MAX_INSTALLER_BYTES {
            return Err("O instalador veio maior que o esperado e foi descartado.".into());
        }
        file.write_all(&chunk).await.map_err(error)?;
        if total > 0 {
            set(app, "downloading", (received * 100 / total).min(100) as u8, None);
        }
    }
    file.flush().await.map_err(error)?;
    if received == 0 || (total > 0 && received != total) {
        return Err("O download do instalador ficou incompleto. Tente de novo.".into());
    }
    Ok(())
}

/// In a PowerShell single-quoted string, a quote is written twice.
fn quoted(path: &Path) -> String {
    path.display().to_string().replace('\'', "''")
}

/// The installer must carry a valid Microsoft Authenticode signature from
/// Tailscale Inc., whatever the download returned.
fn verify_signature(installer: &Path) -> Result<()> {
    let script = format!(
        "$s = Get-AuthenticodeSignature -LiteralPath '{}'; \
         if ($s.Status -eq 'Valid' -and $s.SignerCertificate.Subject -like '*O=Tailscale Inc.*') {{ exit 0 }} else {{ exit 1 }}",
        quoted(installer)
    );
    let ok = hidden(Command::new("powershell.exe").args([
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        &script,
    ]))
    .status()
    .map_err(error)?
    .success();
    if ok {
        Ok(())
    } else {
        Err("O instalador baixado não tem a assinatura do Tailscale e não foi aberto.".into())
    }
}

/// Windows asks the player for permission once; no other window opens.
fn run_installer(installer: &Path) -> Result<()> {
    let script = format!(
        "try {{ $p = Start-Process -FilePath 'msiexec.exe' -ArgumentList '/i','\"{}\"','/quiet','/norestart' -Verb RunAs -Wait -PassThru; exit $p.ExitCode }} catch {{ exit 1223 }}",
        quoted(installer)
    );
    let code = hidden(Command::new("powershell.exe").args([
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        &script,
    ]))
    .status()
    .map_err(error)?
    .code();
    match code {
        // 3010: installed, a restart is advised but not needed to connect.
        Some(0) | Some(3010) => Ok(()),
        Some(1223) => Err("A instalação foi cancelada. Aceite a janela de permissão do Windows para continuar.".into()),
        other => Err(format!("A instalação não terminou (código {}).", other.map_or("?".into(), |c| c.to_string()))),
    }
}

/// The sign-in link `tailscale up` prints, only if it is Tailscale's own.
fn login_link(line: &str) -> Option<&str> {
    let start = line.find("https://")?;
    let link = line[start..].split_whitespace().next()?;
    link.starts_with(LOGIN_HOST_PREFIX).then_some(link)
}

async fn sign_in(app: &tauri::AppHandle) -> Result<()> {
    set(app, "login", 100, None);
    tauri::async_runtime::spawn_blocking(login)
        .await
        .map_err(error)?
}

/// Opens Tailscale's sign-in page and waits until this PC has its address.
fn login() -> Result<()> {
    let mut child = executables()
        .into_iter()
        .find_map(|exe| {
            hidden(Command::new(exe).arg("up"))
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .ok()
        })
        .ok_or("Não foi possível abrir o Tailscale para entrar na conta.")?;
    let (sender, links) = mpsc::channel::<String>();
    for stream in [
        child.stdout.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
        child.stderr.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>),
    ]
    .into_iter()
    .flatten()
    {
        let sender = sender.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stream).lines().map_while(std::result::Result::ok) {
                if let Some(link) = login_link(&line) {
                    let _ = sender.send(link.to_string());
                }
            }
        });
    }
    drop(sender);
    let deadline = Instant::now() + LOGIN_TIMEOUT;
    // Already signed in, or the link arrives within a few seconds.
    if let Ok(link) = links.recv_timeout(Duration::from_secs(45)) {
        open_link(&link);
    }
    while address().is_none() {
        if Instant::now() > deadline {
            let _ = child.kill();
            return Err("O login no Tailscale não foi concluído a tempo. Tente de novo.".into());
        }
        std::thread::sleep(Duration::from_secs(2));
    }
    let _ = child.kill();
    let _ = child.wait();
    Ok(())
}

fn open_link(link: &str) {
    #[cfg(windows)]
    let _ = Command::new("explorer.exe").arg(link).spawn();
    #[cfg(not(windows))]
    let _ = link;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_tailscale_sign_in_links_are_opened() {
        assert_eq!(
            login_link("\thttps://login.tailscale.com/a/1234abcd"),
            Some("https://login.tailscale.com/a/1234abcd")
        );
        assert_eq!(
            login_link("To authenticate, visit: https://login.tailscale.com/a/xyz trailing"),
            Some("https://login.tailscale.com/a/xyz")
        );
        assert_eq!(login_link("https://evil.example/https://login.tailscale.com/a/1"), None);
        assert_eq!(login_link("http://login.tailscale.com/a/1"), None);
        assert_eq!(login_link("https://login.tailscale.com.evil.example/a/1"), None);
        assert_eq!(login_link("Success."), None);
    }

    #[test]
    fn quotes_in_paths_are_doubled_for_powershell() {
        assert_eq!(quoted(Path::new(r"C:\Users\O'Brien\a.msi")), r"C:\Users\O''Brien\a.msi");
    }
}
