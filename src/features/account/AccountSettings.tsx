import { useEffect, useState, type FormEvent } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { Modal } from "../../components/Modal";
import { t } from "../../i18n";
import { isRemote, isTauri } from "../../services/transport";
import {
  accountApi,
  getPendingLogin,
  rememberPendingLogin,
  clearPendingLogin,
  accountFailure,
  mergeAccountSession,
  remainingSeconds,
  signedOut,
  validDisplayName,
  validFriendTag,
  friendPrefix,
  type AccountApi,
  type AccountPatch,
} from "../../services/account";
import { AccountAvatar, AvatarPicker } from "../social/accountAvatars";
import "./AccountSettings.css";

export function AccountSettings({
  notify,
  api = accountApi,
}: {
  notify: (message: string) => void;
  api?: AccountApi;
}) {
  const [session, setSession] = useState(signedOut);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState(() => getPendingLogin()?.email ?? "");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(() => getPendingLogin() !== null);
  const [deadline, setDeadline] = useState(
    () => getPendingLogin()?.resendAt ?? 0,
  );
  const [remaining, setRemaining] = useState(0);
  const [name, setName] = useState("");
  const [friendTag, setFriendTag] = useState("");
  const [avatar, setAvatar] = useState(0);
  const [privacy, setPrivacy] = useState("");
  const [vaultError, setVaultError] = useState(false);
  const [confirmation, setConfirmation] = useState<
    "delete" | "all" | "forget" | null
  >(null);
  const [deleteText, setDeleteText] = useState("");
  const user = session.user;
  // The code as it will read once saved, following the name being typed.
  const shownCode =
    user && session.online && validFriendTag(friendTag)
      ? `${friendPrefix(name)}#${friendTag.trim().toLowerCase()}`
      : (user?.friendCode ?? "");
  function adopt(next: typeof session) {
    if (next.hasSession) {
      clearPendingLogin();
      setSent(false);
      setCode("");
    }
    setSession((previous) => mergeAccountSession(previous, next));
    if (next.user) {
      setName(next.user.displayName ?? "");
      const tag = next.user.friendCode.split("#")[1] ?? "";
      setFriendTag(validFriendTag(tag) ? tag : "");
      setAvatar(next.user.avatar ?? 0);
    }
  }
  useEffect(() => {
    let active = true;
    void api
      .session()
      .then((next) => {
        if (active) adopt(next);
      })
      .catch((cause) => {
        if (active) {
          const failure = accountFailure(cause);
          setError(failure.message);
          setVaultError(failure.kind === "vault");
          setSession({
            ...signedOut,
            supported: isTauri && failure.kind !== "unsupported",
          });
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    void api
      .privacy()
      .then((url) => {
        if (active) setPrivacy(url);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [api]);
  useEffect(() => {
    const update = () => setRemaining(remainingSeconds(deadline));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [deadline]);
  async function action(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setVaultError(false);
    try {
      await work();
    } catch (cause) {
      const failure = accountFailure(cause);
      setError(failure.message);
      if (failure.retryAfter)
        setDeadline(Date.now() + failure.retryAfter * 1000);
      if (failure.kind === "unauthorized") {
        setSession({ ...signedOut, supported: true });
        clearPendingLogin();
        setSent(false);
        setCode("");
        setConfirmation(null);
        setDeleteText("");
      }
      if (failure.kind === "offline")
        setSession((previous) => ({ ...previous, online: false }));
    } finally {
      setBusy(false);
    }
  }
  async function sendCode(event?: FormEvent) {
    event?.preventDefault();
    await action(async () => {
      const result = await api.start(email);
      setEmail(email.trim().toLowerCase());
      setSent(true);
      setCode("");
      const resendAt =
        Date.now() + Math.max(60, Math.min(3600, result.resendAfter)) * 1000;
      setDeadline(resendAt);
      rememberPendingLogin(email.trim().toLowerCase(), resendAt);
      notify(t("Código enviado. Confira seu e-mail."));
    });
  }
  async function verify(event: FormEvent) {
    event.preventDefault();
    await action(async () => {
      adopt(await api.verify(email, code));
      clearPendingLogin();
      setCode("");
      setSent(false);
      notify(t("Você entrou na sua conta."));
    });
  }
  async function profile(patch: AccountPatch) {
    await action(async () => {
      adopt(await api.profile(patch));
      notify(t("Conta atualizada."));
    });
  }
  async function finish() {
    await action(async () => {
      if (confirmation === "delete") {
        await api.remove(deleteText);
        notify(t("Sua conta foi excluída."));
      } else if (confirmation === "all") {
        await api.logout(true);
        notify(t("Você saiu de todos os aparelhos."));
      } else {
        await api.forget();
        notify(t("Sessão removida deste computador."));
      }
      setSession({ ...signedOut, supported: true });
      clearPendingLogin();
      setConfirmation(null);
      setDeleteText("");
      setName("");
      setEmail("");
      setCode("");
      setSent(false);
    });
  }
  if (isRemote)
    return (
      <p className="settings-group-note">
        {t("Gerencie sua conta pelo aplicativo no computador.")}
      </p>
    );
  return (
    <div className="account-settings">
      <p className="settings-group-note">
        {t(
          "Sua conta é opcional. Seus jogos e saves continuam neste computador.",
        )}
      </p>
      {loading ? (
        <p role="status">{t("Consultando sua conta…")}</p>
      ) : (
        <>
          {error && !confirmation && (
            <p className="error-message" role="alert">
              {t(error)}
            </p>
          )}
          {vaultError && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setConfirmation("forget")}
            >
              {t("Remover sessão salva")}
            </button>
          )}
          {error && !session.hasSession && (
            <button
              className="button secondary"
              disabled={busy}
              onClick={() =>
                void action(async () => adopt(await api.session()))
              }
            >
              {t("Tentar novamente")}
            </button>
          )}
          {session.hasSession ? (
            <>
              <section
                className="settings-group"
                aria-label={t("Seu perfil online")}
              >
                <h3>{t("Seu perfil online")}</h3>
                <div className="setting-row">
                  <div className="account-identity">
                    <AccountAvatar avatar={user?.avatar} size={44} />
                    <div>
                      <strong>
                        {user
                          ? user.displayName || t("Escolha seu nome")
                          : t("Sessão salva neste computador")}
                      </strong>
                      <p>{user?.email}</p>
                    </div>
                  </div>
                  <span className="account-status">
                    {session.online ? t("Conectado") : t("Sem conexão")}
                  </span>
                </div>
                {!session.online && (
                  <div className="account-offline">
                    <p>
                      {t(
                        "Sua sessão está guardada com segurança. Conecte-se para gerenciar a conta; você pode continuar jogando.",
                      )}
                    </p>
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() =>
                        void action(async () => adopt(await api.session()))
                      }
                    >
                      <RefreshCw size={15} />
                      {t("Tentar conectar")}
                    </button>
                  </div>
                )}
                {user && (
                  <div className="setting-row">
                    <div>
                      <strong>{t("Código de amigo")}</strong>
                      <p>
                        {t(
                          "Compartilhe este código para que seus amigos encontrem você.",
                        )}
                      </p>
                    </div>
                    <div className="account-friend-code">
                      <input
                        aria-label={t("Código de amigo")}
                        readOnly
                        value={shownCode}
                        onFocus={(e) => e.currentTarget.select()}
                      />
                      <button
                        className="button secondary"
                        aria-label={t("Copiar código de amigo")}
                        // An unsaved code does not exist yet; nobody could add it.
                        disabled={shownCode !== user.friendCode}
                        title={
                          shownCode !== user.friendCode
                            ? t("Salve o perfil para usar este código.")
                            : undefined
                        }
                        onClick={() => {
                          void navigator.clipboard
                            .writeText(user.friendCode)
                            .then(() => notify(t("Código de amigo copiado.")))
                            .catch(() =>
                              setError(
                                "Selecione e copie seu código de amigo.",
                              ),
                            );
                        }}
                      >
                        <Copy size={16} />
                      </button>
                    </div>
                  </div>
                )}
                {session.online && (
                  <form
                    className="account-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void profile({
                        displayName: name.trim(),
                        friendTag: friendTag.trim().toLowerCase(),
                        avatar,
                      });
                    }}
                  >
                    <span className="account-label">{t("Ícone da conta")}</span>
                    <AvatarPicker
                      value={avatar}
                      onChange={setAvatar}
                      disabled={busy}
                    />
                    <label htmlFor="account-name">
                      {t("Nome de exibição")}
                    </label>
                    <input
                      id="account-name"
                      autoComplete="nickname"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      aria-describedby="account-name-hint"
                      disabled={busy}
                    />
                    <p id="account-name-hint" className="account-hint">
                      {t(
                        "De 3 a 24 caracteres. Esse nome será visto pelos seus amigos.",
                      )}
                    </p>
                    <label htmlFor="account-friend-tag">
                      {t("Seus 4 caracteres depois do #")}
                    </label>
                    <div className="account-tag-editor">
                      <span aria-hidden="true">{friendPrefix(name)}#</span>
                      <input
                        id="account-friend-tag"
                        aria-describedby="account-tag-hint"
                        value={friendTag}
                        maxLength={4}
                        autoComplete="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        placeholder="ab12"
                        disabled={busy}
                        onChange={(event) =>
                          setFriendTag(event.target.value.toLowerCase())
                        }
                      />
                    </div>
                    <p id="account-tag-hint" className="account-hint">
                      {t(
                        "Antes do # vai o seu nome, sem acentos nem espaços. Escolha 4 letras ou números para depois dele; se a combinação já estiver em uso, escolha outra.",
                      )}
                    </p>
                    <button
                      className="button primary"
                      disabled={
                        busy ||
                        !validDisplayName(name) ||
                        !validFriendTag(friendTag) ||
                        (name.trim() === user?.displayName &&
                          friendTag.trim().toLowerCase() ===
                            user?.friendCode.split("#")[1] &&
                          avatar === user?.avatar)
                      }
                      type="submit"
                    >
                      {busy ? t("Salvando…") : t("Salvar perfil")}
                    </button>
                  </form>
                )}
              </section>
              {user && (
                <section className="settings-group">
                  <h3>{t("Privacidade")}</h3>
                  {(
                    [
                      {
                        key: "showPlaying",
                        label: "Mostrar o que estou jogando para amigos",
                        on: user.showPlaying,
                      },
                      {
                        key: "appearOffline",
                        label: "Aparecer offline",
                        on: user.appearOffline,
                      },
                    ] as const
                  ).map((item) => (
                    <div className="setting-row" key={item.key}>
                      <div>
                        <strong>{t(item.label)}</strong>
                        <p>
                          {t(
                            item.key === "showPlaying"
                              ? "Você escolhe se seus amigos podem ver o jogo atual."
                              : "Seus amigos verão você como offline.",
                          )}
                        </p>
                      </div>
                      <button
                        className={`switch ${item.on ? "on" : ""}`}
                        role="switch"
                        aria-label={t(item.label)}
                        aria-checked={item.on}
                        disabled={busy || !session.online}
                        onClick={() => void profile({ [item.key]: !item.on })}
                      >
                        <span />
                      </button>
                    </div>
                  ))}
                </section>
              )}
              <section className="settings-group">
                <h3>{t("Sessão e dados")}</h3>
                <div className="setting-row setting-row-stack">
                  <p>
                    {t("Sair não remove seus jogos, saves ou perfis locais.")}
                  </p>
                  <div className="account-actions">
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => {
                        if (!session.online) setConfirmation("forget");
                        else
                          void action(async () => {
                            await api.logout(false);
                            clearPendingLogin();
                            setSent(false);
                            setCode("");
                            setSession({ ...signedOut, supported: true });
                            setName("");
                            setEmail("");
                            notify(t("Você saiu da sua conta."));
                          });
                      }}
                    >
                      {t("Sair deste computador")}
                    </button>
                    <button
                      className="button secondary"
                      disabled={busy || !session.online}
                      onClick={() => setConfirmation("all")}
                    >
                      {t("Sair de todos os aparelhos")}
                    </button>
                    <button
                      className="button secondary"
                      disabled={busy || !session.online}
                      onClick={() =>
                        void action(async () => {
                          if (await api.export())
                            notify(t("Dados da conta exportados."));
                        })
                      }
                    >
                      {t("Exportar meus dados")}
                    </button>
                  </div>
                </div>
                <div className="setting-row">
                  <div>
                    <strong>{t("Excluir minha conta")}</strong>
                    <p>
                      {t(
                        "Remove a conta e seus relacionamentos do servidor. Seus arquivos locais permanecem.",
                      )}
                    </p>
                  </div>
                  <button
                    className="button secondary danger"
                    disabled={busy || !session.online}
                    onClick={() => {
                      setConfirmation("delete");
                      setDeleteText("");
                    }}
                  >
                    {t("Excluir minha conta")}
                  </button>
                </div>
              </section>
            </>
          ) : (
            <section className="settings-group">
              <h3>{t("Entrar na sua conta")}</h3>
              {!session.supported && (
                <p className="account-hint">
                  {t("O login está disponível no aplicativo para Windows.")}
                </p>
              )}
              <form
                className="account-form"
                onSubmit={(e) => {
                  void (sent ? verify(e) : sendCode(e));
                }}
              >
                <label htmlFor="account-email">{t("E-mail")}</label>
                <input
                  id="account-email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  maxLength={254}
                  required
                  value={email}
                  readOnly={sent}
                  disabled={busy || !session.supported}
                  onChange={(e) => setEmail(e.target.value)}
                />
                {sent && (
                  <>
                    <label htmlFor="account-code">
                      {t("Código de seis dígitos")}
                    </label>
                    <input
                      id="account-code"
                      type="text"
                      autoComplete="one-time-code"
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      required
                      value={code}
                      disabled={busy}
                      onChange={(e) =>
                        setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                      }
                    />
                    <p className="account-hint">
                      {t("Confira seu e-mail. O código vale por 10 minutos.")}
                    </p>
                  </>
                )}
                <button
                  className="button primary"
                  type="submit"
                  disabled={
                    busy ||
                    !session.supported ||
                    !email.trim() ||
                    (sent && code.length !== 6) ||
                    (!sent && remaining > 0)
                  }
                >
                  {busy
                    ? t("Aguarde…")
                    : sent
                      ? t("Entrar")
                      : t("Enviar código")}
                </button>
                {sent && (
                  <div className="account-actions">
                    <button
                      className="button secondary"
                      type="button"
                      disabled={busy || remaining > 0}
                      onClick={() => void sendCode()}
                    >
                      {remaining
                        ? t("Reenviar em {seconds}s", { seconds: remaining })
                        : t("Reenviar código")}
                    </button>
                    <button
                      className="button secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setSent(false);
                        setCode("");
                        setError("");
                        setDeadline(0);
                        clearPendingLogin();
                      }}
                    >
                      {t("Trocar e-mail")}
                    </button>
                  </div>
                )}
                {!sent && remaining > 0 && (
                  <p className="account-hint" role="status">
                    {t("Você pode pedir outro código em {seconds}s.", {
                      seconds: remaining,
                    })}
                  </p>
                )}
              </form>
            </section>
          )}
        </>
      )}
      {privacy && (
        <a
          className="account-privacy"
          href={privacy}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => {
            if (isTauri) {
              e.preventDefault();
              void api
                .openPrivacy()
                .catch((cause) => setError(accountFailure(cause).message));
            }
          }}
        >
          {t("Como usamos seus dados")}
        </a>
      )}
      {confirmation && (
        <Modal
          title={t(
            confirmation === "delete"
              ? "Excluir minha conta"
              : confirmation === "all"
                ? "Sair de todos os aparelhos"
                : "Sair deste computador",
          )}
          onClose={() => {
            if (!busy) setConfirmation(null);
          }}
        >
          <div className="account-confirm">
            <p>
              {t(
                confirmation === "delete"
                  ? "Esta ação apaga sua conta, sessões, pedidos, amizades e bloqueios. Não é possível desfazer. Seus jogos e saves locais permanecem."
                  : confirmation === "all"
                    ? "Todas as sessões serão encerradas, incluindo a deste computador."
                    : "A sessão será removida deste computador. Outras sessões continuarão ativas.",
              )}
            </p>
            {confirmation === "delete" && (
              <>
                <label htmlFor="account-delete">
                  {t("Digite EXCLUIR para confirmar")}
                </label>
                <input
                  id="account-delete"
                  autoComplete="off"
                  value={deleteText}
                  disabled={busy}
                  onChange={(e) => setDeleteText(e.target.value)}
                />
              </>
            )}
            {error && (
              <p className="error-message" role="alert">
                {t(error)}
              </p>
            )}
            <div className="account-actions">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setConfirmation(null)}
              >
                {t("Cancelar")}
              </button>
              <button
                className={`button ${confirmation === "delete" ? "danger" : "primary"}`}
                disabled={
                  busy ||
                  (confirmation === "delete" && deleteText !== "EXCLUIR")
                }
                onClick={() => void finish()}
              >
                {busy
                  ? t("Aguarde…")
                  : t(
                      confirmation === "delete"
                        ? "Excluir definitivamente"
                        : "Confirmar",
                    )}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
