import { useEffect, useState, type ReactNode } from "react";
import { Check, Github, Share2, X } from "lucide-react";

const REPO = "https://github.com/kauanbgs/openretro";
// Stable asset name published with every release; used until the API answers.
const DOWNLOAD_FALLBACK = `${REPO}/releases/latest/download/OpenRetro-Setup.exe`;
const LATEST_RELEASE_API =
  "https://api.github.com/repos/kauanbgs/openretro/releases/latest";
const SITE = "https://openretro.com.br";

type Installer = { url: string; version?: string; size?: number };

// Resolves the latest Windows installer so the button downloads it directly.
function useInstaller() {
  const [installer, setInstaller] = useState<Installer>({
    url: DOWNLOAD_FALLBACK,
  });
  useEffect(() => {
    const controller = new AbortController();
    fetch(LATEST_RELEASE_API, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (
          release: {
            tag_name?: string;
            assets?: {
              name: string;
              size: number;
              browser_download_url: string;
            }[];
          } | null,
        ) => {
          const asset = release?.assets?.find((item) =>
            /_x64-setup\.exe$/i.test(item.name),
          );
          if (asset)
            setInstaller({
              url: asset.browser_download_url,
              version: release?.tag_name,
              size: asset.size,
            });
        },
      )
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return installer;
}

type Platform = "windows" | "mobile" | "other";
function detectPlatform(): Platform {
  const agent = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(agent)) return "mobile";
  if (/Windows/i.test(agent)) return "windows";
  return "other";
}

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}
function track(name: string, params: Record<string, unknown> = {}) {
  window.gtag?.("event", name, params);
}

const library = [
  { id: "mario-kart", name: "Super Mario Kart", system: "Super Nintendo" },
  { id: "crash", name: "Crash Bandicoot", system: "PlayStation" },
  { id: "zelda", name: "Zelda: A Link to the Past", system: "Super Nintendo" },
  { id: "sonic", name: "Sonic the Hedgehog", system: "Mega Drive" },
  { id: "tekken", name: "Tekken 3", system: "PlayStation" },
  { id: "chrono-trigger", name: "Chrono Trigger", system: "Super Nintendo" },
];

const systems = [
  "NES",
  "Super Nintendo",
  "Nintendo 64",
  "Game Boy",
  "Game Boy Advance",
  "Nintendo DS",
  "Mega Drive",
  "Master System",
  "PlayStation",
  "PlayStation 2",
  "PlayStation 3",
  "PSP",
  "Arcade",
  "MS-DOS",
];

const features = [
  {
    title: "Covers and details, filled in",
    text: "Add a game and it shows up with its cover, year and description.",
  },
  {
    title: "Controller-first TV mode",
    text: "Switch to full screen and browse your library from the couch.",
  },
  {
    title: "Resume where you stopped",
    text: "Jump back into your last session and keep save states.",
  },
  {
    title: "Achievements",
    text: "Earn RetroAchievements in games you already know by heart.",
  },
  {
    title: "Friends and chat",
    text: "Add friends, send messages and see what they're playing.",
  },
  {
    title: "Discord status",
    text: "Your Discord profile shows the game you're playing.",
  },
];

const faqs: { q: string; a: ReactNode }[] = [
  {
    q: "Is it really free?",
    a: "Yes. There's no price, no subscription and no ads. The code is open source under the MIT license.",
  },
  {
    q: "Does it come with games?",
    a: "No. OpenRetro is a launcher. You add games you own from a folder on your PC, or from download sources you add yourself.",
  },
  {
    q: "Do I have to set up emulators?",
    a: "No. The first time you play a system, OpenRetro downloads and configures its emulator.",
  },
  {
    q: "Do my friends need to install anything?",
    a: "No. Friends join your Party from a link in their browser. Your phone connects the same way.",
  },
  {
    q: 'Windows says "Windows protected your PC". Is it safe?',
    a: (
      <>
        The installer isn't code-signed yet, so SmartScreen warns about it.
        Click <b>More info</b>, then <b>Run anyway</b>. All of the code is
        public on{" "}
        <a href={REPO} target="_blank" rel="noreferrer">
          GitHub
        </a>
        .
      </>
    ),
  },
  {
    q: "Do I need an account?",
    a: "Not to play. You only sign in for friends, chat and Parties.",
  },
  {
    q: "Does it run on Mac or Linux?",
    a: "Not yet. OpenRetro runs on Windows 10 and 11, 64-bit.",
  },
];

function formatSize(bytes?: number) {
  return bytes ? `${Math.round(bytes / 1024 / 1024)} MB` : undefined;
}

function WindowsMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M0 2.2 6.5 1.3v6.2H0zM7.3 1.2 16 0v7.5H7.3zM0 8.3h6.5v6.3L0 13.7zM7.3 8.3H16V16l-8.7-1.2z"
      />
    </svg>
  );
}

function Brand() {
  return (
    <a className="brand" href="#top" aria-label="OpenRetro home">
      <img src="./openretro.svg" alt="" width="26" height="26" />
      OpenRetro
    </a>
  );
}

function DownloadButton({
  installer,
  platform,
  where,
  onDownload,
  compact = false,
}: {
  installer: Installer;
  platform: Platform;
  where: string;
  onDownload: () => void;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  if (platform === "mobile") {
    const share = async () => {
      track("send_to_pc", { where });
      try {
        if (navigator.share)
          await navigator.share({
            title: "OpenRetro",
            text: "Download OpenRetro on my PC",
            url: SITE,
          });
        else {
          await navigator.clipboard.writeText(SITE);
          setCopied(true);
        }
      } catch {
        // The share sheet was closed.
      }
    };
    return (
      <button className={`download ${compact ? "compact" : ""}`} onClick={share}>
        <Share2 size={compact ? 16 : 19} />
        {copied ? "Link copied" : compact ? "Send to PC" : "Send the link to my PC"}
      </button>
    );
  }
  return (
    <a
      className={`download ${compact ? "compact" : ""}`}
      href={installer.url}
      onClick={() => {
        track("file_download", {
          where,
          version: installer.version,
          file_name: "OpenRetro-Setup.exe",
        });
        onDownload();
      }}
    >
      <WindowsMark size={compact ? 15 : 18} />
      {compact ? "Download" : "Download for Windows"}
    </a>
  );
}

function DownloadNote({
  installer,
  platform,
}: {
  installer: Installer;
  platform: Platform;
}) {
  if (platform === "mobile")
    return (
      <p className="download-note">
        OpenRetro is a Windows app. Send yourself the link and download it on
        your PC.
      </p>
    );
  if (platform === "other")
    return (
      <p className="download-note">
        OpenRetro runs on Windows 10 and 11. Mac and Linux aren't supported yet.
      </p>
    );
  const size = formatSize(installer.size);
  return (
    <p className="download-note">
      Free for Windows 10 and 11{size ? `, ${size}` : ""}.
      {installer.version ? ` Version ${installer.version.replace(/^v/, "")}.` : ""}
    </p>
  );
}

function AfterDownload({ onClose, url }: { onClose: () => void; url: string }) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="after-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button className="modal-close" aria-label="Close" onClick={onClose}>
          <X size={18} />
        </button>
        <h2 id="after-title">Your download started</h2>
        <ol className="install-steps">
          <li>
            <b>Open OpenRetro-Setup.exe</b>
            <span>You'll find it in your Downloads folder.</span>
          </li>
          <li>
            <b>If Windows shows a blue warning</b>
            <span>
              Click More info, then Run anyway. The installer isn't code-signed
              yet.
            </span>
          </li>
          <li>
            <b>Add your games and press play</b>
            <span>Each emulator sets itself up the first time.</span>
          </li>
        </ol>
        <p className="modal-retry">
          Nothing happened? <a href={url}>Download again</a>
        </p>
      </section>
    </div>
  );
}

export function Website() {
  const installer = useInstaller();
  const [platform] = useState(detectPlatform);
  const [downloaded, setDownloaded] = useState(false);
  const button = (where: string, compact = false) => (
    <DownloadButton
      installer={installer}
      platform={platform}
      where={where}
      compact={compact}
      onDownload={() => setDownloaded(true)}
    />
  );
  return (
    <div className="site" id="top">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="header">
        <div className="wrap header-inner">
          <Brand />
          <nav aria-label="Main">
            <a href="#how">How it works</a>
            <a href="#friends">Play with friends</a>
            <a href="#faq">FAQ</a>
          </nav>
          <a
            className="header-link"
            href={REPO}
            target="_blank"
            rel="noreferrer"
            aria-label="OpenRetro on GitHub"
          >
            <Github size={19} />
          </a>
          {button("header", true)}
        </div>
      </header>

      <main id="main">
        <section className="hero wrap">
          <div className="hero-copy">
            <h1>All your retro games in one place, ready to play.</h1>
            <p className="lede">
              OpenRetro is a free launcher for Windows. Add your games, press
              play, and it sets up the emulator for you. Friends can even join
              from their browser.
            </p>
            <div className="hero-action">
              {button("hero")}
              <DownloadNote installer={installer} platform={platform} />
            </div>
          </div>
          <div className="shelf" aria-hidden="true">
            {library.map((game) => (
              <figure key={game.id}>
                <img src={`./art/${game.id}.jpg`} alt="" />
                <figcaption>
                  <b>{game.name}</b>
                  <span>{game.system}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section className="systems" aria-label="Supported systems">
          <div className="wrap">
            <p>Plays games from</p>
            <ul>
              {systems.map((name) => (
                <li key={name}>{name}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="how wrap" id="how">
          <h2>Playing in three steps</h2>
          <ol>
            <li>
              <h3>Install OpenRetro</h3>
              <p>One small installer. Updates arrive on their own.</p>
            </li>
            <li>
              <h3>Choose your games folder</h3>
              <p>Your games appear with covers and details.</p>
            </li>
            <li>
              <h3>Press play</h3>
              <p>
                The right emulator downloads and configures itself. Plug in a
                controller and go.
              </p>
            </li>
          </ol>
        </section>

        <section className="friends" id="friends">
          <div className="wrap friends-inner">
            <div className="friends-copy">
              <h2>Your friends join from a link</h2>
              <p>
                The game runs on your PC. Start a Party and send the link: up
                to three friends play along from their browser, with a keyboard
                or a controller, and you can chat while you play.
              </p>
              <p>
                Your phone works the same way. Scan a code and it becomes a
                second screen with touch controls.
              </p>
            </div>
            <div className="party" aria-hidden="true">
              <div className="party-screen">
                <img src="./art/mario-kart.jpg" alt="" loading="lazy" />
                <div className="party-chat">
                  <span>
                    <b>Ana</b> rematch?
                  </span>
                  <span>
                    <b>Leo</b> one more cup
                  </span>
                </div>
              </div>
              <ul className="party-players">
                <li>
                  <i className="p1" />
                  You
                </li>
                <li>
                  <i className="p2" />
                  Ana
                </li>
                <li>
                  <i className="p3" />
                  Leo
                </li>
                <li className="open">
                  <i />
                  Open seat
                </li>
              </ul>
            </div>
          </div>
        </section>

        <section className="features wrap">
          <h2>Everything else you'd expect</h2>
          <ul>
            {features.map((item) => (
              <li key={item.title}>
                <Check size={18} strokeWidth={2.5} />
                <div>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="faq wrap" id="faq">
          <h2>Questions</h2>
          <div>
            {faqs.map((item, index) => (
              <details key={item.q} open={index === 0}>
                <summary>{item.q}</summary>
                <p>{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="final">
          <div className="wrap final-inner">
            <h2>Ready when you are</h2>
            <p>Free, open source and set up in a couple of minutes.</p>
            {button("footer")}
            <DownloadNote installer={installer} platform={platform} />
          </div>
        </section>
      </main>

      <footer className="footer wrap">
        <Brand />
        <nav aria-label="Footer">
          <a href={REPO} target="_blank" rel="noreferrer">
            Source code
          </a>
          <a href={`${REPO}/issues`} target="_blank" rel="noreferrer">
            Report a problem
          </a>
          <a href="./credits.html">Credits and licenses</a>
        </nav>
        <p>
          OpenRetro doesn't include or distribute games. Game artwork belongs to
          its respective owners.
        </p>
      </footer>

      {downloaded && (
        <AfterDownload
          url={installer.url}
          onClose={() => setDownloaded(false)}
        />
      )}
    </div>
  );
}
