import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, LogOut } from "lucide-react";
import { bridge } from "../../services/bridge";
import { locale, t } from "../../i18n";
import "./Achievements.css";

export const accountKey = ["achievements-account"];

/** Signs in to RetroAchievements, or shows the signed-in account. */
export function AchievementsAccount({
  notify,
}: {
  notify: (message: string) => void;
}) {
  const client = useQueryClient();
  const account = useQuery({
    queryKey: accountKey,
    queryFn: bridge.achievementsAccount,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function changed() {
    void client.invalidateQueries({ queryKey: ["game-achievements"] });
  }
  async function signIn() {
    setBusy(true);
    setError("");
    try {
      const next = await bridge.achievementsSignIn(username, password);
      setPassword("");
      client.setQueryData(accountKey, next);
      changed();
      notify(
        t("Conectado ao RetroAchievements como {name}.", {
          name: next.username,
        }),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    setBusy(true);
    try {
      await bridge.achievementsSignOut();
      client.setQueryData(accountKey, null);
      changed();
    } finally {
      setBusy(false);
    }
  }
  if (account.isPending)
    return <p className="ra-note">{t("Verificando sua conta…")}</p>;
  if (account.error)
    return (
      <div className="ra-account">
        <p className="error-message" role="alert">
          {String(account.error)}
        </p>
        <button
          className="button outline"
          onClick={() => void account.refetch()}
        >
          {t("Tentar de novo")}
        </button>
      </div>
    );
  if (account.data) {
    const { username: name, avatarUrl, score, softcoreScore } = account.data;
    return (
      <div className="ra-account">
        <img src={avatarUrl} alt="" />
        <div className="ra-account-info">
          <strong>{name}</strong>
          <span>
            {t("{hardcore} pontos hardcore · {softcore} softcore", {
              hardcore: score.toLocaleString(locale()),
              softcore: softcoreScore.toLocaleString(locale()),
            })}
          </span>
        </div>
        <a
          className="button outline"
          href={`https://retroachievements.org/user/${encodeURIComponent(name)}`}
          target="_blank"
          rel="noreferrer"
        >
          {t("Ver perfil")} <ExternalLink size={14} />
        </a>
        <button
          className="button outline"
          disabled={busy}
          onClick={() => void signOut()}
        >
          <LogOut size={15} /> {t("Sair")}
        </button>
      </div>
    );
  }
  return (
    <form
      className="ra-sign-in"
      onSubmit={(e) => {
        e.preventDefault();
        void signIn();
      }}
    >
      <p className="ra-note">
        {t(
          "Entre com sua conta do RetroAchievements para ganhar conquistas nos clássicos. A senha só é usada para entrar: o OpenRetro guarda apenas a sessão, no Gerenciador de Credenciais do Windows.",
        )}
      </p>
      <div className="ra-sign-in-fields">
        <input
          aria-label={t("Usuário")}
          placeholder={t("Usuário")}
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          aria-label={t("Senha")}
          placeholder={t("Senha")}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button
          className="button primary"
          disabled={busy || !username.trim() || !password}
        >
          {busy ? t("Entrando…") : t("Entrar")}
        </button>
      </div>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      <small className="ra-note">
        {t("Ainda não tem conta?")}{" "}
        <a
          href="https://retroachievements.org/"
          target="_blank"
          rel="noreferrer"
        >
          {t("Crie uma no site do RetroAchievements")}
        </a>
      </small>
    </form>
  );
}
