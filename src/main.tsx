import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const App = lazy(() => import("./App").then(({ App }) => ({ default: App })));
import "@fontsource-variable/manrope/wght.css";
import "@fontsource-variable/space-grotesk/wght.css";
import "./styles.css";
const InGameOverlay = lazy(() =>
  import("./features/in-game/InGameOverlay").then(({ InGameOverlay }) => ({
    default: InGameOverlay,
  })),
);
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
      <Suspense
        fallback={
          inGameWindow ? null : <div role="status">Iniciando OpenRetro…</div>
        }
      >
        {inGameWindow ? <InGameOverlay /> : <App />}
      </Suspense>
    </QueryClientProvider>
  </React.StrictMode>,
);
