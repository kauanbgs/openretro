// The web build's welcome on the first visit: a wide window with a stage that
// changes per step (the app's pixel night, a fan of cartridges, a controller
// with the real keys, a friends list) and a quiet text column beside it.
// "Como jogar" in the status bar opens it again.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { BrandMark } from "../../components/Brand";
import { PixelLandscape } from "../../components/PixelLandscape";
import { GameArtwork } from "../../components/GameArtwork";
import { AccountAvatar } from "../social/accountAvatars";
import { platformById } from "../../db/platforms";
import type { LibraryGame } from "../../types";
import { t } from "../../i18n";
import { WEB_ONBOARDING_KEY } from "../../services/webPlay";
import "./WebOnboarding.css";

const markSeen = () => {
  try {
    localStorage.setItem(WEB_ONBOARDING_KEY, "1");
  } catch {
    /* Private mode: it shows again next time, which is harmless. */
  }
};

interface Step {
  stage: ReactNode;
  heading: string;
  text: string;
}

export function WebOnboarding({
  library,
  signedIn,
  onSignIn,
  onClose,
}: {
  library: LibraryGame[];
  signedIn: boolean;
  /** Opens the account panel to sign in or create an account. */
  onSignIn: () => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);
  const covers = library.filter((x) => x.game.coverUrl).slice(0, 5);
  const consoles = [...new Set(library.map((x) => x.game.platformId))]
    .map((id) => platformById(id)?.shortName ?? id)
    .join(", ");
  const finish = (signIn: boolean) => {
    markSeen();
    onClose();
    if (signIn) onSignIn();
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  // A dialog of its own: Escape closes it, Tab stays inside, and the page
  // behind does not scroll.
  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finishRef.current(false);
      } else if (event.key === "Tab") {
        const nodes = [
          ...element.querySelectorAll<HTMLElement>("button:not(:disabled)"),
        ];
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  const steps: Step[] = [
    {
      stage: (
        <div className="ob-stage ob-night">
          <div className="ob-logo">
            <BrandMark />
            <span>OpenRetro</span>
          </div>
        </div>
      ),
      heading: t("Seus clássicos, direto no navegador"),
      text: t(
        "Esta é a versão web do OpenRetro, com a mesma cara do aplicativo. Não precisa instalar nada: escolha um jogo e aperte Jogar.",
      ),
    },
    {
      stage: (
        <div className="ob-stage ob-shelf">
          {covers.map(({ game, item }, i) => (
            // The first game takes the middle; the rest open out from it.
            <div className="ob-cart" data-pos={i} key={item.id}>
              <GameArtwork game={game} hero loading="eager" />
              <span>{platformById(game.platformId)?.shortName}</span>
            </div>
          ))}
        </div>
      ),
      heading: t("{count} jogos para começar", { count: library.length }),
      text: t(
        "Jogos de {consoles} feitos por fãs, que os próprios autores liberaram para todo mundo jogar. Na Biblioteca você filtra por console e guarda os favoritos.",
        { consoles: consoles || "GB, GBA, NES" },
      ),
    },
    {
      stage: (
        <div className="ob-stage ob-pad-stage">
          <Controller />
        </div>
      ),
      heading: t("Teclado ou controle"),
      text: t(
        "As teclas estão nos botões ao lado. Um controle USB ou Bluetooth funciona assim que você aperta um botão. Para trocar as teclas, abra o menu do jogo e escolha Configurações do controle.",
      ),
    },
    {
      stage: (
        <div className="ob-stage ob-friends-stage">
          <FriendsPreview games={library.map((x) => x.game.title)} />
        </div>
      ),
      heading: signedIn ? t("Tudo pronto para jogar") : t("Entre para jogar"),
      text: signedIn
        ? t(
            "Você já está na sua conta. Seus amigos veem quando você joga, aqui ou no aplicativo, e podem mandar mensagem.",
          )
        : t(
            "Jogar no navegador pede uma conta, a mesma do aplicativo. Não tem senha: você recebe um código no e-mail. Com ela você vê o que seus amigos estão jogando e conversa com eles.",
          ),
    },
  ];
  const current = steps[step];
  const last = step === steps.length - 1;

  return (
    <div className="ob-backdrop">
      <div
        className="ob-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ob-heading"
        aria-describedby="ob-text"
        ref={dialog}
      >
        <div className="ob-stage-frame">
          {/* One night behind every step: clear on the first, dim after. */}
          <div className={`ob-scenery ${step === 0 ? "clear" : "dim"}`}>
            <PixelLandscape />
          </div>
          <div className="ob-stage-slot" key={step}>
            {current.stage}
          </div>
        </div>
        <div className="ob-copy">
          <div className="ob-top">
            <div
              className="ob-progress"
              role="progressbar"
              aria-valuemin={1}
              aria-valuemax={steps.length}
              aria-valuenow={step + 1}
              aria-label={t("Passo {step} de {total}", {
                step: step + 1,
                total: steps.length,
              })}
            >
              {steps.map((_, i) => (
                <i key={i} className={i <= step ? "done" : ""} />
              ))}
            </div>
            <button
              className="ob-close"
              aria-label={t("Fechar")}
              onClick={() => finish(false)}
            >
              <X size={18} />
            </button>
          </div>
          <div className="ob-text" key={`text-${step}`}>
            <h2 id="ob-heading">{current.heading}</h2>
            <p id="ob-text">{current.text}</p>
          </div>
          <div className="ob-actions">
            {step > 0 ? (
              <button className="ob-back" onClick={() => setStep(step - 1)}>
                {t("Voltar")}
              </button>
            ) : (
              <button className="ob-back" onClick={() => finish(false)}>
                {t("Pular")}
              </button>
            )}
            {!last ? (
              <button
                className="button primary ob-next"
                onClick={() => setStep(step + 1)}
                autoFocus
              >
                {t("Continuar")}
              </button>
            ) : signedIn ? (
              <button
                className="button primary ob-next"
                onClick={() => finish(false)}
                autoFocus
              >
                {t("Começar a jogar")}
              </button>
            ) : (
              <div className="ob-final">
                <button className="ob-back" onClick={() => finish(false)}>
                  {t("Agora não")}
                </button>
                <button
                  className="button primary ob-next"
                  onClick={() => finish(true)}
                  autoFocus
                >
                  {t("Criar conta ou entrar")}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A handheld-style pad with EmulatorJS's default keys printed on it. */
function Controller() {
  return (
    <figure
      className="ob-pad"
      aria-label={t(
        "Setas: direcional. Z: botão A. X: botão B. Enter: Start. V: Select. Q e E: L e R.",
      )}
    >
      <div className="ob-shoulder left">
        <kbd>Q</kbd>
        <span>L</span>
      </div>
      <div className="ob-shoulder right">
        <span>R</span>
        <kbd>E</kbd>
      </div>
      <div className="ob-pad-body">
        <div className="ob-dpad" aria-hidden="true">
          <kbd className="up">↑</kbd>
          <kbd className="left">←</kbd>
          <i />
          <kbd className="right">→</kbd>
          <kbd className="down">↓</kbd>
        </div>
        <div className="ob-face" aria-hidden="true">
          <div className="ob-face-button b">
            <kbd>X</kbd>
            <span>B</span>
          </div>
          <div className="ob-face-button a">
            <kbd>Z</kbd>
            <span>A</span>
          </div>
        </div>
        <div className="ob-menu" aria-hidden="true">
          <div>
            <kbd>V</kbd>
            <span>Select</span>
          </div>
          <div>
            <kbd>Enter</kbd>
            <span>Start</span>
          </div>
        </div>
      </div>
    </figure>
  );
}

/** What the account brings, drawn like the app's friends panel. */
function FriendsPreview({ games }: { games: string[] }) {
  const pick = (i: number, fallback: string) => games[i] ?? fallback;
  const friends = [
    {
      name: "Lia",
      avatar: 4,
      status: "playing" as const,
      line: pick(1, "Apotris"),
    },
    { name: "Davi", avatar: 9, status: "online" as const, line: t("Online") },
    {
      name: "Bruna",
      avatar: 12,
      status: "playing" as const,
      line: pick(3, "Nova the Squirrel"),
    },
  ];
  return (
    <div className="ob-friends" aria-hidden="true">
      {friends.map((friend) => (
        <div className="ob-friend" key={friend.name}>
          <AccountAvatar
            avatar={friend.avatar}
            size={38}
            status={friend.status}
          />
          <div>
            <strong>{friend.name}</strong>
            <small className={friend.status === "playing" ? "playing" : ""}>
              {friend.status === "playing"
                ? t("Jogando {title}", { title: friend.line })
                : friend.line}
            </small>
          </div>
        </div>
      ))}
      <div className="ob-bubble">{t("Bora jogar uma partida?")}</div>
    </div>
  );
}
