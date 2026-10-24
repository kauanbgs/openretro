// Isolated visual fixture. None of these records enter the user's library.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ArrowLeft, Search } from "lucide-react";
import { GamePage } from "../../src/features/games/GamePage";
import type { GameMetadata } from "../../src/types";
import "../../src/fonts.css";
import "../../src/styles.css";
import "../../src/hydra.css";
import "../../src/features/games/GamePage.css";

const params = new URLSearchParams(location.search);
if (params.has("mobile")) document.documentElement.classList.add("remote");
if (params.has("light")) document.documentElement.dataset.theme = "light";
const game: GameMetadata = {
  id: "game-page-fixture",
  title: params.has("long")
    ? "Super Mario Kart: A very long game title for a small screen"
    : "Super Mario Kart",
  platformId: "snes",
  year: 1992,
  developer: "Nintendo EAD",
  publisher: "Nintendo",
  genre: "Corrida",
  artwork: "neutral",
  color: "#cc272c",
  backgroundUrl: "/web/public/art/mario-kart-scene.png",
  coverUrl: "/web/public/art/mario-kart.jpg",
  screenshots: params.has("empty")
    ? []
    : [
        "/web/public/art/mario-kart-scene.png",
        "/web/public/art/mario-kart.jpg",
        "/web/public/art/mario-world.jpg",
      ],
  rating: 4.7,
  ratingCount: 128,
  maxPlayers: 2,
  gameModes: ["Multiplayer", "Split-screen"],
  description:
    "Acelere pelos circuitos do Reino dos Cogumelos com Mario e seus amigos. Escolha seu piloto, domine as curvas e use os itens da pista para alcançar o primeiro lugar. Dispute o Grand Prix ou desafie um amigo nas corridas e batalhas para dois jogadores.",
};
const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
function Preview() {
  const [notice, setNotice] = useState("");
  return (
    <QueryClientProvider client={client}>
      <div
        className="app"
        style={{
          display: "block",
          width: params.has("mobile") ? 390 : "100%",
          maxWidth: "100%",
          margin: "0 auto",
        }}
      >
        <header
          className="header"
          style={{
            position: "relative",
            inset: "auto",
            width: "100%",
            margin: 0,
            padding: "0 24px",
          }}
        >
          <ArrowLeft size={17} />
          <h1>{game.title}</h1>
          <div className="header-actions">
            <Search size={16} />
          </div>
        </header>
        <GamePage
          game={game}
          emulators={[]}
          onBack={() => {}}
          onSelect={() => {}}
          onImport={() => setNotice("Adicionar arquivo selecionado")}
          onEmulators={() => {}}
          refresh={async () => {}}
          notify={setNotice}
        />
        {notice && <div role="status">{notice}</div>}
      </div>
    </QueryClientProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Preview />);
