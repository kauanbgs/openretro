import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, Globe2, LogIn } from "lucide-react";
import { Modal } from "../../components/Modal";
import { bridge } from "../../services/bridge";
import {
  checkInviteGame,
  createNetplayInvite,
  parseNetplayInvite,
  validNetplayHost,
} from "../../services/netplayInvites";
import { NETPLAY_DEFAULT_PORT, type NetplaySession } from "../../types";

/** VPN invitations wrap the existing direct-IP transport; no room server is needed. */
export function NetplayDialog({
  title,
  platformId,
  sha256,
  onStart,
  onClose,
  notify,
}: {
  title: string;
  platformId: string;
  sha256: string;
  onStart: (session: NetplaySession) => void;
  onClose: () => void;
  notify: (message: string) => void;
}) {
  const [role, setRole] = useState<NetplaySession["role"]>("host");
  const [joinMode, setJoinMode] = useState("invite");
  const [hostAddress, setHostAddress] = useState("");
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [port, setPort] = useState(String(NETPLAY_DEFAULT_PORT));
  const [password, setPassword] = useState("");
  const profiles = useQuery({
    queryKey: ["players"],
    queryFn: () => bridge.profiles(),
  });
  const localAddress = useQuery({
    queryKey: ["netplay-local-address"],
    queryFn: () => bridge.netplayLocalAddress(),
    enabled: role === "host",
  });
  const nickname = profiles.data?.players.find(
    (p) => p.id === profiles.data?.activeId,
  )?.name;
  const portNumber = Number(port);
  const validPort =
    Number.isInteger(portNumber) && portNumber >= 1024 && portNumber <= 65535;
  let inviteError = "";
  let invite: ReturnType<typeof parseNetplayInvite> | undefined;
  if (role === "join" && joinMode === "invite" && code.trim()) {
    try {
      invite = parseNetplayInvite(code);
      checkInviteGame(invite, platformId, sha256);
    } catch (error) {
      invite = undefined;
      inviteError = (error as Error).message;
    }
  }
  let hostCode = "";
  if (role === "host" && validPort && validNetplayHost(hostAddress.trim())) {
    try {
      hostCode = createNetplayInvite({
        address: hostAddress.trim(),
        port: portNumber,
        title,
        platformId,
        sha256,
      });
    } catch {
      /* Legacy imports without a fingerprint can still use direct IP. */
    }
  }
  const usingInvite = role === "join" && joinMode === "invite";
  const ready = usingInvite
    ? Boolean(invite)
    : validPort && (role === "host" || Boolean(address.trim()));

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(hostCode);
      notify("Convite copiado. Inicie a partida antes de seu amigo entrar.");
    } catch {
      notify("Selecione e copie o código no campo Convite.");
    }
  }

  return (
    <Modal title="Jogar online" onClose={onClose}>
      <div className="tabs" role="tablist" aria-label="Modo de conexão">
        {(
          [
            ["host", "Hospedar partida"],
            ["join", "Entrar em uma partida"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={role === value}
            className={role === value ? "selected" : ""}
            onClick={() => setRole(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="form-stack">
        <p className="hint">
          Em redes diferentes, conectem os dispositivos à mesma rede do
          Tailscale ou Radmin VPN antes de jogar. Cada PC precisa do mesmo jogo
          e core compatível.
        </p>
        {role === "host" ? (
          <>
            <p className="hint">
              Você hospeda {title}. Gere o convite e depois escolha Hospedar e
              jogar.
            </p>
            <label>
              Seu endereço na VPN (sem porta)
              <input
                value={hostAddress}
                maxLength={253}
                onChange={(e) => setHostAddress(e.target.value)}
                placeholder="Ex.: 100.64.0.2 — copie do aplicativo da VPN"
              />
            </label>
            <p className="hint">
              Endereço local detectado: {localAddress.data ?? "indisponível"}.
              Para jogar pela VPN, use o endereço mostrado nela. Na mesma rede
              Wi-Fi, você pode usar o endereço local.
            </p>
            {hostAddress.trim() && !validNetplayHost(hostAddress.trim()) && (
              <p className="error-message" role="alert">
                Digite somente o IP ou nome do computador, sem porta.
              </p>
            )}
            {hostCode && (
              <label>
                Convite
                <div className="input-action">
                  <input
                    readOnly
                    value={hostCode}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <button
                    className="icon-button"
                    aria-label="Copiar convite"
                    onClick={() => void copyInvite()}
                  >
                    <Copy size={17} />
                  </button>
                </div>
              </label>
            )}
            {hostAddress.trim() &&
              validPort &&
              validNetplayHost(hostAddress.trim()) &&
              !hostCode && (
                <p className="hint">
                  Não foi possível gerar um convite com os dados deste jogo. Use
                  a conexão por endereço.
                </p>
              )}
            <p className="hint">
              O convite contém o endereço e os dados do jogo, sem a senha. Ele
              não cria uma VPN nem abre portas. Pela internet sem VPN, use seu
              IP público e permita a porta {portNumber} no roteador.
            </p>
          </>
        ) : (
          <>
            <label>
              Entrar usando
              <select
                value={joinMode}
                onChange={(e) => setJoinMode(e.target.value)}
              >
                <option value="invite">Convite do OpenRetro</option>
                <option value="address">Endereço e porta</option>
              </select>
            </label>
            {usingInvite ? (
              <>
                <label>
                  Código de convite
                  <input
                    autoFocus
                    value={code}
                    maxLength={4096}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="Cole o código OPENRETRO1.…"
                    spellCheck={false}
                  />
                </label>
                {inviteError && (
                  <p className="error-message" role="alert">
                    {inviteError}
                  </p>
                )}
                {invite && (
                  <p className="hint" role="status">
                    Arquivo e console conferidos: {invite.title}. Conexão com{" "}
                    {invite.address}, porta {invite.port}. O runtime verifica a
                    compatibilidade do core ao conectar. Aguarde o anfitrião
                    iniciar.
                  </p>
                )}
              </>
            ) : (
              <label>
                Endereço de quem está hospedando
                <input
                  autoFocus
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="192.168.0.10 ou 100.64.0.2:55435"
                />
              </label>
            )}
          </>
        )}
        {!usingInvite && (
          <label>
            Porta
            <input
              inputMode="numeric"
              value={port}
              onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
            />
          </label>
        )}
        <label>
          Senha da partida (opcional)
          <input
            value={password}
            maxLength={64}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={
              role === "host"
                ? "Compartilhe separadamente do convite"
                : "Digite a senha informada pelo anfitrião"
            }
          />
        </label>
        {!usingInvite && !validPort && (
          <p className="error-message" role="alert">
            Use uma porta entre 1024 e 65535.
          </p>
        )}
        <button
          className="button primary full"
          disabled={!ready}
          onClick={() =>
            onStart({
              role,
              address: usingInvite
                ? invite!.address
                : role === "join"
                  ? address.trim()
                  : undefined,
              port: usingInvite ? invite!.port : portNumber,
              nickname,
              password: password || undefined,
            })
          }
        >
          {role === "host" ? <Globe2 size={17} /> : <LogIn size={17} />}{" "}
          {role === "host" ? "Hospedar e jogar" : "Entrar e jogar"}
        </button>
      </div>
    </Modal>
  );
}
