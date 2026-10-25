import { useEffect, useState } from "react";
import {
  Check,
  FileCheck2,
  FolderOpen,
  LoaderCircle,
  ArrowRight,
  FolderTree,
} from "lucide-react";
import { Modal } from "../../components/Modal";
import { bridge, isDesktop } from "../../services/bridge";
import { LibraryManager } from "../../services/LibraryManager";
import { platforms } from "../../db/platforms";
import { metadataProvider } from "../../providers/metadata/LaunchboxMetadataProvider";
import type { GameMetadata, ImportCandidate } from "../../types";
import { t } from "../../i18n";
export function ImportDialog({
  initial,
  initialCandidate,
  onClose,
  onImported,
}: {
  initial?: GameMetadata;
  initialCandidate?: ImportCandidate;
  onClose: () => void;
  onImported: (game: GameMetadata) => void;
}) {
  const [candidate, setCandidate] = useState<ImportCandidate | undefined>(
    initialCandidate,
  );
  const [selected, setSelected] = useState(initial?.id ?? "custom");
  const [title, setTitle] = useState(
    initial?.title ?? initialCandidate?.filename.replace(/\.[^.]+$/, "") ?? "",
  );
  const [platform, setPlatform] = useState(
    initialCandidate?.platformIds.find((p) => p === initial?.platformId) ??
      initialCandidate?.platformIds[0] ??
      initial?.platformId ??
      "",
  );
  const [matches, setMatches] = useState<GameMetadata[]>(
    initial ? [initial] : [],
  );
  const [metadataSearch, setMetadataSearch] = useState("");
  const [metadataError, setMetadataError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [folderQueue, setFolderQueue] = useState<ImportCandidate[]>([]);
  useEffect(() => {
    if (!candidate || initial) return;
    let cancelled = false;
    setMetadataError("");
    const stem = candidate.filename
      .replace(/\.[^.]+$/, "")
      .replace(/\([^)]*\)|\[[^\]]*\]/g, "")
      .trim();
    setMetadataSearch(stem);
    void Promise.all(
      candidate.platformIds.map(async (id) => {
        const exact = await metadataProvider.match(id, candidate.filename);
        return exact ? [exact] : metadataProvider.search(stem, id);
      }),
    )
      .then((results) => {
        if (cancelled) return;
        const games = results.flat();
        setMatches(games);
        setSelected(games[0]?.id ?? "custom");
        if (games[0]) setPlatform(games[0].platformId);
      })
      .catch(() => {
        if (!cancelled)
          setMetadataError(
            t(
              "O catálogo está indisponível. Você pode importar usando seu próprio título.",
            ),
          );
      });
    return () => {
      cancelled = true;
    };
  }, [candidate, initial]);
  async function pick() {
    setBusy(true);
    setError("");
    try {
      const c = await bridge.pickGame();
      if (c) {
        setCandidate(c);
        setPlatform(
          c.platformIds.find((p) => p === initial?.platformId) ??
            c.platformIds.find((p) => initial?.platformIds?.includes(p)) ??
            c.platformIds[0] ??
            "",
        );
        const stem = c.filename
          .replace(/\.[^.]+$/, "")
          .replace(/\([^)]*\)|\[[^\]]*\]/g, "")
          .replace(/[_-]/g, " ")
          .trim();
        if (!initial) {
          setTitle(stem);
          setMetadataSearch(stem);
          setSelected("custom");
        } else if (
          !c.platformIds.some(
            (p) => p === initial.platformId || initial.platformIds?.includes(p),
          )
        ) {
          setSelected("custom");
          setMetadataError(
            t(
              "The chosen file does not match this game's console. Choose the correct file or use your own title.",
            ),
          );
        }
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (!candidate) return;
    setBusy(true);
    setError("");
    try {
      // A custom title must never retain an old catalog match after its platform changes.
      const match =
        selected === "custom"
          ? undefined
          : matches.find((g) => g.id === selected);
      if (!candidate.platformIds.includes(platform)) {
        throw new Error(
          t("Choose a platform detected from the selected game file."),
        );
      }
      if (
        match &&
        match.platformId !== platform &&
        !match.platformIds?.includes(platform)
      )
        throw new Error(
          t(
            "The metadata and file must belong to the same console. Choose matching metadata or use your own title.",
          ),
        );
      const game: GameMetadata = match
        ? {
            ...match,
            id: `${match.id}-${crypto.randomUUID()}`,
            platformId: platform,
          }
        : {
            id: crypto.randomUUID(),
            title: title.trim(),
            platformId: platform,
            year: new Date().getFullYear(),
            developer: t("Unknown developer"),
            description: t(
              "A game from your personal collection. Imported from a local file; your original file stays exactly where it is.",
            ),
            genre: t("Local game"),
            artwork: "neutral",
            color: "#c0a3f5",
          };
      if (!game.title) throw new Error(t("Enter a title for your game."));
      await new LibraryManager().import(game, candidate);
      const [next, ...remaining] = folderQueue;
      if (next) {
        setFolderQueue(remaining);
        setCandidate(next);
        setTitle(next.filename.replace(/\.[^.]+$/, ""));
        setPlatform(next.platformIds[0] ?? "");
        setMatches([]);
        setSelected("custom");
        setMetadataSearch("");
        return;
      }
      onImported(game);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function pickFolder() {
    setBusy(true);
    setError("");
    try {
      const path = await bridge.pickGameFolder();
      if (!path) return;
      const [first, ...remaining] = await bridge.inspectGameFolder(path);
      if (!first) return;
      setFolderQueue(remaining);
      setCandidate(first);
      setTitle(first.filename.replace(/\.[^.]+$/, ""));
      setPlatform(first.platformIds[0] ?? "");
      setMatches([]);
      setSelected("custom");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={t("Adicionar jogo")} onClose={onClose}>
      <div className="steps">
        <span className="active">
          1 <b>{t("Escolher arquivo")}</b>
        </span>
        <ArrowRight size={14} />
        <span className={candidate ? "active" : ""}>
          2 <b>{t("Confirmar dados")}</b>
        </span>
      </div>
      {!candidate ? (
        <div className="import-drop">
          <div className="large-icon">
            <FolderOpen size={30} />
          </div>
          <h3>{t("Choose your game file")}</h3>
          <p>
            {t(
              "OpenRetro detects the console and helps match the game’s details. Your original file stays where it is.",
            )}
          </p>
          <div className="import-drop-actions">
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void pick()}
            >
              {busy ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <FolderOpen size={17} />
              )}{" "}
              {busy ? t("Reading and hashing…") : t("Choose game file")}
            </button>
            <button
              className="button secondary"
              disabled={busy || !isDesktop}
              onClick={() => void pickFolder()}
            >
              <FolderTree size={17} /> {t("Import a folder")}
            </button>
          </div>
          <small>{t("NES, SNES, Game Boy, PlayStation, and more")}</small>
        </div>
      ) : (
        <div className="form-stack">
          <div className="file-summary">
            <FileCheck2 size={24} />
            <div>
              <strong>{candidate.filename}</strong>
              <small>{t("SHA-256 calculated · Original file preserved")}</small>
              {folderQueue.length > 0 && (
                <small>
                  {folderQueue.length} {t("more games in this folder")}
                </small>
              )}
            </div>
            <button
              onClick={() => void pick()}
              disabled={busy}
              className="text-button"
            >
              {t("Change")}
            </button>
          </div>
          <label>
            {t("Platform")}
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
            >
              {platforms
                .filter((p) => candidate.platformIds.includes(p.id))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          {candidate.platformIds.length > 1 && (
            <p className="hint">
              {t(
                "This extension is shared by several systems. Confirm the correct platform.",
              )}
            </p>
          )}
          <label>
            {t("Buscar no LaunchBox")}
            <div className="input-action">
              <input
                maxLength={120}
                value={metadataSearch}
                onChange={(e) => setMetadataSearch(e.target.value)}
                placeholder={t("Buscar informações do jogo")}
              />
              <button
                className="button secondary"
                disabled={busy || !metadataSearch.trim()}
                onClick={() => {
                  setBusy(true);
                  setMetadataError("");
                  void metadataProvider
                    .browse(metadataSearch, platform)
                    .then((result) => {
                      setMatches(result.games);
                      setSelected(result.games[0]?.id ?? "custom");
                      if (!result.games.length)
                        setMetadataError(
                          t(
                            "No matches found for this title and console. Try another name or use your own title.",
                          ),
                        );
                    })
                    .catch(() =>
                      setMetadataError(
                        t(
                          "O catálogo está indisponível. Você pode importar usando seu próprio título.",
                        ),
                      ),
                    )
                    .finally(() => setBusy(false));
                }}
              >
                {t("Search")}
              </button>
            </div>
          </label>
          {metadataError && <p className="hint">{metadataError}</p>}
          <label>
            {t("Metadata")}
            <select
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
              }}
            >
              <option value="custom">{t("Usar meu próprio título")}</option>
              {matches
                .filter(
                  (g) =>
                    g.platformId === platform ||
                    g.platformIds?.includes(platform),
                )
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title} · {g.year || t("Year unknown")} {t("· LaunchBox")}
                  </option>
                ))}
            </select>
          </label>
          {selected === "custom" && (
            <label>
              {t("Game title")}
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
              />
            </label>
          )}
          <details>
            <summary>{t("Identificação do arquivo")}</summary>
            <code className="hash">{candidate.sha256}</code>
          </details>
          {!isDesktop && (
            <p className="notice">
              {t(
                "Browser preview: saved in this browser. Import again in the desktop app to keep the real file path and launch games.",
              )}
            </p>
          )}
          <button
            className="button primary full"
            onClick={() => void confirm()}
            disabled={busy || !platform}
          >
            {busy ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              <Check size={17} />
            )}{" "}
            {busy ? t("Adding to your library…") : t("Adicionar à biblioteca")}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </Modal>
  );
}
