import { useEffect, useState } from "react";
import {
  ArrowDown,
  Check,
  ChevronRight,
  Download,
  ExternalLink,
  Gamepad2,
  Github,
  Heart,
  Monitor,
  Smartphone,
  Library,
  Users,
  Save,
} from "lucide-react";
import { PixelLandscape } from "./PixelLandscape";

const REPO = "https://github.com/kauanbgs/openretro";
// Stable asset name published with every release; used until the API answers.
const DOWNLOAD_FALLBACK = `${REPO}/releases/latest/download/OpenRetro-Setup.exe`;
const LATEST_RELEASE_API =
  "https://api.github.com/repos/kauanbgs/openretro/releases/latest";
const DOCS = `${REPO}#readme`;

// Resolves the latest Windows installer so the button downloads it directly.
function useInstallerUrl() {
  const [url, setUrl] = useState(DOWNLOAD_FALLBACK);
  useEffect(() => {
    const controller = new AbortController();
    fetch(LATEST_RELEASE_API, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then(
        (
          release: {
            assets?: { name: string; browser_download_url: string }[];
          } | null,
        ) => {
          const installer = release?.assets?.find((asset) =>
            /_x64-setup\.exe$/i.test(asset.name),
          );
          if (installer) setUrl(installer.browser_download_url);
        },
      )
      .catch(() => {});
    return () => controller.abort();
  }, []);
  return url;
}
const covers = [
  "mario-world",
  "zelda",
  "crash",
  "chrono-trigger",
  "metroid",
  "mario-kart",
  "donkey-kong",
  "castlevania",
  "tekken",
  "sonic",
  "final-fantasy",
];
const devices = [
  {
    id: "pc",
    icon: Monitor,
    label: "On your computer",
    detail: "Windows",
    title: "Turn it on. Pick. Play.",
    description:
      "Your whole library in one place, built-in emulators and a menu you can drive without leaving the couch.",
    caption: "Console-style interface",
    button: "Download for Windows",
  },
  {
    id: "phone",
    icon: Smartphone,
    label: "On your phone",
    detail: "In the browser",
    title: "One more screen. One more player.",
    description:
      "Pair your phone with your PC using a QR code. Stream the game over your local network and jump in with touch controls.",
    caption: "The game runs on your PC",
    button: "See how it works",
  },
  {
    id: "friends",
    icon: Gamepad2,
    label: "With your friends",
    detail: "Party in the browser",
    title: "Player 2 can be far away.",
    description:
      "Sign in, add your friends and start a Party. They get video and audio in their browser and play along with a keyboard or controller. The game runs on your PC.",
    caption: "Your friends join your game",
    button: "See how it works",
  },
];

function Brand() {
  return (
    <span className="web-brand">
      <img src="./openretro.svg" alt="" />
      <span>OpenRetro</span>
    </span>
  );
}
function Glyphs() {
  return (
    <div className="pixel-glyphs" aria-hidden="true">
      {Array.from({ length: 22 }, (_, index) => (
        <i
          key={index}
          style={{
            left: `${(index * 37 + 7) % 100}%`,
            top: `${(index * 19 + 11) % 100}%`,
          }}
        >
          {["+", "×", "□", "○"][index % 4]}
        </i>
      ))}
    </div>
  );
}

export function Website() {
  const installerUrl = useInstallerUrl();
  const [device, setDevice] = useState(0);
  const [theme, setTheme] = useState(false);
  const selected = devices[device];
  return (
    <div className={`website ${theme ? "soft-screen" : ""}`}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <div className="header-inner">
          <a className="brand-link" href="#" aria-label="OpenRetro home">
            <Brand />
            <span className="version-tag">Open project</span>
          </a>
          <nav aria-label="Main">
            <a href="#features">Features</a>
            <a href="#devices">Devices</a>
            <a href="#project">Project</a>
          </nav>
          <div className="header-links">
            <button
              onClick={() => setTheme((v) => !v)}
              aria-label="Toggle screen brightness"
              title="Toggle screen brightness"
            >
              <span aria-hidden="true">☼</span>
            </button>
            <a href={REPO} target="_blank" rel="noreferrer" aria-label="GitHub">
              <Github size={18} />
            </a>
          </div>
        </div>
      </header>
      <main id="main">
        <section className="landing-hero page-width">
          <div className="hero-content">
            <span className="hero-insert">
              <span className="status-dot live" /> OpenRetro for Windows
            </span>
            <h1>
              Your classics,
              <br />
              in good company.
            </h1>
            <p>
              Your library on your PC. A round on your phone. A friend as player
              2. Bring your games together and find a new way back to them.
            </p>
            <div className="hero-actions">
              <a className="pixel-button primary" href={installerUrl}>
                <Download size={16} />
                Download OpenRetro
              </a>
              <a className="hero-resource-link" href="#features">
                Explore the features <ArrowDown size={15} />
              </a>
            </div>
            <div className="hero-footnote">
              Free. Open source. Made for playing.
            </div>
          </div>
          <div className="adventure-art">
            <div className="adventure-frame">
              <div className="adventure-top">
                <span>
                  <i /> A new game
                </span>
                <span>P1 + P2</span>
              </div>
              <PixelLandscape />
              <div className="adventure-bottom">
                <span>Good to be back.</span>
                <Gamepad2 size={20} />
              </div>
            </div>
            <div className="adventure-sticker">
              <Users size={16} />
              <span>
                Better with
                <br />
                company.
              </span>
            </div>
          </div>
        </section>

        <section className="play-section page-width" id="features">
          <div className="section-heading">
            <div>
              <span className="section-kicker">
                From the first play to the next level
              </span>
              <h2>
                What matters
                <br />is playing.
              </h2>
            </div>
            <p>
              Your games and your friends, close by.
              <br />OpenRetro takes care of getting you into the game.
            </p>
          </div>
          <div className="feature-highlights">
            <article>
              <Library />
              <h3>A library of your own</h3>
              <p>
                Organize your games with covers, details and favorites. Separate
                profiles keep each player's progress.
              </p>
            </article>
            <article>
              <Smartphone />
              <h3>One more screen to play on</h3>
              <p>
                Scan the QR code and play on your phone over your local network,
                with video, audio and touch controls in the browser.
              </p>
            </article>
            <article>
              <Users />
              <h3>Call in player 2</h3>
              <p>
                Start a Party so your friends can join from their browser. The
                game runs on your PC and the fun goes further.
              </p>
            </article>
          </div>
          <div className="product-preview">
            <div className="preview-toolbar">
              <Brand />
              <span>
                <Gamepad2 size={14} /> Console mode
              </span>
              <span className="preview-clock">20:42</span>
            </div>
            <div className="preview-scene">
              <img
                src="./art/mario-kart-scene.png"
                alt="Super Mario Kart on the Super Nintendo"
              />
              <div className="preview-gradient" />
              <div className="preview-copy">
                <span>Super Nintendo</span>
                <h3>Super Mario Kart</h3>
                <p>Your next play starts at the starting line.</p>
                <a className="pixel-button primary compact" href={installerUrl}>
                  <Download size={13} />
                  Download OpenRetro
                </a>
              </div>
            </div>
            <div className="preview-shelf">
              {[
                "mario-kart",
                "mario-world",
                "donkey-kong",
                "metroid",
                "chrono-trigger",
              ].map((cover, i) => (
                <span key={cover} className={i === 0 ? "active" : ""}>
                  <img src={`./art/${cover}.jpg`} alt="" loading="lazy" />
                </span>
              ))}
            </div>
            <div className="preview-bottom">
              <span>
                <kbd>←</kbd>
                <kbd>→</kbd> Navigate
              </span>
              <span>
                <kbd>Enter</kbd> Select
              </span>
              <span>Console mode</span>
            </div>
          </div>
          <div className="feature-notes">
            <article>
              <Gamepad2 />
              <h3>Just like a console</h3>
              <p>
                A full-screen library with controller navigation. Pick a game
                and pick up where you left off on supported cores.
              </p>
            </article>
            <article>
              <Save />
              <h3>Pick up where you left off</h3>
              <p>
                Resume your game and manage your saves on supported cores.
                Every player keeps their own progress.
              </p>
            </article>
            <article>
              <Download />
              <h3>Play your way</h3>
              <p>
                Built-in emulators, download sources, translations and mods.
                Get your games ready right inside the app.
              </p>
            </article>
          </div>
        </section>

        <section className="device-section page-width" id="devices">
          <div className="section-heading">
            <div>
              <span className="section-kicker">Your game goes with you</span>
              <h2>
                One library.
                <br />
                More ways to play.
              </h2>
            </div>
          </div>
          <div className="device-panel">
            <div
              className="device-tabs"
              role="tablist"
              aria-label="Ways to play"
              aria-orientation="vertical"
            >
              {devices.map((item, index) => (
                <button
                  key={item.id}
                  role="tab"
                  id={`tab-${item.id}`}
                  aria-selected={device === index}
                  aria-controls="device-content"
                  tabIndex={device === index ? 0 : -1}
                  onClick={() => setDevice(index)}
                  onKeyDown={(e) => {
                    if (
                      ["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)
                    ) {
                      e.preventDefault();
                      const next =
                        e.key === "Home"
                          ? 0
                          : e.key === "End"
                            ? devices.length - 1
                            : (device +
                                (e.key === "ArrowDown" ? 1 : -1) +
                                devices.length) %
                              devices.length;
                      setDevice(next);
                      document
                        .getElementById(`tab-${devices[next].id}`)
                        ?.focus();
                    }
                  }}
                >
                  <item.icon size={25} />
                  <span>
                    {item.label}
                    <small>{item.detail}</small>
                  </span>
                  <ChevronRight size={15} />
                </button>
              ))}
              <span className="device-empty">
                There's always room
                <br />
                for one more player.
              </span>
            </div>
            <div
              className={`device-illustration device-${selected.id}`}
              aria-hidden="true"
            >
              <div className="device-window">
                <div className="window-bar">
                  <i />
                  <i />
                  <i />
                  <span>OpenRetro / {selected.id}</span>
                </div>
                <div className="mini-screen">
                  <img src="./art/mario-kart-scene.png" alt="" loading="lazy" />
                  {selected.id === "phone" && (
                    <div className="phone-frame">
                      <img src="./art/mario-kart-scene.png" alt="" />
                      <span>
                        ✚<i>● ●</i>
                      </span>
                    </div>
                  )}
                  {selected.id === "friends" && (
                    <div className="invite-card">
                      <Gamepad2 size={27} />
                      <span>Game with friends</span>
                      <b>Invite ready</b>
                      <Check size={18} />
                    </div>
                  )}
                </div>
                <div className="mini-covers">
                  {covers.slice(0, 4).map((c) => (
                    <img src={`./art/${c}.jpg`} key={c} alt="" loading="lazy" />
                  ))}
                </div>
              </div>
            </div>
            <div
              className="device-description"
              role="tabpanel"
              id="device-content"
              aria-labelledby={`tab-${selected.id}`}
            >
              <span className="outline-tag">{selected.caption}</span>
              <h3>{selected.title}</h3>
              <p>{selected.description}</p>
              <a
                className="pixel-button primary compact"
                href={device === 0 ? installerUrl : DOCS}
              >
                {selected.button}
                <ExternalLink size={13} />
              </a>
            </div>
            <footer>
              <span>↑ ↓ Choose device</span>
              <span>
                {device + 1} / {devices.length}
              </span>
            </footer>
          </div>
        </section>
        <section className="download-callout page-width">
          <div className="callout-car" aria-hidden="true">
            🏁
          </div>
          <div>
            <span className="section-kicker">Ready in a few minutes</span>
            <h2>
              One play is worth
              <br />
              a thousand words.
            </h2>
            <p>
              Download OpenRetro, point it at your collection and plug in your controller.
              <br />
              Free and open source. Play locally without an account.
            </p>
            <a className="pixel-button primary" href={installerUrl}>
              <Download size={15} />
              Download for Windows
            </a>
          </div>
          <div className="callout-cover">
            <img
              src="./art/mario-kart.jpg"
              alt="Super Mario Kart cover"
              loading="lazy"
            />
            <span>Super Mario Kart / SNES</span>
          </div>
        </section>
        <section className="community" id="project">
          <Glyphs />
          <span className="section-kicker">Made for people who love to play</span>
          <h2>
            The next chapter
            <br />
            could be yours too.
          </h2>
          <p>
            OpenRetro is an open project.
            <br />
            Bring your ideas, tell us what's missing or help build it.
          </p>
          <div className="hero-actions">
            <a
              className="pixel-button primary"
              href={`${REPO}/issues`}
              target="_blank"
              rel="noreferrer"
            >
              <Heart size={15} />
              Share an idea
            </a>
            <a
              className="pixel-button"
              href={REPO}
              target="_blank"
              rel="noreferrer"
            >
              <Github size={16} />
              View the project
            </a>
          </div>
        </section>
      </main>
      <footer className="site-footer page-width">
        <div>
          <Brand />
          <p>
            The classics live on.
            <br />The next play is yours.
          </p>
        </div>
        <div>
          <h3>OpenRetro</h3>
          <a href={installerUrl}>Download the app</a>
          <a href={DOCS}>Documentation</a>
        </div>
        <div>
          <h3>Project</h3>
          <a href={REPO}>GitHub</a>
          <a href={`${REPO}/issues`}>Report a problem</a>
          <a href="./credits.html">Credits and licenses</a>
        </div>
        <div className="footer-bottom">
          <span>OpenRetro · Independent open-source project</span>
          <span>Game artwork belongs to its respective owners.</span>
        </div>
      </footer>
    </div>
  );
}
