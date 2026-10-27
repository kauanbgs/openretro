import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  Award,
  Check,
  ChevronDown,
  Download,
  FolderOpen,
  Gamepad2,
  Github,
  Heart,
  Library,
  MessageCircle,
  Monitor,
  Play,
  Save,
  Search,
  Settings,
  Share2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Users,
  Wifi,
  X,
} from "lucide-react";

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

const systems = [
  "NES",
  "SNES",
  "Nintendo 64",
  "Game Boy",
  "Game Boy Advance",
  "Nintendo DS",
  "Master System",
  "Genesis",
  "Game Gear",
  "PlayStation",
  "PSP",
  "PlayStation 2",
  "PlayStation 3",
  "Arcade",
  "MS-DOS",
];

const extras = [
  {
    icon: Library,
    title: "Covers and details, automatically",
    text: "Add a game and OpenRetro finds its cover, year, genre and description.",
  },
  {
    icon: Save,
    title: "Pick up where you left off",
    text: "Resume your last session and manage save states on supported systems.",
  },
  {
    icon: Award,
    title: "Achievements",
    text: "Unlock RetroAchievements in the classics you already love.",
  },
  {
    icon: MessageCircle,
    title: "Friends and chat",
    text: "Add friends, message them and see what everyone is playing.",
  },
  {
    icon: Sparkles,
    title: "Find your next game",
    text: "Recommendations based on what you play, from a catalog of classics.",
  },
  {
    icon: Gamepad2,
    title: "Discord status",
    text: "Let your friends see what you're playing right now.",
  },
];

const faqs: { q: string; a: ReactNode }[] = [
  {
    q: "Is OpenRetro really free?",
    a: "Yes. No price, no subscription, no ads. The code is open source under the MIT license, so anyone can check what it does.",
  },
  {
    q: "Does it come with games?",
    a: "No. OpenRetro is a launcher. You add games you own from a folder on your PC, or from download sources you add yourself.",
  },
  {
    q: "Do I need to set up emulators?",
    a: "No. When you press play, OpenRetro downloads and configures the right emulator for that system. Plug in a controller and you're in.",
  },
  {
    q: "Do my friends need to install anything?",
    a: "No. For a Party, your friends open a link in their browser and play with a keyboard or controller. Your phone works the same way, with no app.",
  },
  {
    q: 'Windows says "Windows protected your PC". Is it safe?',
    a: (
      <>
        The installer isn't code-signed yet, so Windows SmartScreen may warn you
        about a new app. Click <b>More info</b>, then <b>Run anyway</b>. Every
        line of code is public on{" "}
        <a href={REPO} target="_blank" rel="noreferrer">
          GitHub
        </a>
        .
      </>
    ),
  },
  {
    q: "Do I need an account?",
    a: "Not to play. An account is only used for friends, chat and Parties.",
  },
  {
    q: "Does it work on Mac or Linux?",
    a: "Not yet. OpenRetro runs on Windows 10 and 11 (64-bit).",
  },
];

function Brand() {
  return (
    <span className="brand">
      <img src="./openretro.svg" alt="" width="28" height="28" />
      <span>OpenRetro</span>
    </span>
  );
}

function formatSize(bytes?: number) {
  return bytes ? `${Math.round(bytes / 1024 / 1024)} MB` : undefined;
}

function DownloadButton({
  installer,
  platform,
  where,
  onDownload,
  size = "large",
}: {
  installer: Installer;
  platform: Platform;
  where: string;
  onDownload: () => void;
  size?: "large" | "small";
}) {
  const [sent, setSent] = useState(false);
  if (platform === "mobile" && size === "large") {
    const share = async () => {
      track("send_to_pc", { where });
      const data = {
        title: "OpenRetro",
        text: "Download OpenRetro on my PC",
        url: SITE,
      };
      try {
        if (navigator.share) await navigator.share(data);
        else {
          await navigator.clipboard.writeText(SITE);
          setSent(true);
        }
      } catch {
        // The share sheet was closed.
      }
    };
    return (
      <div className="cta-group">
        <button className="cta" onClick={share}>
          <Share2 size={20} />
          {sent ? "Link copied" : "Send the link to my PC"}
        </button>
        <p className="cta-meta">
          OpenRetro installs on Windows. Open this page on your PC to download.
        </p>
      </div>
    );
  }
  const meta = [
    installer.version,
    "Windows 10 & 11",
    "64-bit",
    formatSize(installer.size),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="cta-group">
      <a
        className={`cta ${size === "small" ? "small" : ""}`}
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
        <Download size={size === "small" ? 16 : 20} />
        {size === "small" ? "Download" : "Download free for Windows"}
      </a>
      {size === "large" && (
        <p className="cta-meta">
          {platform === "other"
            ? "Windows only for now. You can still grab the installer."
            : meta}
        </p>
      )}
    </div>
  );
}

/** The app's console mode, redrawn in English. */
function ConsoleMockup() {
  return (
    <div className="mockup" aria-label="OpenRetro console mode" role="img">
      <div className="mockup-bg" />
      <div className="mockup-top">
        <span className="mockup-tabs">
          <b>Games</b>
          <span>Library</span>
          <span>Explore</span>
        </span>
        <span className="mockup-tools">
          <span className="pill">
            <Users size={12} /> Party
          </span>
          <span className="pill">
            <Smartphone size={12} /> Phone
          </span>
          <Search size={13} />
          <Settings size={13} />
          <span className="clock">20:42</span>
        </span>
      </div>
      <div className="mockup-row">
        <img
          className="tile focused"
          src="./art/mario-kart.jpg"
          alt=""
        />
        {["mario-world", "zelda", "chrono-trigger", "metroid", "sonic"].map(
          (cover) => (
            <img
              key={cover}
              className="tile"
              src={`./art/${cover}.jpg`}
              alt=""
              loading="lazy"
            />
          ),
        )}
      </div>
      <div className="mockup-hub">
        <h3>Super Mario Kart</h3>
        <p>Super Nintendo · Racing · 1992</p>
        <span className="mockup-actions">
          <span className="mock-play">
            <Play size={12} fill="currentColor" /> Play
          </span>
          <span className="mock-online">
            <Users size={12} /> Play online
          </span>
        </span>
      </div>
      <div className="mockup-hints">
        <span>
          <i className="btn-a">A</i> Select
        </span>
        <span>
          <i className="btn-b">B</i> Back
        </span>
        <span>
          <i className="btn-y">Y</i> Options
        </span>
      </div>
    </div>
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
        <span className="modal-check">
          <Check size={22} />
        </span>
        <h2 id="after-title">Your download has started</h2>
        <ol className="install-steps">
          <li>
            <b>Open OpenRetro-Setup.exe</b>
            <span>You'll find it in your Downloads folder.</span>
          </li>
          <li>
            <b>If Windows shows a blue warning</b>
            <span>
              Click <em>More info</em>, then <em>Run anyway</em>. The installer
              isn't code-signed yet.
            </span>
          </li>
          <li>
            <b>Add your games and press play</b>
            <span>The emulator sets itself up the first time.</span>
          </li>
        </ol>
        <p className="modal-retry">
          Didn't start? <a href={url}>Try again</a>
        </p>
      </section>
    </div>
  );
}

export function Website() {
  const installer = useInstaller();
  const [platform] = useState(detectPlatform);
  const [downloaded, setDownloaded] = useState(false);
  const [open, setOpen] = useState<number | null>(0);
  const cta = (where: string, size?: "large" | "small") => (
    <DownloadButton
      installer={installer}
      platform={platform}
      where={where}
      size={size}
      onDownload={() => setDownloaded(true)}
    />
  );
  return (
    <div className="website">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="header-inner">
          <a className="brand-link" href="#" aria-label="OpenRetro home">
            <Brand />
          </a>
          <nav aria-label="Main">
            <a href="#how">How it works</a>
            <a href="#together">Play together</a>
            <a href="#faq">FAQ</a>
          </nav>
          <div className="header-actions">
            <a
              className="icon-link"
              href={REPO}
              target="_blank"
              rel="noreferrer"
              aria-label="OpenRetro on GitHub"
            >
              <Github size={19} />
            </a>
            {platform !== "mobile" && cta("header", "small")}
          </div>
        </div>
      </header>

      <main id="main">
        <section className="hero">
          <div className="hero-glow" aria-hidden="true" />
          <div className="page hero-inner">
            <div className="hero-copy">
              <span className="eyebrow">
                <span className="dot" /> Free and open source · Windows
              </span>
              <h1>
                Every retro game you own.
                <br />
                <span className="accent">One launcher. Press play.</span>
              </h1>
              <p className="lede">
                OpenRetro keeps your whole collection in one library, sets up
                the emulators for you, and lets friends join your game from
                their browser. From NES to PlayStation 3.
              </p>
              {cta("hero")}
              <ul className="trust">
                <li>
                  <Check size={15} /> No ads, ever
                </li>
                <li>
                  <Check size={15} /> No account needed to play
                </li>
                <li>
                  <Check size={15} /> Updates itself
                </li>
              </ul>
            </div>
            <ConsoleMockup />
          </div>
        </section>

        <section className="systems" aria-label="Supported systems">
          <p>Plays games from</p>
          <div className="marquee">
            <div className="marquee-track">
              {[...systems, ...systems].map((name, index) => (
                <span key={index} aria-hidden={index >= systems.length}>
                  {name}
                </span>
              ))}
            </div>
          </div>
        </section>

        <section className="page section" id="how">
          <header className="section-head">
            <span className="eyebrow">How it works</span>
            <h2>From download to playing in three steps.</h2>
            <p>
              No cores to hunt down, no config files, no mapping your controller
              for every emulator.
            </p>
          </header>
          <ol className="steps">
            <li>
              <span className="step-icon">
                <Download />
              </span>
              <h3>Install OpenRetro</h3>
              <p>One small installer. It keeps itself up to date.</p>
            </li>
            <li>
              <span className="step-icon">
                <FolderOpen />
              </span>
              <h3>Add your games</h3>
              <p>
                Point it at the folder where your games live. Covers and details
                show up on their own.
              </p>
            </li>
            <li>
              <span className="step-icon">
                <Play />
              </span>
              <h3>Press play</h3>
              <p>
                The right emulator downloads and configures itself. Grab a
                controller and go.
              </p>
            </li>
          </ol>
        </section>

        <section className="page section split">
          <div className="split-copy">
            <span className="eyebrow">
              <Monitor size={14} /> Console mode
            </span>
            <h2>Turn your PC into a console.</h2>
            <p>
              A full-screen library you drive with a controller, made for the
              couch and the TV. Pick a game, resume where you stopped, and never
              touch the mouse.
            </p>
            <ul className="checks">
              <li>
                <Check size={16} /> Navigate everything with a controller
              </li>
              <li>
                <Check size={16} /> Resume your last session in one press
              </li>
              <li>
                <Check size={16} /> Themes and wallpapers for your setup
              </li>
            </ul>
          </div>
          <div className="split-art covers-stack" aria-hidden="true">
            {["zelda", "crash", "mario-world", "castlevania", "tekken"].map(
              (cover, index) => (
                <img
                  key={cover}
                  src={`./art/${cover}.jpg`}
                  alt=""
                  loading="lazy"
                  style={{ "--n": index } as CSSProperties}
                />
              ),
            )}
          </div>
        </section>

        <section className="page section" id="together">
          <header className="section-head">
            <span className="eyebrow">Play together</span>
            <h2>Player 2 doesn't need to install anything.</h2>
            <p>The game runs on your PC. Everyone else just opens a link.</p>
          </header>
          <div className="together">
            <article className="together-card">
              <div className="together-art phone-art" aria-hidden="true">
                <span className="pc-link">
                  <Monitor size={54} strokeWidth={1.5} />
                  <i className="link-line">
                    <Wifi size={18} />
                  </i>
                </span>
                <div className="phone">
                  <img src="./art/mario-world.jpg" alt="" loading="lazy" />
                  <span className="dpad" />
                  <span className="buttons">
                    <i />
                    <i />
                  </span>
                </div>
              </div>
              <span className="card-icon">
                <Smartphone size={18} />
              </span>
              <h3>Your phone is a second screen</h3>
              <p>
                Scan a QR code and play on your phone over your Wi-Fi, with
                video, sound and touch controls. No app to install.
              </p>
            </article>
            <article className="together-card">
              <div className="together-art party-art" aria-hidden="true">
                <div className="party-screen">
                  <img src="./art/mario-kart.jpg" alt="" loading="lazy" />
                  <div className="party-chat">
                    <span>
                      <b>Ana (P2)</b> rematch?
                    </span>
                    <span>
                      <b>Leo (P3)</b> one more cup
                    </span>
                  </div>
                </div>
                <div className="party-seats">
                  <span className="seat p1">P1</span>
                  <span className="seat p2">P2</span>
                  <span className="seat p3">P3</span>
                  <span className="seat empty">+</span>
                </div>
              </div>
              <span className="card-icon">
                <Users size={18} />
              </span>
              <h3>Online Party with up to 4 players</h3>
              <p>
                Start a Party and send the link. Friends join from their browser
                with a keyboard or controller, and you can chat while you play.
              </p>
            </article>
          </div>
        </section>

        <section className="page section">
          <header className="section-head">
            <span className="eyebrow">And a lot more</span>
            <h2>Everything a retro collection needs.</h2>
          </header>
          <div className="extras">
            {extras.map((item) => (
              <article key={item.title}>
                <item.icon size={22} />
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="page section compare-section">
          <div className="compare">
            <div className="compare-col before">
              <h3>Setting up emulators yourself</h3>
              <ul>
                <li>A different emulator for every console</li>
                <li>Cores, BIOS folders and config files</li>
                <li>Map your controller again in each one</li>
                <li>Games scattered across folders</li>
              </ul>
            </div>
            <div className="compare-col after">
              <h3>
                <img src="./openretro.svg" alt="" width="22" height="22" />
                With OpenRetro
              </h3>
              <ul>
                <li>
                  <Check size={16} /> One app for every console
                </li>
                <li>
                  <Check size={16} /> Emulators set up automatically
                </li>
                <li>
                  <Check size={16} /> Your controller works everywhere
                </li>
                <li>
                  <Check size={16} /> One library with covers
                </li>
              </ul>
            </div>
          </div>
        </section>

        <section className="page section open-source">
          <ShieldCheck size={30} />
          <div>
            <h2>Open source, no catch.</h2>
            <p>
              No ads and no paid tier. Every line of
              code is public under the MIT license, so you can see exactly what
              you're installing.
            </p>
          </div>
          <a
            className="ghost"
            href={REPO}
            target="_blank"
            rel="noreferrer"
          >
            <Github size={17} /> View on GitHub
          </a>
        </section>

        <section className="page section faq" id="faq">
          <header className="section-head">
            <span className="eyebrow">FAQ</span>
            <h2>Questions before you download.</h2>
          </header>
          <div className="faq-list">
            {faqs.map((item, index) => (
              <div
                key={item.q}
                className={`faq-item ${open === index ? "open" : ""}`}
              >
                <button
                  aria-expanded={open === index}
                  aria-controls={`faq-${index}`}
                  onClick={() => setOpen(open === index ? null : index)}
                >
                  {item.q}
                  <ChevronDown size={18} />
                </button>
                <div id={`faq-${index}`} className="faq-answer" role="region">
                  <p>{item.a}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="final">
          <div className="hero-glow" aria-hidden="true" />
          <div className="page final-inner">
            <h2>Your classics are waiting.</h2>
            <p>Free, open source and ready in a couple of minutes.</p>
            {cta("footer")}
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <div className="page footer-inner">
          <div className="footer-brand">
            <Brand />
            <p>An independent, open-source launcher for classic games.</p>
          </div>
          <nav aria-label="Footer">
            <a href={installer.url}>Download</a>
            <a href={`${REPO}#readme`}>Documentation</a>
            <a href={`${REPO}/issues`}>Report a problem</a>
            <a href="./credits.html">Credits and licenses</a>
          </nav>
          <p className="footer-note">
            <Heart size={13} /> Game artwork belongs to its respective owners.
            OpenRetro doesn't include or distribute games.
          </p>
        </div>
      </footer>

      {platform === "mobile" && (
        <div className="mobile-bar">
          <span>
            <b>OpenRetro</b> for Windows · Free
          </span>
          <button
            onClick={() =>
              document
                .querySelector(".hero .cta")
                ?.scrollIntoView({ behavior: "smooth", block: "center" })
            }
          >
            Get it
          </button>
        </div>
      )}
      {downloaded && (
        <AfterDownload
          url={installer.url}
          onClose={() => setDownloaded(false)}
        />
      )}
    </div>
  );
}
