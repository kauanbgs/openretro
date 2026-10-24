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
  Library,
  Users,
  Save,
} from "lucide-react";
import { PixelLandscape } from "./PixelLandscape";

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
    detail: "Party pelo navegador",
    title: "O player 2 pode estar longe.",
    description:
      "Entre na sua conta, adicione seus amigos e abra um Party. Eles recebem imagem e áudio no navegador e participam com teclado ou controle. O jogo roda no seu PC.",
    caption: "Seus amigos entram na sua partida",
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
        <section className="landing-hero page-width">
          <div className="hero-content">
            <span className="hero-insert">
              <span className="status-dot live" /> OpenRetro para Windows
            </span>
            <h1>
              Seus clássicos,
              <br />
              em boa companhia.
            </h1>
            <p>
              A sua biblioteca no PC. Uma partida no celular. Um amigo no player
              2. Reúna seus jogos e encontre um novo jeito de voltar a eles.
            </p>
            <div className="hero-actions">
              <a className="pixel-button primary" href={DOWNLOAD}>
                <Download size={16} />
                Baixar OpenRetro
              </a>
              <a className="hero-resource-link" href="#recursos">
                Conhecer os recursos <ArrowDown size={15} />
              </a>
            </div>
            <div className="hero-footnote">
              Gratuito. Código aberto. Feito para jogar.
            </div>
          </div>
          <div className="adventure-art">
            <div className="adventure-frame">
              <div className="adventure-top">
                <span>
                  <i /> Uma nova partida
                </span>
                <span>J1 + J2</span>
              </div>
              <PixelLandscape />
              <div className="adventure-bottom">
                <span>É bom estar de volta.</span>
                <Gamepad2 size={20} />
              </div>
            </div>
            <div className="adventure-sticker">
              <Users size={16} />
              <span>
                Melhor com
                <br />
                companhia.
              </span>
            </div>
          </div>
        </section>

        <section className="play-section page-width" id="recursos">
          <div className="section-heading">
            <div>
              <span className="section-kicker">
                Do primeiro play à próxima fase
              </span>
              <h2>
                O que importa
                <br />é jogar.
              </h2>
            </div>
            <p>
              Seus jogos e seus amigos, por perto.
              <br />O OpenRetro cuida do caminho até a partida.
            </p>
          </div>
          <div className="feature-highlights">
            <article>
              <Library />
              <h3>Uma biblioteca sua</h3>
              <p>
                Organize seus jogos com capas, informações e favoritos. Perfis
                separados guardam o progresso de cada jogador.
              </p>
            </article>
            <article>
              <Smartphone />
              <h3>Mais uma tela para jogar</h3>
              <p>
                Leia o QR code e jogue no celular pela rede local, com imagem,
                áudio e controles de toque no navegador.
              </p>
            </article>
            <article>
              <Users />
              <h3>Chame o player 2</h3>
              <p>
                Abra um Party para seus amigos entrarem pelo navegador. A
                partida roda no seu PC e a diversão vai mais longe.
              </p>
            </article>
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
              <Save />
              <h3>Continue de onde parou</h3>
              <p>
                Retome a partida e gerencie seus saves nos cores compatíveis.
                Cada jogador tem seu próprio progresso.
              </p>
            </article>
            <article>
              <Download />
              <h3>Seu jeito de jogar</h3>
              <p>
                Emuladores integrados, fontes de download, traduções e mods.
                Prepare seus jogos dentro do próprio aplicativo.
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
              Gratuito e de código aberto. Jogue localmente sem conta.
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
