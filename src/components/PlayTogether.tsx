import { useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { Gamepad2, Smartphone, Users, Wifi } from "lucide-react";
import { bridge, isDesktop, isRemote } from "../services/bridge";
import { partyStore } from "../features/party/partySession";
import { t } from "../i18n";
import "./PlayTogether.css";
import { socialStore, sortFriends } from "../services/social";
import { AccountAvatar } from "../features/social/accountAvatars";
import { messagesStore, unreadTotal } from "../services/messages";

export function usePlayTogether() {
  const party = useSyncExternalStore(partyStore.subscribe, partyStore.snapshot);
  const social = useSyncExternalStore(
    socialStore.subscribe,
    socialStore.snapshot,
  );
  const phone = useQuery({
    queryKey: ["remote-play"],
    queryFn: bridge.remotePlayStatus,
    enabled: isDesktop && !isRemote,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });
  const devices = phone.data?.devices ?? 0;
  const messages = useSyncExternalStore(
    messagesStore.subscribe,
    messagesStore.snapshot,
  );
  return {
    unreadMessages: unreadTotal(messages.conversations),
    party,
    account: social.session.user,
    friends: sortFriends(social.friends).filter(
      (f) => f.presence && f.presence.status !== "offline",
    ),
    phoneActive: !!phone.data?.running,
    phoneDescription: devices
      ? devices === 1
        ? t("1 celular conectado")
        : t("{count} celulares conectados", { count: devices })
      : phone.data?.running
        ? t("Aguardando seu celular conectar.")
        : t("Leve seus jogos para outra tela."),
    partyActive: party.phase === "open",
    partyDescription:
      party.phase === "open"
        ? t("Party aberto · {count}/4 jogadores", {
            count: 1 + party.connected.length,
          })
        : party.phase === "connecting"
          ? t("Abrindo Party…")
          : t("Abra uma partida e convide seus amigos."),
  };
}

export function PlayTogether({
  onPhone,
  onParty,
  onFriends,
}: {
  onPhone: () => void;
  onParty: () => void;
  onFriends: () => void;
}) {
  const state = usePlayTogether();
  return (
    <section className="play-together" aria-label={t("Jogar junto")}>
      <button
        className="play-together-card play-together-phone"
        onClick={onPhone}
      >
        <span className="play-together-copy">
          <strong>{t("Jogar no celular")}</strong>
          <span>{state.phoneDescription}</span>
          <b>
            {state.phoneActive ? t("Gerenciar conexão") : t("Conectar celular")}
          </b>
        </span>
        <span className="play-together-art" aria-hidden="true">
          <Smartphone strokeWidth={1.4} />
          <Wifi className="play-together-symbol" />
        </span>
      </button>
      <button
        className="play-together-card play-together-party"
        onClick={onParty}
      >
        <span className="play-together-copy">
          <strong>{t("Jogar com amigos")}</strong>
          <span>{state.partyDescription}</span>
          {state.partyActive && (
            <span className="play-together-members">
              <AccountAvatar avatar={state.account?.avatar} size={28} />
              {state.party.guests.map((guest) => (
                <span key={guest.id} title={guest.name}>
                  <AccountAvatar avatar={guest.avatar} size={28} />
                </span>
              ))}
            </span>
          )}
          <b>{state.partyActive ? t("Gerenciar Party") : t("Criar Party")}</b>
        </span>
        <span className="play-together-art" aria-hidden="true">
          <Gamepad2 strokeWidth={1.4} />
          <Users className="play-together-symbol" />
        </span>
      </button>
      {state.friends.length > 0 && (
        <button className="play-together-friends" onClick={onFriends}>
          <span className="play-together-friend-icons" aria-hidden="true">
            {state.friends.slice(0, 4).map((friend) => (
              <AccountAvatar key={friend.id} avatar={friend.avatar} size={30} />
            ))}
          </span>
          <span>
            <strong>
              {state.friends.length === 1
                ? t("1 amigo online")
                : t("{count} amigos online", { count: state.friends.length })}
            </strong>
            <small>
              {state.unreadMessages
                ? t("{count} mensagens não lidas", {
                    count: state.unreadMessages,
                  })
                : state.friends.filter((f) => f.presence?.party?.joinable)
                      .length
                  ? t("Tem Party aberto. Entre para jogar junto!")
                  : state.friends.some((f) => f.presence?.playing)
                    ? t("Veja o que seus amigos estão jogando")
                    : t("Encontre sua próxima companhia de jogo")}
            </small>
          </span>
          <b>{t("Ver amigos")}</b>
        </button>
      )}
    </section>
  );
}
