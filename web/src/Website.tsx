import { useState } from "react";
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
} from "lucide-react";

const REPO = "https://github.com/kauanbgs/openretro";
const DOWNLOAD = `${REPO}/releases/latest`;
const DOCS = `${REPO}#readme`;
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
const systems = [
  "NES",
  "Super Nintendo",
  "Game Boy",
  "Mega Drive",
  "PlayStation",
  "Nintendo 64",
  "Dreamcast",
  "PlayStation 2",
  "PSP",
  "PlayStation 3",
];
const devices = [
  {
    id: "pc",
    icon: Monitor,
    label: "No seu computador",
    detail: "Windows",
    title: "Ligue. Escolha. Jogue.",
    description:
      "Sua biblioteca em um só lugar, emuladores integrados e um menu que você controla sem sair do sofá.",
    caption: "Interface no estilo console",
    button: "Baixar para Windows",
  },
  {
    id: "phone",
    icon: Smartphone,
    label: "No seu celular",
    detail: "Pelo navegador",
    title: "Mais uma tela. Mais um jogador.",
    description:
      "Pareie o celular com o PC pelo QR code. Receba o jogo pela rede local e use os controles de toque para entrar na partida.",
    caption: "O jogo roda no seu PC",
    button: "Ver como funciona",
  },
  {
    id: "friends",
    icon: Gamepad2,
    label: "Com seus amigos",
    detail: "Online por VPN",
    title: "O player 2 pode estar longe.",
    description:
      "Crie uma partida e compartilhe o convite. Nos consoles compatíveis, cada pessoa roda o jogo no próprio PC pela VPN.",
    caption: "Mesmo jogo e core em cada PC",
    button: "Ver como funciona",
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
  const [device, setDevice] = useState(0);
  const [theme, setTheme] = useState(false);
  const selected = devices[device];
  return (
    <div className={`website ${theme ? "soft-screen" : ""}`}>
      <a className="skip-link" href="#main">
        Pular para o conteúdo
      </a>
      <header className="site-header">
        <div className="header-inner">
          <a className="brand-link" href="#" aria-label="OpenRetro início">
            <Brand />
            <span className="version-tag">Projeto aberto</span>
          </a>
          <nav aria-label="Principal">
            <a href="#recursos">Recursos</a>
            <a href="#dispositivos">Dispositivos</a>
            <a href="#projeto">Projeto</a>
          </nav>
          <div className="header-links">
            <button
              onClick={() => setTheme((v) => !v)}
              aria-label="Alternar brilho da tela"
              title="Alternar brilho da tela"
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
        <section className="landing-hero">
          <div className="cover-wall" aria-hidden="true">
            {[...covers, ...covers, ...covers].map((cover, i) => (
              <img
                key={i}
                src={`./art/${cover}.jpg`}
                alt=""
                fetchPriority={i < 11 ? "high" : "auto"}
              />
            ))}
          </div>
          <div className="hero-shade" />
          <div className="hero-content">
            <span className="hero-insert">
              <span className="status-dot live" /> Pronto para o próximo play
            </span>
            <h1>
              Sua coleção.
              <br />
              Seu próximo play.
            </h1>
            <p>
              Os jogos que marcaram você. Um lugar para voltar.
              <br className="desktop-break" /> Organize sua biblioteca, conecte
              o controle e dê o play com o OpenRetro.
            </p>
            <div className="hero-actions">
              <a className="pixel-button primary" href={DOWNLOAD}>
                <Download size={16} />
                Baixar OpenRetro
              </a>
            </div>
            <div className="hero-footnote">
              Gratuito e de código aberto <span>✦</span> Para Windows
            </div>
          </div>
          <a
            className="hero-scroll"
            href="#recursos"
            aria-label="Explorar recursos"
          >
            <ArrowDown size={16} />
          </a>
        </section>
        <section className="system-strip" aria-label="Consoles no aplicativo">
          <div className="strip-label">
            <span>Uma casa para seus clássicos</span>
            <span>Consoles, portáteis e boas memórias</span>
          </div>
          <div className="systems">
            {systems.map((system, i) => (
              <div key={system}>
                <PixelConsole kind={i % 4} />
                <span>{system}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="play-section page-width" id="recursos">
          <div className="section-heading">
            <div>
              <span className="section-kicker">
                Menos configuração. Mais jogo.
              </span>
              <h2>
                O controle está
                <br />
                na sua mão.
              </h2>
            </div>
            <p>
              Da sua coleção ao primeiro comando.
              <br />
              Tudo no mesmo lugar, com a cara de um console.
            </p>
          </div>
          <div className="product-preview">
            <div className="preview-toolbar">
              <Brand />
              <span>
                <Gamepad2 size={14} /> Modo console
              </span>
              <span className="preview-clock">20:42</span>
            </div>
            <div className="preview-scene">
              <img
                src="./art/mario-kart-scene.png"
                alt="Super Mario Kart no Super Nintendo"
              />
              <div className="preview-gradient" />
              <div className="preview-copy">
                <span>Super Nintendo</span>
                <h3>Super Mario Kart</h3>
                <p>Seu próximo play começa na linha de largada.</p>
                <a className="pixel-button primary compact" href={DOWNLOAD}>
                  <Download size={13} />
                  Baixar OpenRetro
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
                <kbd>→</kbd> Navegar
              </span>
              <span>
                <kbd>Enter</kbd> Escolher
              </span>
              <span>Modo console</span>
            </div>
          </div>
          <div className="feature-notes">
            <article>
              <Gamepad2 />
              <h3>Do jeito de um console</h3>
              <p>
                Biblioteca em tela cheia e navegação por controle. Escolha o
                jogo e continue de onde parou nos cores compatíveis.
              </p>
            </article>
            <article>
              <Smartphone />
              <h3>O celular entra na partida</h3>
              <p>
                Conecte pela rede local para receber imagem, áudio e controles
                de toque direto no navegador.
              </p>
            </article>
            <article>
              <Heart />
              <h3>Sua coleção, bem cuidada</h3>
              <p>
                Capas, informações, favoritos e perfis de jogadores. Cada
                clássico encontra seu lugar.
              </p>
            </article>
          </div>
        </section>

        <section className="device-section page-width" id="dispositivos">
          <div className="section-heading">
            <div>
              <span className="section-kicker">Seu jogo vai com você</span>
              <h2>
                Uma biblioteca.
                <br />
                Mais jeitos de jogar.
              </h2>
            </div>
          </div>
          <div className="device-panel">
            <div
              className="device-tabs"
              role="tablist"
              aria-label="Jeitos de jogar"
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
                Sempre tem espaço
                <br />
                para mais um play.
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
                      <span>Partida entre amigos</span>
                      <b>Convite pronto</b>
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
                href={device === 0 ? DOWNLOAD : DOCS}
              >
                {selected.button}
                <ExternalLink size={13} />
              </a>
            </div>
            <footer>
              <span>↑ ↓ Escolher dispositivo</span>
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
            <span className="section-kicker">Pronto em poucos minutos</span>
            <h2>
              Um play vale
              <br />
              mais que mil palavras.
            </h2>
            <p>
              Baixe o OpenRetro, aponte para a sua coleção e conecte o controle.
              <br />
              Gratuito, de código aberto e sem conta.
            </p>
            <a className="pixel-button primary" href={DOWNLOAD}>
              <Download size={15} />
              Baixar para Windows
            </a>
          </div>
          <div className="callout-cover">
            <img
              src="./art/mario-kart.jpg"
              alt="Capa de Super Mario Kart"
              loading="lazy"
            />
            <span>Super Mario Kart / SNES</span>
          </div>
        </section>
        <section className="community" id="projeto">
          <Glyphs />
          <span className="section-kicker">Feito para quem gosta de jogar</span>
          <h2>
            O próximo capítulo
            <br />
            também pode ser seu.
          </h2>
          <p>
            OpenRetro é um projeto aberto.
            <br />
            Traga suas ideias, conte o que faltou ou ajude a construir.
          </p>
          <div className="hero-actions">
            <a
              className="pixel-button primary"
              href={`${REPO}/issues`}
              target="_blank"
              rel="noreferrer"
            >
              <Heart size={15} />
              Compartilhar uma ideia
            </a>
            <a
              className="pixel-button"
              href={REPO}
              target="_blank"
              rel="noreferrer"
            >
              <Github size={16} />
              Ver o projeto
            </a>
          </div>
        </section>
      </main>
      <footer className="site-footer page-width">
        <div>
          <Brand />
          <p>
            Os clássicos continuam.
            <br />O próximo play é seu.
          </p>
        </div>
        <div>
          <h3>OpenRetro</h3>
          <a href={DOWNLOAD}>Baixar aplicativo</a>
          <a href={DOCS}>Documentação</a>
        </div>
        <div>
          <h3>Projeto</h3>
          <a href={REPO}>GitHub</a>
          <a href={`${REPO}/issues`}>Reportar um problema</a>
          <a href="./credits.html">Créditos e licenças</a>
        </div>
        <div className="footer-bottom">
          <span>OpenRetro · Projeto independente de código aberto</span>
          <span>Ilustrações de jogos pertencem aos respectivos titulares.</span>
        </div>
      </footer>
    </div>
  );
}

function PixelConsole({ kind }: { kind: number }) {
  return (
    <svg viewBox="0 0 48 32" aria-hidden="true" shapeRendering="crispEdges">
      {kind === 0 ? (
        <>
          <path fill="#797583" d="M4 9h40v18H4z" />
          <path fill="#c4bec4" d="M4 7h40v12H4z" />
          <path fill="#393944" d="M25 7h13v20H25z" />
          <path fill="#b1a0e5" d="M8 21h10v3H8z" />
          <path fill="#b14d65" d="M30 21h4v3h-4z" />
        </>
      ) : kind === 1 ? (
        <>
          <path fill="#afa7b9" d="M5 10h38v18H5zM9 6h30v4H9z" />
          <path fill="#777082" d="M14 6h20v10H14zM9 22h10v3H9z" />
          <path fill="#a896ff" d="M31 21h5v4h-5z" />
        </>
      ) : kind === 2 ? (
        <>
          <path fill="#bdb9ad" d="M13 1h23v28H13zM13 29h18v2H13z" />
          <path fill="#525462" d="M16 4h17v13H16z" />
          <path fill="#8fa792" d="M19 7h11v7H19z" />
          <path fill="#54515f" d="M17 22h9v3h-9zM20 19h3v9h-3z" />
          <path fill="#b55c80" d="M29 20h3v3h-3zM32 24h3v3h-3z" />
        </>
      ) : (
        <>
          <path fill="#6e6b78" d="M8 6h32v23H8z" />
          <path fill="#aaa3b1" d="M8 6h32v16H8z" />
          <path fill="#595563" d="M15 9h19v10H15z" />
          <path fill="#8f83b7" d="M5 8h3v13H5zM40 8h3v13h-3z" />
          <path fill="#b4dbce" d="M29 24h4v2h-4z" />
        </>
      )}
    </svg>
  );
}
