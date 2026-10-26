import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, LoaderCircle, Trophy } from "lucide-react";
import { bridge } from "../../services/bridge";
import type { Achievement, GameAchievements } from "../../types";
import { locale, t } from "../../i18n";
import "./Achievements.css";

export const gameAchievementsKey = (id: string) => ["game-achievements", id];

export function useGameAchievements(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: gameAchievementsKey(id ?? ""),
    queryFn: () => bridge.gameAchievements(id!),
    enabled: enabled && Boolean(id),
    staleTime: 10 * 60_000,
    retry: false,
  });
}

/** "3/40" for the tab label once the set is known. */
export function achievementsProgress(data: GameAchievements | undefined) {
  if (data?.state !== "ready") return "";
  const unlocked = data.achievements.filter((a) => a.unlocked).length;
  return `${unlocked}/${data.achievements.length}`;
}

const kinds: Record<string, string> = {
  progression: t("Progressão"),
  win_condition: t("Final"),
  missable: t("Perdível"),
};

type Filter = "all" | "unlocked" | "locked";

export function AchievementsTab({ id }: { id: string }) {
  const query = useGameAchievements(id, true);
  const [filter, setFilter] = useState<Filter>("all");
  if (query.isPending)
    return (
      <div className="catalog-loading">
        <LoaderCircle className="spin" size={22} />
        <p>{t("Carregando conquistas…")}</p>
      </div>
    );
  if (query.error)
    return (
      <div className="ra-empty">
        <p className="error-message" role="alert">
          {String(query.error)}
        </p>
        <button className="button outline" onClick={() => void query.refetch()}>
          {t("Tentar de novo")}
        </button>
      </div>
    );
  const data = query.data;
  if (data.state !== "ready")
    return (
      <div className="ra-empty">
        <Trophy size={28} />
        <p>
          {
            {
              signedOut: t(
                "Entre na sua conta do RetroAchievements em Configurações › Conquistas para ver e ganhar as conquistas deste jogo.",
              ),
              unsupported: t(
                "Este console não tem conquistas no RetroAchievements pelo OpenRetro.",
              ),
              unknown: t(
                "O OpenRetro descobre as conquistas deste jogo na primeira vez que você jogar.",
              ),
              noSet: t(
                "Este jogo não tem conquistas no RetroAchievements, ou esta versão do arquivo não é reconhecida.",
              ),
            }[data.state]
          }
        </p>
      </div>
    );
  const all = data.achievements;
  const unlocked = all.filter((a) => a.unlocked);
  const points = all.reduce((sum, a) => sum + a.points, 0);
  const earned = unlocked.reduce((sum, a) => sum + a.points, 0);
  const shown = all.filter((a) =>
    filter === "all" ? true : filter === "unlocked" ? a.unlocked : !a.unlocked,
  );
  const percent = all.length ? (unlocked.length / all.length) * 100 : 0;
  return (
    <section className="ra-game">
      <header className="ra-game-head">
        <img src={data.iconUrl} alt="" />
        <div className="ra-game-progress">
          <strong>
            {t("{unlocked} de {total} conquistas", {
              unlocked: unlocked.length,
              total: all.length,
            })}
          </strong>
          <div
            className="ra-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={all.length}
            aria-valuenow={unlocked.length}
          >
            <span style={{ width: `${percent}%` }} />
          </div>
          <span>
            {t("{earned} de {points} pontos", {
              earned: earned.toLocaleString(locale()),
              points: points.toLocaleString(locale()),
            })}
            {" · "}
            {data.hardcore ? t("Modo hardcore ligado") : t("Modo softcore")}
          </span>
        </div>
        <a
          className="button outline"
          href={`https://retroachievements.org/game/${data.gameId}`}
          target="_blank"
          rel="noreferrer"
        >
          {t("Ver no RetroAchievements")} <ExternalLink size={14} />
        </a>
      </header>
      <div className="ra-filters" role="group" aria-label={t("Filtrar")}>
        {(
          [
            ["all", t("Todas")],
            ["unlocked", t("Desbloqueadas")],
            ["locked", t("Bloqueadas")],
          ] as [Filter, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            className={filter === id ? "selected" : ""}
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <ul className="ra-list">
        {shown.map((a) => (
          <AchievementRow key={a.id} achievement={a} hardcore={data.hardcore} />
        ))}
      </ul>
    </section>
  );
}

function AchievementRow({
  achievement: a,
  hardcore,
}: {
  achievement: Achievement;
  hardcore: boolean;
}) {
  const rarity = hardcore ? a.rarityHardcore : a.rarity;
  return (
    <li className={`ra-item ${a.unlocked ? "unlocked" : ""}`}>
      <img
        src={a.unlocked ? a.badgeUrl : a.lockedBadgeUrl}
        alt=""
        loading="lazy"
      />
      <div className="ra-item-text">
        <strong>{a.title}</strong>
        <p>{a.description}</p>
        <span className="ra-item-meta">
          {kinds[a.kind] && <em>{kinds[a.kind]}</em>}
          {a.unlockedHardcore && <em className="hardcore">{t("Hardcore")}</em>}
          {t("{percent}% dos jogadores", {
            percent: rarity.toLocaleString(locale(), {
              maximumFractionDigits: 1,
            }),
          })}
        </span>
      </div>
      <span className="ra-points">
        {t("{points} pts", { points: a.points })}
      </span>
    </li>
  );
}
