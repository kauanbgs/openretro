import { useState, type ReactElement, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, LoaderCircle } from "lucide-react";
import { bridge } from "../../services/bridge";
import { t } from "../../i18n";
import { failed } from "../../utils/notice";
import { sourceUrlFromPairing } from "../../services/libraryServer";

/**
 * Remote access, explained without jargon: the app installs and signs in to
 * Tailscale by itself, and this shows where that stands.
 */
export function RemoteAccess({
  notify,
  hideWhenReady = false,
}: {
  notify: (message: string) => void;
  hideWhenReady?: boolean;
}) {
  const client = useQueryClient();
  const { data } = useQuery({
    queryKey: ["tailscale"],
    queryFn: bridge.tailscaleStatus,
    refetchInterval: (query) => (query.state.data?.setup.running ? 1000 : 5000),
  });
  async function start() {
    try {
      await bridge.tailscaleSetup();
      await client.invalidateQueries({ queryKey: ["tailscale"] });
    } catch (error) {
      notify(failed(error));
    }
  }
  if (!data || (data.state === "ready" && hideWhenReady)) return null;
  const { setup } = data;
  let body: ReactNode;
  if (data.state === "ready") {
    body = <p>{t("Ativo. Seus outros PCs acessam este de qualquer lugar.")}</p>;
  } else if (setup.running) {
    body = (
      <p role="status">
        <LoaderCircle className="spin" size={14} />{" "}
        {setup.stage === "downloading"
          ? t("Baixando o acesso remoto… {percent}%", {
              percent: setup.percent,
            })
          : setup.stage === "installing"
            ? t(
                "Instalando… aceite a janela de permissão do Windows que abrir.",
              )
            : t(
                "Falta só entrar na sua conta. Abrimos uma página no navegador: entre ou crie uma conta grátis. Use a mesma conta no outro PC.",
              )}
      </p>
    );
  } else if (setup.stage === "failed") {
    body = (
      <>
        <p role="alert">{setup.message}</p>
        <button className="button outline" onClick={() => void start()}>
          {t("Tentar de novo")}
        </button>
      </>
    );
  } else {
    body = (
      <>
        <p>
          {data.state === "needsLogin"
            ? t("O acesso remoto já está instalado, mas falta entrar na conta.")
            : t(
                "Para jogar de outro lugar, o OpenRetro instala o Tailscale, um programa gratuito que cria uma conexão privada e segura entre os seus PCs.",
              )}
        </p>
        <button className="button primary" onClick={() => void start()}>
          {data.state === "needsLogin"
            ? t("Entrar na conta")
            : t("Ativar acesso remoto")}
        </button>
      </>
    );
  }
  return (
    <div className="setting-row">
      <div>
        <strong>{t("Acesso de fora de casa")}</strong>
        {body}
      </div>
    </div>
  );
}

/** Shares this PC's library with other OpenRetro apps, on the LAN or Tailscale. */
export function LibraryServerSettings({
  notify,
  Switch,
}: {
  notify: (message: string) => void;
  Switch: (props: {
    label: string;
    on: boolean;
    disabled?: boolean;
    onToggle: () => void;
  }) => ReactElement;
}) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const { data: status } = useQuery({
    queryKey: ["library-server"],
    queryFn: bridge.libraryServerStatus,
    refetchInterval: 3000,
  });
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      await client.invalidateQueries({ queryKey: ["library-server"] });
    } catch (error) {
      notify(failed(error));
    } finally {
      setBusy(false);
    }
  }
  const running = status?.running ?? false;
  const address = (host: string) => `${host}:${status?.port}`;
  const copy = (link: string | null) =>
    void navigator.clipboard.writeText(link ?? "").then(() => setCopied(link));
  return (
    <>
      <div className="setting-row">
        <div>
          <strong>{t("Compartilhar minha biblioteca")}</strong>
          <p>
            {t(
              "Deixa outro OpenRetro listar e baixar os jogos deste PC. Só quem tem o link de pareamento consegue acessar.",
            )}
          </p>
        </div>
        <Switch
          label={t("Compartilhar minha biblioteca")}
          on={running}
          disabled={busy}
          onToggle={() =>
            void run(async () => {
              if (running) return bridge.libraryServerStop();
              await bridge.libraryServerStart();
              // Nobody has to know what remote access is: it is set up now,
              // unless only the local network was asked for.
              if (status?.lanEnabled) return;
              const access = await bridge.tailscaleStatus();
              if (access.state !== "ready" && !access.setup.running)
                await bridge.tailscaleSetup();
              await client.invalidateQueries({ queryKey: ["tailscale"] });
            })
          }
        />
      </div>
      <div className="setting-row">
        <div>
          <strong>{t("Também pela rede local")}</strong>
          <p>
            {t(
              "Deixa PCs da sua casa conectarem sem instalar nada. A rede local não é criptografada: ligue só em uma rede em que você confia.",
            )}
          </p>
        </div>
        <Switch
          label={t("Também pela rede local")}
          on={status?.lanEnabled ?? false}
          disabled={busy}
          onToggle={() =>
            void run(() => bridge.libraryServerSetLan(!status?.lanEnabled))
          }
        />
      </div>
      {running && status && (
        <>
          <div className="setting-row">
            <div>
              <strong>{t("Endereço")}</strong>
              {status.tailscale && (
                <code className="path-text">
                  {address(status.tailscale)} · Tailscale
                </code>
              )}
              {status.lan && (
                <code className="path-text">
                  {address(status.lan)} · {t("rede local")}
                </code>
              )}
            </div>
          </div>
          <RemoteAccess notify={notify} />
          <div className="setting-row">
            <div>
              <strong>{t("Parear outro PC")}</strong>
              <p>
                {t(
                  "No outro OpenRetro, adicione este servidor com o link abaixo. Trate o link como uma senha.",
                )}
              </p>
              <div className="library-server-pairing">
                {status.qr && (
                  <div
                    className="phone-play-qr"
                    role="img"
                    aria-label={t("QR code do link de pareamento")}
                    dangerouslySetInnerHTML={{ __html: status.qr }}
                  />
                )}
                <div className="input-action">
                  <input
                    readOnly
                    aria-label={t("Link de pareamento")}
                    value={status.url ?? ""}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <button
                    className="button outline"
                    onClick={() => copy(status.url)}
                  >
                    {copied === status.url ? (
                      <Check size={15} />
                    ) : (
                      <Copy size={15} />
                    )}
                    {copied === status.url ? t("Copiado") : t("Copiar")}
                  </button>
                </div>
              </div>
            </div>
          </div>
          {status.lanUrl && status.lanUrl !== status.url && (
            <div className="setting-row">
              <div>
                <strong>{t("Link para a rede local")}</strong>
                <p>
                  {t(
                    "Para PCs na mesma casa. Fora dela, use o link de acesso remoto.",
                  )}
                </p>
                <div className="input-action">
                  <input
                    readOnly
                    aria-label={t("Link para a rede local")}
                    value={status.lanUrl}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <button
                    className="button outline"
                    onClick={() => copy(status.lanUrl)}
                  >
                    {copied === status.lanUrl ? (
                      <Check size={15} />
                    ) : (
                      <Copy size={15} />
                    )}
                    {copied === status.lanUrl ? t("Copiado") : t("Copiar")}
                  </button>
                </div>
              </div>
            </div>
          )}
          <div className="setting-row">
            <div>
              <strong>{t("Jogos compartilhados")}</strong>
              <p>
                {t(
                  "Jogos instalados que são um único arquivo. Pastas ficam de fora por enquanto.",
                )}{" "}
                <b>{status.games}</b>
              </p>
            </div>
          </div>
          <div className="setting-row">
            <div>
              <strong>{t("Novo link de pareamento")}</strong>
              <p>
                {confirmReset
                  ? t(
                      "Isso desconecta todos os PCs já pareados, que precisarão do novo link. Confirmar?",
                    )
                  : t(
                      "Use se o link vazou ou se quiser desconectar os PCs pareados.",
                    )}
              </p>
            </div>
            {confirmReset ? (
              <div className="input-action">
                <button
                  className="button danger"
                  disabled={busy}
                  onClick={() => {
                    setConfirmReset(false);
                    setCopied(null);
                    void run(() => bridge.libraryServerResetToken());
                  }}
                >
                  {t("Gerar novo link")}
                </button>
                <button
                  className="button outline"
                  onClick={() => setConfirmReset(false)}
                >
                  {t("Cancelar")}
                </button>
              </div>
            ) : (
              <button
                className="button outline"
                disabled={busy}
                onClick={() => setConfirmReset(true)}
              >
                <KeyRound size={15} /> {t("Gerar novo link")}
              </button>
            )}
          </div>
        </>
      )}
    </>
  );
}

/** Adds another PC's shared library as a download source. */
export function ConnectToLibrary({
  notify,
}: {
  notify: (message: string) => void;
}) {
  const client = useQueryClient();
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  async function connect() {
    setBusy(true);
    try {
      const { url, lan } = sourceUrlFromPairing(link);
      // A local-network link needs no remote access on this PC.
      const access = lan ? null : await bridge.tailscaleStatus();
      if (access && access.state !== "ready") {
        if (!access.setup.running) await bridge.tailscaleSetup();
        await client.invalidateQueries({ queryKey: ["tailscale"] });
        notify(
          t(
            "Antes de conectar, o OpenRetro configura o acesso remoto neste PC. Quando terminar, toque em Conectar de novo.",
          ),
        );
        return;
      }
      await bridge.saveDownloadSource(null, url);
      await client.invalidateQueries({ queryKey: ["download-sources"] });
      setLink("");
      notify(t("Biblioteca conectada. Os jogos aparecem como downloads."));
    } catch (error) {
      notify(failed(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="setting-row">
        <div>
          <strong>{t("Conectar a outro PC")}</strong>
          <p>
            {t(
              "Cole o link de pareamento mostrado no outro OpenRetro. Os jogos dele passam a aparecer como downloads, e o app baixa, extrai e adiciona à sua biblioteca.",
            )}
          </p>
          <form
            className="input-action"
            onSubmit={(e) => {
              e.preventDefault();
              if (link.trim() && !busy) void connect();
            }}
          >
            <input
              aria-label={t("Link de pareamento")}
              placeholder="http://100.x.x.x:47821/?t=…"
              value={link}
              onChange={(e) => setLink(e.target.value)}
            />
            <button
              className="button primary"
              type="submit"
              disabled={busy || !link.trim()}
            >
              {t("Conectar")}
            </button>
          </form>
        </div>
      </div>
      <RemoteAccess notify={notify} hideWhenReady />
    </>
  );
}
