import { useState, useSyncExternalStore } from "react";
import { Modal } from "../../components/Modal";
import { BrandMark } from "../../components/Brand";
import { PixelLandscape } from "../../components/PixelLandscape";
import { socialStore } from "../../services/social";
import { language, locale, t } from "../../i18n";
import {
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

const text = (value: { pt: string; en: string }) =>
  language === "en" ? value.en : value.pt;

/** The version's news, once, the first time it opens. */
export function WhatsNew({ version: installed }: { version: string }) {
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
  if (!found || !note || !open) return null;
  const close = () => {
    if (!preview) markSeen(version);
    setOpen(false);
  };
  return <WhatsNewDialog version={found.version} note={note} onClose={close} />;
}

export function WhatsNewDialog({
  version,
  note,
  onClose,
}: {
  version: string;
  note: ReleaseNote;
  onClose: () => void;
}) {
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
        name
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
            {t("Começar a jogar")}
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
