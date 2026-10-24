export const isTauri = true,
  isRemote = false,
  hasBackend = true;
export const backendAvailable = () => true;
export const convertFileSrc = (value: string) => value;
const callbacks = new Set<(event: { payload: unknown }) => void>();
export async function listen(
  _event: string,
  fn: (event: { payload: unknown }) => void,
) {
  callbacks.add(fn);
  return () => {
    callbacks.delete(fn);
  };
}
const names = ["Marina", "Bruno", "Joana", "Lucas", "Bia", "Rafael"];
const people = Array.from({ length: 30 }, (_, i) => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
  displayName: names[i % names.length] + (i >= names.length ? ` ${i + 1}` : ""),
  friendCode: `${names[i % names.length].toLowerCase()}#${String(i).padStart(4, "0")}`,
  avatar: i % 15,
  relationship: i === 1 ? "friend" : "none",
}));
const user = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "local@example.test",
  displayName: "Jogador local",
  friendCode: "jogador#abcd",
  avatar: 4,
  discoverable: true,
  shareHistory: true,
  showPlaying: true,
  appearOffline: false,
  createdAt: 0,
};
const session = () => ({
  supported: true,
  hasSession: true,
  online: true,
  expiresAt: Date.now() + 600000,
  user: { ...user },
});
export async function invoke(
  command: string,
  args: Record<string, any> = {},
): Promise<any> {
  if (command === "account_session") return session();
  if (command === "account_profile") {
    Object.assign(user, args.patch);
    return session();
  }
  if (command === "social_start") {
    queueMicrotask(() =>
      callbacks.forEach((fn) => fn({ payload: { type: "connected" } })),
    );
    return;
  }
  if (["social_stop", "social_idle"].includes(command)) return;
  if (command === "social_friends")
    return {
      friends: people.filter((p) => p.relationship === "friend"),
      incoming: [],
      outgoing: people.filter((p) => p.relationship === "outgoing"),
      blocked: [],
    };
  if (command === "social_people") {
    if (new URLSearchParams(location.search).has("error"))
      throw {
        message: "Não foi possível carregar as pessoas. (servidor simulado)",
      };
    const offset = args.after
      ? people.findIndex((p) => p.id === args.after) + 1
      : 0;
    const rows = people.slice(offset, offset + 24).map((p) => ({ ...p }));
    return {
      people: rows,
      next: offset + rows.length < people.length ? rows.at(-1)?.id : null,
    };
  }
  if (command === "social_person") {
    const row =
      args.userId === user.id
        ? { ...user, relationship: "none" }
        : people.find((p) => p.id === args.userId);
    if (!row) throw { message: "Este perfil não está disponível." };
    const self = row.id === user.id;
    const visible =
      self || (row.relationship === "friend" && user.shareHistory);
    return {
      ...row,
      isSelf: self,
      createdAt: 1700000000000,
      historyVisible: visible,
      presence: {
        status: "online",
        playing: {
          title: "Super Mario World",
          console: "Super Nintendo",
          cover: "/web/public/art/mario-world.jpg",
          startedAt: Date.now(),
        },
        party: { code: "ABCDEF", joinable: true },
      },
      recentGames: visible
        ? [
            {
              title: "Super Mario World",
              console: "Super Nintendo",
              cover: "/web/public/art/mario-world.jpg",
              lastPlayedAt: Date.now(),
              playSeconds: 2340,
            },
            {
              title: "Sonic the Hedgehog",
              console: "Master System",
              cover: "/web/public/art/sonic.jpg",
              lastPlayedAt: Date.now() - 86400000,
              playSeconds: 1500,
            },
            {
              title: "The Legend of Zelda: A Link to the Past",
              console: "Super Nintendo",
              cover: "/web/public/art/zelda.jpg",
              lastPlayedAt: Date.now() - 172800000,
              playSeconds: 5100,
            },
          ]
        : [],
    };
  }
  if (command === "social_action") {
    const row = people.find(
      (p) => p.friendCode === args.target || p.id === args.target,
    );
    if (row)
      row.relationship =
        args.action === "request"
          ? "outgoing"
          : args.action === "accept"
            ? "friend"
            : "none";
    return;
  }
  if (command === "social_game_busy") return false;
  throw new Error(`Unsupported fixture command: ${command}`);
}
