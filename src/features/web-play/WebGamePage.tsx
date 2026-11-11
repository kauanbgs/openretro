// A game's page in the web build: the desktop GamePage's layout, without the
// parts that need the PC (saves, mods, emulator setup, downloads).
import { useState } from "react";
import {
  ChevronDown,
  Clock3,
  ExternalLink,
  Gamepad2,
  Heart,
  Play,
  Scale,
  Trash2,
} from "lucide-react";
import { GameArtwork } from "../../components/GameArtwork";
import { RemoveGameDialog } from "../../components/RemoveGameDialog";
import { platformById } from "../../db/platforms";
import { bridge } from "../../services/bridge";
import type { LibraryGame } from "../../types";
import { formatRelative } from "../../utils/format";
import { failed } from "../../utils/notice";
import { t } from "../../i18n";
import { GameMedia } from "../games/GameMedia";
import "../games/GamePage.css";
import { webCredits } from "./library";

export function WebGamePage({
  entry,
  onPlay,
  onRemoved,
  refresh,
  notify,
}: {
  entry: LibraryGame;
  onPlay: () => void;
  onRemoved: () => void;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const { game, item } = entry;
  const [lightbox, setLightbox] = useState<number>();
  const [remove, setRemove] = useState(false);
  const credits = webCredits(item.id);
  const platform = platformById(game.platformId);
  const gallery = (game.screenshots ?? []).map((src, i) => ({
    src,
    caption: t("{title} · imagem {number}", {
      title: game.title,
      number: i + 1,
    }),
    referrer: "no-referrer" as const,
  }));
  const step = (delta: number) =>
    setLightbox((index) =>
      index === undefined
        ? index
        : (index + delta + gallery.length) % gallery.length,
    );
  const toggleFavorite = () =>
    bridge
      .favorite(item.id, !item.favorite)
      .then(refresh)
      .catch((e) => notify(failed(e)));

  return (
    <div className="game-page">
      <div className="game-hero">
        <GameArtwork game={game} hero />
        <div className="game-hero-content">
          <h2>{game.title}</h2>
          <p>
            {[platform?.name, game.year || null, game.developer]
              .filter(Boolean)
              .join(", ")}
          </p>
          <div className="detail-badges">
            {credits?.license && (
              <span className="detail-badge">
                <Scale size={13} /> {credits.license}
              </span>
            )}
            {credits?.local && (
              <span className="detail-badge">{t("Do seu computador")}</span>
            )}
          </div>
        </div>
      </div>
      <div className="hero-panel">
        <div className="hero-panel-content">
          <p>
            {item.lastPlayedAt
              ? t("Jogou pela última vez {when}", {
                  when: formatRelative(new Date(item.lastPlayedAt)),
                })
              : t("Você ainda não jogou")}
          </p>
          <p>
            {item.playtime
              ? t("{hours}h {minutes}min de jogo", {
                  hours: Math.floor(item.playtime / 3600),
                  minutes: Math.floor((item.playtime % 3600) / 60),
                })
              : t("Roda direto no navegador")}
          </p>
        </div>
        <div className="hero-panel-actions">
          <button className="button primary play-button" onClick={onPlay}>
            <Play size={16} fill="currentColor" /> {t("Jogar")}
          </button>
          {credits?.local && (
            <button
              className="button outline"
              aria-label={t("Remover jogo")}
              title={t("Remover jogo")}
              onClick={() => setRemove(true)}
            >
              <Trash2 size={16} />
            </button>
          )}
          <button
            className={`button outline ${item.favorite ? "favorited" : ""}`}
            aria-label={
              item.favorite ? t("Remover dos favoritos") : t("Favoritar jogo")
            }
            title={
              item.favorite ? t("Remover dos favoritos") : t("Favoritar jogo")
            }
            onClick={() => void toggleFavorite()}
          >
            <Heart size={16} fill={item.favorite ? "currentColor" : "none"} />
          </button>
        </div>
      </div>
      <div className="detail-body">
        <div className="detail-layout">
          <div className="detail-main">
            <div className="game-release">
              <span>
                {game.year
                  ? t("Lançado em {year}", { year: game.year })
                  : t("Lançamento não informado")}
              </span>
              {game.developer && <span>{game.developer}</span>}
            </div>
            {gallery.length > 0 && (
              <GameMedia
                game={game}
                images={gallery}
                onImage={setLightbox}
                onTrailer={() => undefined}
              />
            )}
            <div className="overview">
              <div>
                <h2>{t("Sobre o jogo")}</h2>
                <p>
                  {game.description ||
                    (credits?.local
                      ? t(
                          "Jogo aberto do seu computador. O arquivo fica só neste navegador.",
                        )
                      : t(
                          "Jogo homebrew de {platform}, feito por fãs e distribuído com licença aberta.",
                          {
                            platform: platform?.name ?? game.platformId,
                          },
                        ))}
                </p>
                {credits?.source && (
                  <a
                    className="metadata-source"
                    href={credits.source}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("Ver o projeto original")} <ExternalLink size={14} />
                  </a>
                )}
              </div>
            </div>
          </div>
          <aside className="detail-aside">
            <details className="game-statistics" open>
              <summary>
                <ChevronDown size={16} /> {t("Estatísticas")}
              </summary>
              <dl>
                <div>
                  <dt>
                    <Gamepad2 size={16} /> {t("Console")}
                  </dt>
                  <dd>{platform?.shortName ?? game.platformId}</dd>
                </div>
                <div>
                  <dt>
                    <Clock3 size={16} /> {t("Tempo de jogo")}
                  </dt>
                  <dd>
                    {t("{hours}h {minutes}min de jogo", {
                      hours: Math.floor(item.playtime / 3600),
                      minutes: Math.floor((item.playtime % 3600) / 60),
                    })}
                  </dd>
                </div>
              </dl>
            </details>
            <section className="detail-aside-card">
              <h2>{t("Informações do jogo")}</h2>
              <dl>
                <dt>{t("Plataforma")}</dt>
                <dd>{platform?.name ?? game.platformId}</dd>
                <dt>{t("Lançamento")}</dt>
                <dd>{game.year || t("Desconhecido")}</dd>
                <dt>{t("Gênero")}</dt>
                <dd>{game.genre || t("Desconhecido")}</dd>
                <dt>{t("Desenvolvedora")}</dt>
                <dd>{game.developer || t("Desconhecida")}</dd>
                {credits?.license && (
                  <>
                    <dt>{t("Licença")}</dt>
                    <dd>{credits.license}</dd>
                  </>
                )}
              </dl>
            </section>
          </aside>
        </div>
      </div>
      {lightbox !== undefined && gallery[lightbox] && (
        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={gallery[lightbox].caption}
          tabIndex={-1}
          ref={(node) => node?.focus()}
          onClick={() => setLightbox(undefined)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setLightbox(undefined);
            if (event.key === "ArrowLeft") step(-1);
            if (event.key === "ArrowRight") step(1);
          }}
        >
          <img
            src={gallery[lightbox].src}
            alt={gallery[lightbox].caption}
            referrerPolicy="no-referrer"
            onClick={(event) => event.stopPropagation()}
          />
          <p>
            {gallery[lightbox].caption} · {lightbox + 1}/{gallery.length}
          </p>
        </div>
      )}
      {remove && (
        <RemoveGameDialog
          entry={entry}
          onClose={() => setRemove(false)}
          onRemoved={() => {
            setRemove(false);
            onRemoved();
          }}
        />
      )}
    </div>
  );
}
