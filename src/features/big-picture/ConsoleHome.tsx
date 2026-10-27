import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import {
  Clock3,
  Compass,
  Ellipsis,
  FolderPlus,
  Heart,
  Library,
  Play,
  Smartphone,
  Trophy,
  Users,
} from "lucide-react";
import type { Emulator, GameMetadata, LibraryGame } from "../../types";
import { NETPLAY_PLATFORMS } from "../../types";
import { GameArtwork } from "../../components/GameArtwork";
import { PlayTogether, usePlayTogether } from "../../components/PlayTogether";
import { hasRuntimeMenu } from "../../components/InGameMenuHelp";
import { platformById } from "../../db/platforms";
import { isDesktop, isRemote } from "../../services/bridge";
import {
  achievementsProgress,
  useGameAchievements,
} from "../achievements/AchievementsTab";
import { locale, t } from "../../i18n";
import { nextControl, type Direction } from "./workspaceNavigation";

/** A tile of the home row: a game, or one of the fixed places after them. */
export type HomeTile = { kind: "game"; entry: LibraryGame } | { kind: Place };
type Place = "party" | "phone" | "library" | "explore" | "add";

const RECENT_GAMES = 12;
const artOf = (game?: GameMetadata) =>
  game && (game.backgroundUrl ?? game.screenshots?.[0] ?? game.coverUrl);

export const playtimeLabel = (seconds: number) =>
  seconds
    ? `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
    : "0h";

/**
 * The console home, laid out like a PlayStation 5: recent games in a row
 * that slides with the focus, the focused tile's hub below it, then the
 * ways to play together.
 */
export function ConsoleHome({
  library,
  emulators,
  details,
  input,
  launching,
  onTile,
  onPlay,
  onOptions,
  onOnline,
  onFavorite,
  onLibrary,
  onExplore,
  onSearch,
  onImport,
  onSources,
  onPhone,
  onParty,
  onFriends,
}: {
  library: LibraryGame[];
  emulators: Emulator[];
  /** Fuller catalog metadata for games, by game id. */
  details: Record<string, GameMetadata>;
  input: RefObject<((key: string) => boolean) | null>;
  launching: boolean;
  /** The focused tile and its position along the row, from 0 to 1. */
  onTile: (tile: HomeTile, position: number) => void;
  onPlay: (entry: LibraryGame) => void;
  onOptions: (entry: LibraryGame) => void;
  onOnline: (entry: LibraryGame) => void;
  onFavorite: (entry: LibraryGame) => void;
  onLibrary: () => void;
  onExplore: () => void;
  onSearch: () => void;
  onImport: () => void;
  onSources: () => void;
  onPhone: () => void;
  onParty: () => void;
  onFriends: () => void;
}) {
  const tiles = useMemo<HomeTile[]>(
    () => [
      ...[...library]
        .sort((a, b) =>
          (b.item.lastPlayedAt ?? b.item.addedAt).localeCompare(
            a.item.lastPlayedAt ?? a.item.addedAt,
          ),
        )
        .slice(0, RECENT_GAMES)
        .map((entry) => ({ kind: "game" as const, entry })),
      { kind: "party" },
      { kind: "phone" },
      { kind: "library" },
      { kind: "explore" },
      { kind: "add" },
    ],
    [library],
  );
  const [index, setIndex] = useState(0);
  const focused = tiles[Math.min(index, tiles.length - 1)];
  const row = useRef<HTMLDivElement>(null);
  const hub = useRef<HTMLDivElement>(null);
  const together = useRef<HTMLDivElement>(null);
  useEffect(() => {
    onTile(focused, tiles.length > 1 ? index / (tiles.length - 1) : 0);
  }, [focused, index, tiles.length, onTile]);
  const focusTile = (next: number) => {
    const clamped = Math.max(0, Math.min(tiles.length - 1, next));
    setIndex(clamped);
    (row.current?.children[clamped] as HTMLElement | undefined)?.focus({
      preventScroll: true,
    });
  };
  const zone = () => {
    const active = document.activeElement;
    if (hub.current?.contains(active)) return "hub";
    if (together.current?.contains(active)) return "together";
    return "row";
  };
  const buttons = (scope: HTMLElement | null) =>
    Array.from(
      scope?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
    );
  // Opening home lands on the first tile, like turning the console on.
  useEffect(() => {
    requestAnimationFrame(() =>
      (row.current?.children[0] as HTMLElement | undefined)?.focus({
        preventScroll: true,
      }),
    );
  }, []);
  useLayoutEffect(() => {
    input.current = (key) => {
      const where = zone();
      const game = focused.kind === "game" ? focused.entry : undefined;
      if (key === "x" && game) {
        onFavorite(game);
        return true;
      }
      if (key === "y" && game) {
        onOptions(game);
        return true;
      }
      if (where === "row") {
        if (key === "left" || key === "right") {
          focusTile(index + (key === "left" ? -1 : 1));
          return true;
        }
        if (key === "down") {
          buttons(hub.current)[0]?.focus();
          return true;
        }
        if (key === "a") {
          (
            row.current?.children[index] as HTMLButtonElement | undefined
          )?.click();
          return true;
        }
        // Up leaves the row for the top bar.
        return false;
      }
      const scope = where === "hub" ? hub.current : together.current;
      const list = buttons(scope);
      const current = list.indexOf(document.activeElement as HTMLButtonElement);
      if (key === "a") {
        list[current]?.click();
        return true;
      }
      if (["left", "right", "up", "down"].includes(key)) {
        const next = nextControl(
          list.map((button) => button.getBoundingClientRect()),
          Math.max(0, current),
          key as Direction,
        );
        if (next !== current && next >= 0) {
          list[next]?.focus();
          if (where === "together")
            list[next]?.scrollIntoView({
              block: "nearest",
              behavior: "smooth",
            });
          return true;
        }
        if (key === "up") {
          if (where === "together") {
            buttons(hub.current)[0]?.focus();
            hub.current?.scrollIntoView({ block: "end", behavior: "smooth" });
          } else focusTile(index);
          return true;
        }
        if (key === "down" && where === "hub") {
          buttons(together.current)[0]?.focus();
          buttons(together.current)[0]?.scrollIntoView({
            block: "nearest",
            behavior: "smooth",
          });
          return true;
        }
        return true;
      }
      if (key === "b") {
        focusTile(index);
        return true;
      }
      return false;
    };
    return () => {
      input.current = null;
    };
  });
  const game = focused.kind === "game" ? focused.entry : undefined;
  const metadata = game && (details[game.game.id] ?? game.game);
  const achievements = useGameAchievements(
    game?.item.id,
    Boolean(game) && isDesktop && !isRemote,
  );
  const progress = achievementsProgress(achievements.data);
  const favorites = library.filter((entry) => entry.item.favorite).length;
  const playTogether = usePlayTogether();
  // Everything on the row that is not a game: what it is and what it does.
  const places: Record<
    Place,
    {
      label: string;
      icon: typeof Library;
      meta: string;
      live?: boolean;
      open: () => void;
      actions: ReactNode;
    }
  > = {
    party: {
      label: t("Jogar com amigos"),
      icon: Users,
      meta: playTogether.partyDescription,
      live: playTogether.partyActive,
      open: onParty,
      actions: (
        <>
          <button className="ps-primary" onClick={onParty}>
            <Users size={19} />
            {playTogether.partyActive ? t("Gerenciar Party") : t("Criar Party")}
          </button>
          <button className="ps-secondary" onClick={onFriends}>
            {t("Ver amigos")}
          </button>
        </>
      ),
    },
    phone: {
      label: t("Jogar no celular"),
      icon: Smartphone,
      meta: playTogether.phoneDescription,
      live: playTogether.phoneDevices > 0,
      open: onPhone,
      actions: (
        <button className="ps-primary" onClick={onPhone}>
          <Smartphone size={19} />
          {playTogether.phoneActive
            ? t("Gerenciar conexão")
            : t("Conectar celular")}
        </button>
      ),
    },
    library: {
      label: t("Biblioteca de jogos"),
      icon: Library,
      meta: t("{count} jogos · {favorites} favoritos", {
        count: library.length,
        favorites,
      }),
      open: onLibrary,
      actions: (
        <button className="ps-primary" onClick={onLibrary}>
          <Library size={19} /> {t("Abrir biblioteca")}
        </button>
      ),
    },
    explore: {
      label: t("Explorar"),
      icon: Compass,
      meta: t("Encontre clássicos no catálogo do LaunchBox."),
      open: onExplore,
      actions: (
        <>
          <button className="ps-primary" onClick={onExplore}>
            <Compass size={19} /> {t("Abrir catálogo")}
          </button>
          <button className="ps-secondary" onClick={onSearch}>
            {t("Pesquisar jogos")}
          </button>
        </>
      ),
    },
    add: {
      label: t("Adicionar jogos"),
      icon: FolderPlus,
      meta: t("Importe arquivos ou uma pasta do seu computador."),
      open: onImport,
      actions: (
        <>
          <button className="ps-primary" onClick={onImport}>
            <FolderPlus size={19} /> {t("Selecionar jogos")}
          </button>
          <button className="ps-secondary" onClick={onSources}>
            {t("Fontes de download")}
          </button>
        </>
      ),
    },
  };
  const place = focused.kind === "game" ? undefined : places[focused.kind];
  return (
    <div className="ps-home">
      <div className="ps-row-viewport">
        {/* The focused tile stays at the start; the rest slide past it. */}
        <div
          className="ps-row"
          ref={row}
          role="list"
          style={{ "--index": index } as CSSProperties}
        >
          {tiles.map((tile, position) => {
            const selected = position === index;
            const info = tile.kind === "game" ? undefined : places[tile.kind];
            const label =
              tile.kind === "game" ? tile.entry.game.title : info!.label;
            const Icon = info?.icon ?? Library;
            return (
              <button
                key={tile.kind === "game" ? tile.entry.item.id : tile.kind}
                role="listitem"
                className={`ps-tile ps-tile-${tile.kind} ${selected ? "focused" : ""} ${info?.live ? "live" : ""}`}
                style={{ "--i": position } as CSSProperties}
                data-art={
                  tile.kind === "game"
                    ? artOf(details[tile.entry.game.id] ?? tile.entry.game)
                    : undefined
                }
                aria-label={label}
                onFocus={() => setIndex(position)}
                onMouseEnter={() => focusTile(position)}
                onClick={() =>
                  tile.kind === "game" ? onPlay(tile.entry) : info!.open()
                }
                onContextMenu={(event) => {
                  if (tile.kind !== "game") return;
                  event.preventDefault();
                  onOptions(tile.entry);
                }}
              >
                {tile.kind === "game" ? (
                  <GameArtwork game={tile.entry.game} />
                ) : (
                  <span className="ps-tile-icon">
                    <Icon size={34} strokeWidth={1.6} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <section className="ps-hub" key={game?.item.id ?? focused.kind}>
        <h1>{game ? game.game.title : place!.label}</h1>
        <p className="ps-hub-meta">
          {game
            ? [
                platformById(game.game.platformId)?.name ??
                  game.game.platformId,
                metadata?.genre,
                metadata?.year || undefined,
              ]
                .filter(Boolean)
                .join("  ·  ")
            : place!.meta}
        </p>
        <div className="ps-hub-actions" ref={hub}>
          {game ? (
            <>
              <button
                className="ps-primary"
                disabled={launching}
                onClick={() => onPlay(game)}
              >
                <Play size={20} fill="currentColor" />
                {launching ? t("Iniciando…") : t("Jogar")}
              </button>
              {NETPLAY_PLATFORMS.includes(game.game.platformId) && (
                <button className="ps-secondary" onClick={() => onOnline(game)}>
                  <Users size={19} /> {t("Jogar online")}
                </button>
              )}
              <button
                className="ps-secondary ps-round"
                aria-label={
                  game.item.favorite
                    ? t("Remover dos favoritos")
                    : t("Favoritar")
                }
                aria-pressed={game.item.favorite}
                onClick={() => onFavorite(game)}
              >
                <Heart
                  size={19}
                  fill={game.item.favorite ? "currentColor" : "none"}
                />
              </button>
              <button
                className="ps-secondary ps-round"
                aria-label={t("Mais opções")}
                onClick={() => onOptions(game)}
              >
                <Ellipsis size={20} />
              </button>
            </>
          ) : (
            place!.actions
          )}
        </div>
        {game && (
          <div className="ps-hub-cards">
            <article>
              <Clock3 size={22} />
              <strong>{playtimeLabel(game.item.playtime)}</strong>
              <span>{t("Tempo jogado")}</span>
            </article>
            <article>
              <Play size={22} />
              <strong>
                {game.item.lastPlayedAt
                  ? new Date(game.item.lastPlayedAt).toLocaleDateString(
                      locale(),
                      { day: "2-digit", month: "short" },
                    )
                  : t("Nunca")}
              </strong>
              <span>{t("Última vez")}</span>
            </article>
            {progress && (
              <article>
                <Trophy size={22} />
                <strong>{progress}</strong>
                <span>{t("Conquistas")}</span>
              </article>
            )}
            {metadata?.description && (
              <article className="ps-hub-about">
                <span>{t("Sobre o jogo")}</span>
                <p>{metadata.description}</p>
              </article>
            )}
          </div>
        )}
        {game && hasRuntimeMenu(game, emulators) && (
          <p className="ps-hub-hint">
            {t(
              "Durante o jogo: PS abre o menu · Share + Options ou F1 como alternativa",
            )}
          </p>
        )}
      </section>
      <section className="ps-together" ref={together}>
        <h2>{t("Jogar junto")}</h2>
        <PlayTogether
          onPhone={onPhone}
          onParty={onParty}
          onFriends={onFriends}
        />
      </section>
    </div>
  );
}
