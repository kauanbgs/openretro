//! Windows blocks phones on networks it marks as public: the firewall rule it
//! offers OpenRetro on first use covers private networks only, so phones on a
//! public network never reach this server. Phone play reports the category of
//! the network its address is on, so the dialog can say how to fix it instead
//! of phones silently failing to connect.
use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkProfile {
    /// Windows' Public category, where phones are blocked.
    pub public: bool,
    /// The connection's name, such as Ethernet or Wi-Fi.
    pub name: String,
    #[serde(skip)]
    pub settings: &'static str,
}

/// `Category|Alias`, as the profile query prints it. Unknown categories give
/// no profile rather than a wrong warning.
fn parse(output: &str) -> Option<NetworkProfile> {
    let (category, name) = output.trim().split_once('|')?;
    let public = match category.trim() {
        "Public" => true,
        "Private" | "DomainAuthenticated" => false,
        _ => return None,
    };
    let name = name.trim().to_string();
    let lower = name.to_lowercase();
    // The page where the connection's network profile is chosen.
    let settings = if ["wi-fi", "wifi", "wlan", "wireless", "sem fio"]
        .iter()
        .any(|word| lower.contains(word))
    {
        "ms-settings:network-wifi"
    } else if lower.contains("ethernet") {
        "ms-settings:network-ethernet"
    } else {
        "ms-settings:network-status"
    };
    Some(NetworkProfile {
        public,
        name,
        settings,
    })
}

#[cfg(windows)]
fn profile(address: &str) -> Option<NetworkProfile> {
    use std::os::windows::process::CommandExt;
    // A parsed address prints only digits, dots, colons and hex letters, so
    // it is safe inside the quoted script argument.
    let ip: std::net::IpAddr = address.parse().ok()?;
    let script = format!(
        "$p = Get-NetIPAddress -IPAddress '{ip}' -ErrorAction Stop | Get-NetConnectionProfile -ErrorAction Stop | Select-Object -First 1; \"$($p.NetworkCategory)|$($p.InterfaceAlias)\""
    );
    let output = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .creation_flags(0x08000000) // CREATE_NO_WINDOW
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| parse(&String::from_utf8_lossy(&output.stdout)))
        .flatten()
}

#[cfg(not(windows))]
fn profile(_address: &str) -> Option<NetworkProfile> {
    None
}

#[derive(Default)]
struct Checked {
    profile: Option<NetworkProfile>,
    at: Option<Instant>,
    checking: bool,
}

/// The network phone play listens on, checked in the background and again
/// every few seconds, so fixing it clears the warning without a restart.
pub struct Watch {
    address: String,
    checked: Arc<Mutex<Checked>>,
}

impl Watch {
    const STALE: Duration = Duration::from_secs(5);

    pub fn new(address: &str) -> Self {
        let watch = Self {
            address: address.to_string(),
            checked: Arc::default(),
        };
        watch.refresh();
        watch
    }

    pub fn current(&self) -> Option<NetworkProfile> {
        let (profile, stale) = self
            .checked
            .lock()
            .map(|checked| {
                let stale =
                    !checked.checking && checked.at.is_none_or(|at| at.elapsed() > Self::STALE);
                (checked.profile.clone(), stale)
            })
            .unwrap_or((None, false));
        if stale {
            self.refresh();
        }
        profile
    }

    fn refresh(&self) {
        let Ok(mut checked) = self.checked.lock() else {
            return;
        };
        if checked.checking {
            return;
        }
        checked.checking = true;
        drop(checked);
        let (address, checked) = (self.address.clone(), self.checked.clone());
        std::thread::spawn(move || {
            let profile = profile(&address);
            if let Ok(mut checked) = checked.lock() {
                *checked = Checked {
                    profile,
                    at: Some(Instant::now()),
                    checking: false,
                };
            }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_category_and_the_page_that_changes_it() {
        let ethernet = parse("Public|Ethernet\r\n").unwrap();
        assert!(ethernet.public);
        assert_eq!(ethernet.name, "Ethernet");
        assert_eq!(ethernet.settings, "ms-settings:network-ethernet");
        let wifi = parse("Private|Wi-Fi 2").unwrap();
        assert!(!wifi.public);
        assert_eq!(wifi.settings, "ms-settings:network-wifi");
        assert!(
            !parse("DomainAuthenticated|Rede corporativa")
                .unwrap()
                .public
        );
        assert_eq!(
            parse("Public|Radmin VPN").unwrap().settings,
            "ms-settings:network-status"
        );
        for unknown in ["", "|", "Public", "Other|Ethernet"] {
            assert_eq!(parse(unknown), None);
        }
    }

    #[cfg(windows)]
    #[test]
    fn an_address_that_is_not_this_pc_has_no_profile() {
        assert_eq!(profile("not an address"), None);
        assert_eq!(profile("203.0.113.7"), None);
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "manual check of this PC's real network"]
    fn this_pcs_phone_play_network() {
        let address = crate::launcher::netplay::netplay_local_address().unwrap();
        println!("{address}: {:?}", profile(&address));
    }
}
