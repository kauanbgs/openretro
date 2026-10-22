import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, Globe2, LogIn } from "lucide-react";
import { Modal } from "../../components/Modal";
import { bridge } from "../../services/bridge";
import { NETPLAY_DEFAULT_PORT, type NetplaySession } from "../../types";

/** Host or join a direct-IP netplay session for one library game. */
export function NetplayDialog({
  title,
  onStart,
  onClose,
  notify,
}: {
  title: string;
  onStart: (session: NetplaySession) => void;
  onClose: () => void;
  notify: (message: string) => void;
}) {
  const [role, setRole] = useState<NetplaySession["role"]>("host");
  const [address, setAddress] = useState("");
  const [port, setPort] = useState(String(NETPLAY_DEFAULT_PORT));
  const [password, setPassword] = useState("");
  const profiles = useQuery({
    queryKey: ["player-profiles"],
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
  const ready = validPort && (role === "host" || address.trim().length > 0);
  const shared = localAddress.data
    ? portNumber === NETPLAY_DEFAULT_PORT
      ? localAddress.data
      : `${localAddress.data}:${portNumber}`
    : undefined;
  return (
    <Modal title="Jogar online" onClose={onClose}>
      <div className="tabs" role="tablist">
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
        {role === "host" ? (
          <>
            <p className="hint">
              Você hospeda {title} e os outros jogadores entram pelo seu
              endereço. Todos precisam ter o mesmo arquivo do jogo.
            </p>
            <label>
              Seu endereço na rede local
              <div className="input-action">
                <input
                  readOnly
                  value={shared ?? "Não foi possível descobrir"}
                />
                <button
                  className="icon-button"
                  aria-label="Copiar endereço"
                  disabled={!shared}
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(shared!)
                      .then(() => notify("Endereço copiado."))
                  }
                >
                  <Copy size={17} />
                </button>
              </div>
            </label>
            <p className="hint">
              Pela internet, passe o seu IP público. O OpenRetro tenta abrir a
              porta no roteador (UPnP). Se não der, abra a porta {portNumber}{" "}
              manualmente ou usem uma VPN de jogos como Tailscale, ZeroTier ou
              Radmin VPN e passem o endereço dela.
            </p>
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
        <label>
          Porta
          <input
            inputMode="numeric"
            value={port}
            onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))}
          />
        </label>
        <label>
          Senha da partida (opcional)
          <input
            value={password}
            maxLength={64}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={
              role === "host"
                ? "Quem entrar vai precisar dela"
                : "A senha que o anfitrião definiu"
            }
          />
        </label>
        {!validPort && (
          <p className="error-message">Use uma porta entre 1024 e 65535.</p>
        )}
        <button
          className="button primary full"
          disabled={!ready}
          onClick={() =>
            onStart({
              role,
              address: role === "join" ? address.trim() : undefined,
              port: portNumber,
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
