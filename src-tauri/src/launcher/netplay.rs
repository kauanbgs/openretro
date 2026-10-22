//! Direct-IP netplay through the OpenRetro Runtime. One player hosts the game
//! and the others connect to the host's address; the runtime keeps every
//! emulator in sync, so all players need the same game file and core.
use crate::database::Result;
use serde::Deserialize;

pub const DEFAULT_PORT: u16 = 55435;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Netplay {
    /// "host" or "join".
    pub role: String,
    /// The host's IP address or name, optionally with ":port". Joining only.
    pub address: Option<String>,
    pub port: Option<u16>,
    pub nickname: Option<String>,
    /// Optional room password the host sets and players must repeat.
    pub password: Option<String>,
}

/// Consoles whose cores replay frames deterministically enough for netplay.
/// N64, DS, PSP, PS2 and DOS cores desync or cannot rewind states fast enough.
pub fn supported(platform: &str) -> bool {
    matches!(
        platform,
        "nes" | "snes" | "gb" | "gbc" | "gba" | "sms" | "genesis" | "gg" | "psx" | "arcade"
    )
}

fn valid_host(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 253
        && !host.starts_with(['-', '.'])
        && host
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b".-:".contains(&b))
}

/// Keeps only characters that cannot break out of a config value or argument.
fn plain(text: &str, limit: usize) -> String {
    text.chars()
        .filter(|c| c.is_alphanumeric() || " -_.".contains(*c))
        .take(limit)
        .collect::<String>()
        .trim()
        .to_string()
}

impl Netplay {
    pub fn hosting(&self) -> bool {
        self.role == "host"
    }

    /// The host and port to connect to, accepting "1.2.3.4:55435" as typed.
    fn target(&self) -> Result<(Option<String>, u16)> {
        let mut port = self.port.unwrap_or(DEFAULT_PORT);
        if port < 1024 {
            return Err("Use uma porta entre 1024 e 65535.".into());
        }
        if self.hosting() {
            return Ok((None, port));
        }
        let address = self.address.as_deref().unwrap_or("").trim();
        let mut host = address;
        // One colon is "host:port"; more colons are an IPv6 address.
        if let Some((name, typed)) = address.rsplit_once(':') {
            if address.matches(':').count() == 1 {
                port = typed
                    .parse()
                    .ok()
                    .filter(|p| *p >= 1024)
                    .ok_or("A porta no endereço é inválida.")?;
                host = name;
            }
        }
        let host = host.trim_start_matches('[').trim_end_matches(']');
        if !valid_host(host) {
            return Err("Digite o endereço IP de quem está hospedando a partida.".into());
        }
        Ok((Some(host.to_string()), port))
    }

    pub fn validate(&self, platform: &str) -> Result<()> {
        if !matches!(self.role.as_str(), "host" | "join") {
            return Err("Modo de jogo online inválido.".into());
        }
        if !supported(platform) {
            return Err("Este console ainda não suporta jogo online.".into());
        }
        self.target().map(|_| ())
    }

    /// Before joining, makes sure someone is hosting at the address. Without
    /// this the runtime starts the game alone and the player sees no error.
    pub fn check_host(&self) -> Result<()> {
        let (Some(host), port) = self.target()? else {
            return Ok(());
        };
        let unreachable = || {
            format!(
                "Ninguém está hospedando em {host}:{port}. Confira o endereço e se o \
                 anfitrião já abriu a partida; pela internet, a porta precisa estar aberta \
                 no roteador dele."
            )
        };
        let address = std::net::ToSocketAddrs::to_socket_addrs(&(host.as_str(), port))
            .map_err(|_| unreachable())?
            .next()
            .ok_or_else(unreachable)?;
        std::net::TcpStream::connect_timeout(&address, std::time::Duration::from_secs(4))
            .map(drop)
            .map_err(|_| unreachable().into())
    }

    pub fn args(&self) -> Result<Vec<String>> {
        let (host, port) = self.target()?;
        let mut args = match host {
            Some(host) => vec!["--connect".into(), host],
            None => vec!["--host".into()],
        };
        args.extend(["--port".into(), port.to_string()]);
        let nickname = plain(self.nickname.as_deref().unwrap_or(""), 32);
        if !nickname.is_empty() {
            args.extend(["--nick".into(), nickname]);
        }
        Ok(args)
    }

    /// Config lines appended to the player's runtime config for this session.
    pub fn config(&self) -> String {
        let password = plain(self.password.as_deref().unwrap_or(""), 64);
        format!(
            "netplay_public_announce = \"false\"\nnetplay_use_mitm_server = \"false\"\n\
             netplay_nat_traversal = \"{}\"\nnetplay_allow_pausing = \"true\"\n\
             netplay_password = \"{password}\"\nnetplay_spectate_password = \"\"\n",
            self.hosting()
        )
    }
}

/// This computer's address on the local network, for the host to share.
/// Connecting a UDP socket only picks a route; no packet is sent.
#[tauri::command]
pub fn netplay_local_address() -> Option<String> {
    let socket = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let ip = socket.local_addr().ok()?.ip();
    (!ip.is_loopback() && !ip.is_unspecified()).then(|| ip.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn join(address: &str) -> Netplay {
        Netplay {
            role: "join".into(),
            address: Some(address.into()),
            port: None,
            nickname: Some("Kauã \"x\"\n".into()),
            password: Some("abc\"\nnetplay_x = 1".into()),
        }
    }

    #[test]
    fn builds_host_and_join_arguments() {
        let host = Netplay {
            role: "host".into(),
            address: None,
            port: Some(56000),
            nickname: None,
            password: None,
        };
        assert_eq!(host.args().unwrap(), ["--host", "--port", "56000"]);
        assert!(host.config().contains("netplay_nat_traversal = \"true\""));
        assert_eq!(
            join("192.168.0.12:56001").args().unwrap(),
            ["--connect", "192.168.0.12", "--port", "56001", "--nick", "Kauã x"]
        );
        assert_eq!(join("[fe80::1]").args().unwrap()[1], "fe80::1");
        assert_eq!(join("meu-pc.local").args().unwrap()[3], "55435");
    }

    #[test]
    fn rejects_unsafe_targets_and_unsupported_consoles() {
        for address in ["", "-L evil.dll", "1.2.3.4:80", "a b", "host;rm"] {
            assert!(join(address).validate("snes").is_err(), "{address}");
        }
        assert!(join("10.0.0.2").validate("ps2").is_err());
        assert!(join("10.0.0.2").validate("snes").is_ok());
    }

    #[test]
    fn joining_checks_that_someone_hosts() {
        let host = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = host.local_addr().unwrap().port();
        let mut session = join("127.0.0.1");
        session.port = Some(port);
        assert!(session.check_host().is_ok());
        drop(host);
        let error = session.check_host().unwrap_err();
        assert!(error.contains(&format!("127.0.0.1:{port}")), "{error}");
        let mut hosting = join("");
        hosting.role = "host".into();
        assert!(hosting.check_host().is_ok());
    }

    #[test]
    fn config_values_cannot_inject_lines() {
        let config = join("10.0.0.2").config();
        assert!(config.contains("netplay_password = \"abcnetplay_x  1\""));
        assert_eq!(config.lines().count(), 6);
    }
}
