import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  socialStore,
  type Friend,
  type SocialState,
} from "../../src/services/social";
import {
  recordSocialActivity,
  SocialActivityTracker,
  clearSocialActivity,
} from "../../src/services/socialActivity";
import { partyStore } from "../../src/features/party/partySession";
import { SocialPanel } from "../../src/features/social/SocialPanel";
import {
  SocialNotice,
  SocialUnreadBadge,
} from "../../src/features/social/SocialActivity";
import { PlayTogether } from "../../src/components/PlayTogether";
import { PartyDialog } from "../../src/features/party/PartyDialog";
import "../../src/fonts.css";
import "../../src/styles.css";
import "../../src/hydra.css";

const marina: Friend = {
  id: "11111111-1111-4111-8111-111111111111",
  displayName: "Marina",
  friendCode: "marina#abcd",
  avatar: 3,
  presence: { status: "online", playing: null, party: null },
};
const bruno: Friend = {
  id: "22222222-2222-4222-8222-222222222222",
  displayName: "Bruno",
  friendCode: "bruno#abcd",
  avatar: 11,
  presence: {
    status: "online",
    playing: {
      title: "Super Mario World",
      console: "SNES",
      cover: null,
      startedAt: Date.now() - 300000,
    },
    party: { code: "ABC234", joinable: true },
  },
};
let state: SocialState = {
  friends: [marina, bruno],
  incoming: [],
  outgoing: [],
  blocked: [],
  connected: true,
  loading: false,
  error: "",
  session: {
    hasSession: true,
    online: true,
    supported: true,
    expiresAt: Date.now() + 600000,
    user: {
      id: "local",
      email: "preview@example.test",
      displayName: "Você",
      friendCode: "voce#abcd",
      avatar: 0,
      showPlaying: true,
      appearOffline: false,
      createdAt: 0,
    },
  },
};
const subscribers = new Set<() => void>();
socialStore.snapshot = () => state;
socialStore.subscribe = (fn) => {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
};
const room = {
  phase: "open" as const,
  guests: [
    { id: "guest-a", name: "Marina", avatar: 3, player: 2 },
    { id: "guest-b", name: "Bruno", avatar: 11, player: 3 },
  ],
  connected: ["guest-a", "guest-b"],
  game: "Super Mario World",
  friendsAllowed: true,
  friendsReady: true,
  friendsBusy: false,
  friendsError: "",
  error: "",
  url: "https://preview.example.test/party/ABC234",
  code: "ABC234",
  relay: false,
};
// Snapshots must retain identity between writes, just like the real stores.
partyStore.snapshot = () => room;
const tracker = new SocialActivityTracker();
tracker.seed(state.friends);
clearSocialActivity();
function simulate(party = false) {
  const current = state.friends.find((f) => f.id === marina.id)!;
  const presence = party
    ? { ...current.presence!, party: { code: "ABC234", joinable: true } }
    : {
        ...current.presence!,
        playing: {
          title: "Donkey Kong Country",
          console: "SNES",
          startedAt: Date.now(),
          cover: null,
        },
      };
  for (const event of tracker.changes(current, presence))
    recordSocialActivity(event.kind, current, event.message);
  state = {
    ...state,
    friends: state.friends.map((f) =>
      f.id === marina.id ? { ...f, presence } : f,
    ),
  };
  subscribers.forEach((fn) => fn());
}
function Preview() {
  const [panel, setPanel] = useState(true),
    [party, setParty] = useState(false),
    [view, setView] = useState<"friends" | "activity">("friends");
  return (
    <div className="app">
      <header className="header" style={{ marginLeft: 0 }}>
        <h1>Social · simulação local</h1>
        <div className="header-actions">
          <button className="button" onClick={() => simulate()}>
            Simular jogo
          </button>
          <button className="button" onClick={() => simulate(true)}>
            Simular Party
          </button>
          <button
            className="button"
            onClick={() => {
              setView("activity");
              setPanel(true);
            }}
          >
            Atividade <SocialUnreadBadge />
          </button>
          <button className="button" onClick={() => setParty(true)}>
            Ver sala
          </button>
        </div>
      </header>
      <main style={{ marginLeft: 430, padding: 32 }}>
        <PlayTogether
          onPhone={() => {}}
          onParty={() => setParty(true)}
          onFriends={() => {
            setView("friends");
            setPanel(true);
          }}
        />
      </main>
      {panel && (
        <SocialPanel
          notify={() => {}}
          initialView={view}
          onJoinParty={() => {}}
          onClose={() => setPanel(false)}
        />
      )}
      {party && <PartyDialog onClose={() => setParty(false)} />}
      <SocialNotice
        onOpen={(next) => {
          setView(next);
          setPanel(true);
        }}
      />
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}>
    <Preview />
  </QueryClientProvider>,
);
