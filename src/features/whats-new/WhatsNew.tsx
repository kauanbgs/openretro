import { useState, useSyncExternalStore } from "react";
import { Modal } from "../../components/Modal";
import { BrandMark } from "../../components/Brand";
import { PixelLandscape } from "../../components/PixelLandscape";
import { socialStore } from "../../services/social";
import { language, locale, t } from "../../i18n";
import {
  releaseHistory,
  releaseNoteFor,
  type BannerPanel,
  type ReleaseNote,
} from "./releaseNotes";
import "./WhatsNew.css";

const STORAGE_KEY = "openretro-whats-new-seen";

function seen() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
function markSeen(version: string) {
  try {
    localStorage.setItem(STORAGE_KEY, version);
  } catch {
    // Without storage it shows again next time; nothing else depends on it.
  }
}

const text = (value: { pt: string; en: string; es: string }) =>
  language === "en" ? value.en : language === "es" ? value.es : value.pt;

/** The version's news, once, the first time it opens. */
export function WhatsNew({
  version: installed,
  show = false,
  onHide,
}: {
  version: string;
  /** Opens the window on request, such as from the version in the status bar. */
  show?: boolean;
  onHide?: () => void;
}) {
  // In development, ?whats-new=1.0.0 previews any version's window.
  const preview = import.meta.env.DEV
    ? new URLSearchParams(location.search).get("whats-new")
    : null;
  const version = preview || installed;
  const found = releaseNoteFor(version);
  const note = found?.note;
  const [open, setOpen] = useState(
    () => Boolean(note) && (Boolean(preview) || seen() !== version),
  );
  if (show) {
    const history = releaseHistory(version);
    if (history.length)
      return <WhatsNewDialog history={history} onClose={() => onHide?.()} />;
  }
  if (!found || !note || !open) return null;
  const close = () => {
    if (!preview) markSeen(version);
    setOpen(false);
    onHide?.();
  };
  return <WhatsNewDialog version={found.version} note={note} onClose={close} />;
}

export function WhatsNewDialog({
  version: firstVersion,
  note: firstNote,
  history,
  onClose,
}: {
  version?: string;
  note?: ReleaseNote;
  /** Every version, newest first: the window then lets the player pick one. */
  history?: { version: string; note: ReleaseNote }[];
  onClose: () => void;
}) {
  const [picked, setPicked] = useState(history?.[0]?.version);
  const entry =
    history?.find((item) => item.version === picked) ?? history?.[0];
  const version = entry?.version ?? firstVersion!;
  const note = entry?.note ?? firstNote!;
  const social = useSyncExternalStore(
    socialStore.subscribe,
    socialStore.snapshot,
  );
  const name = social.session.hasSession
    ? social.session.user?.displayName
    : null;
  const date = new Date(`${note.date}T12:00:00`).toLocaleDateString(locale(), {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const [greeting, ...paragraphs] = note.body;
  return (
    <Modal
      title={
        history
          ? t("Novidades do OpenRetro")
          : name
            ? t("Bem-vindo de volta, {name}!", { name })
            : t("Que bom ter você aqui!")
      }
      subtitle={t("Veja o que chegou na versão {version} do OpenRetro.", {
        version: version.replace(/\.0$/, ""),
      })}
      onClose={onClose}
      className="whats-new"
    >
      <div className="whats-new-body">
        {history && history.length > 1 && (
          <div
            className="whats-new-versions"
            role="tablist"
            aria-label={t("Versões")}
          >
            {history.map((item) => (
              <button
                key={item.version}
                role="tab"
                aria-selected={item.version === version}
                onClick={() => setPicked(item.version)}
              >
                {item.version.replace(/\.0$/, "")}
              </button>
            ))}
          </div>
        )}
        <time className="whats-new-date" dateTime={note.date}>
          {date}
        </time>
        <h3>{text(note.title)}</h3>
        {note.banner.length > 0 && (
          <figure className="whats-new-banner">
            {note.banner.map((panel) => (
              <Panel key={panel.lead.pt + panel.strong.pt} panel={panel} />
            ))}
          </figure>
        )}
        <div className="whats-new-text">
          {greeting && <p className="whats-new-greeting">{text(greeting)}</p>}
          {paragraphs.map((paragraph) => (
            <p key={paragraph.pt}>{text(paragraph)}</p>
          ))}
          {note.highlights.length > 0 && (
            <ul>
              {note.highlights.map((item) => (
                <li key={item.title.pt}>
                  <strong>{text(item.title)}:</strong> {text(item.text)}
                </li>
              ))}
            </ul>
          )}
          {note.closing && <p>{text(note.closing)}</p>}
        </div>
        <div className="whats-new-action">
          <button className="button secondary" onClick={onClose} autoFocus>
            {history ? t("Fechar") : t("Começar a jogar")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Panel({ panel }: { panel: BannerPanel }) {
  return (
    <div className="whats-new-panel">
      <div className={`whats-new-panel-art ${panel.art}`}>
        {panel.art === "logo" ? (
          <>
            <BrandMark />
            <span>OpenRetro</span>
          </>
        ) : panel.art === "landscape" ? (
          <PixelLandscape />
        ) : (
          <img src={panel.art} alt="" />
        )}
      </div>
      <figcaption>
        <span>
          {text(panel.lead)} <b>{text(panel.strong)}</b>
        </span>
        <small>{text(panel.text)}</small>
      </figcaption>
    </div>
  );
}
