import { useState } from "react";
import {
  Check,
  FileCheck2,
  FolderOpen,
  LoaderCircle,
  ArrowRight,
} from "lucide-react";
import { Modal } from "../../components/Modal";
import { bridge, isDesktop } from "../../services/bridge";
import { LibraryManager } from "../../services/LibraryManager";
import { platforms } from "../../db/platforms";
import {
  catalog,
  metadataProvider,
} from "../../providers/metadata/MockMetadataProvider";
import type { GameMetadata, ImportCandidate } from "../../types";
export function ImportDialog({
  initial,
  onClose,
  onImported,
}: {
  initial?: GameMetadata;
  onClose: () => void;
  onImported: (game: GameMetadata) => void;
}) {
  const [candidate, setCandidate] = useState<ImportCandidate>();
  const [selected, setSelected] = useState(initial?.id ?? "custom");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [platform, setPlatform] = useState(initial?.platformId ?? "");
  const [matches, setMatches] = useState<GameMetadata[]>(catalog);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function pick() {
    setBusy(true);
    setError("");
    try {
      const c = await bridge.pickGame();
      if (c) {
        setCandidate(c);
        setPlatform(
          c.platformIds.includes(initial?.platformId ?? "")
            ? initial!.platformId
            : (c.platformIds[0] ?? ""),
        );
        const stem = c.filename.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");
        const results = await metadataProvider.search(stem);
        setMatches(results.length ? results : catalog);
        if (!initial) {
          setTitle(stem);
          setSelected(results[0]?.id ?? "custom");
          if (results[0] && c.platformIds.includes(results[0].platformId))
            setPlatform(results[0].platformId);
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
      const match = catalog.find((g) => g.id === selected);
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
            developer: "Unknown developer",
            description:
              "A game from your personal collection. Imported from a local file; your original file stays exactly where it is.",
            genre: "Local game",
            artwork: "astral",
            color: "#c0a3f5",
          };
      if (!game.title) throw new Error("Enter a title for your game.");
      await new LibraryManager().import(game, candidate);
      onImported(game);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="A new addition to your collection." onClose={onClose}>
      <div className="steps">
        <span className="active">
          1 <b>Locate file</b>
        </span>
        <ArrowRight size={14} />
        <span className={candidate ? "active" : ""}>
          2 <b>Make it yours</b>
        </span>
      </div>
      {!candidate ? (
        <div className="import-drop">
          <div className="large-icon">
            <FolderOpen size={30} />
          </div>
          <h3>Your games. Your collection.</h3>
          <p>
            Choose a game file you own or are authorized to use. We’ll detect
            the platform and calculate its SHA-256 checksum.
          </p>
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
            {busy ? "Reading and hashing…" : "Choose game file"}
          </button>
          <small>NES, SNES, Game Boy, PlayStation, and more</small>
        </div>
      ) : (
        <div className="form-stack">
          <div className="file-summary">
            <FileCheck2 size={24} />
            <div>
              <strong>{candidate.filename}</strong>
              <small>SHA-256 calculated · Original file preserved</small>
            </div>
            <button
              onClick={() => void pick()}
              disabled={busy}
              className="text-button"
            >
              Change
            </button>
          </div>
          <label>
            Platform
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
              This extension is shared by several systems. Confirm the correct
              platform.
            </p>
          )}
          <label>
            Metadata
            <select
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
              }}
            >
              <option value="custom">Use my own title</option>
              {matches.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title} · fictional development metadata
                </option>
              ))}
            </select>
          </label>
          {selected === "custom" && (
            <label>
              Game title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
              />
            </label>
          )}
          <details>
            <summary>File fingerprint</summary>
            <code className="hash">{candidate.sha256}</code>
          </details>
          {!isDesktop && (
            <p className="notice">
              Browser preview: saved in this browser. Import again in the
              desktop app to keep the real file path and launch games.
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
            {busy ? "Adding to your library…" : "Add to library"}
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
