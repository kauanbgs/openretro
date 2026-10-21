import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import "@fontsource-variable/manrope/wght.css";
import "@fontsource-variable/space-grotesk/wght.css";
import "./styles.css";
import { InGameOverlay } from "./features/in-game/InGameOverlay";
const inGameWindow = Boolean(
  (window as Window & { __OPENRETRO_GAME_MENU__?: boolean })
    .__OPENRETRO_GAME_MENU__,
);
const client = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } },
});
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      {inGameWindow ? <InGameOverlay /> : <App />}
    </QueryClientProvider>
  </React.StrictMode>,
);
