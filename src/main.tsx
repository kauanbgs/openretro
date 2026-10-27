import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const App = lazy(() => import("./App").then(({ App }) => ({ default: App })));
import "./fonts.css";
import "./styles.css";
import "./hydra.css";
import { isRemote } from "./services/transport";
import { bridge } from "./services/bridge";
import { adoptLanguage } from "./i18n";
import { t } from "./i18n";
// A paired phone gets the touch layout in hydra.css.
document.documentElement.classList.toggle("remote", isRemote);
const InGameOverlay = lazy(() =>
  import("./features/in-game/InGameOverlay").then(({ InGameOverlay }) => ({
    default: InGameOverlay,
  })),
);
const PartyChatOverlay = lazy(() =>
  import("./features/party/PartyChatOverlay").then(({ PartyChatOverlay }) => ({
    default: PartyChatOverlay,
  })),
);
const flags = window as Window & {
  __OPENRETRO_GAME_MENU__?: boolean;
  __OPENRETRO_PARTY_CHAT__?: boolean;
};
const partyChatWindow = Boolean(flags.__OPENRETRO_PARTY_CHAT__);
const inGameWindow = Boolean(flags.__OPENRETRO_GAME_MENU__) || partyChatWindow;
const client = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30000,
      gcTime: 120000,
      refetchOnWindowFocus: true,
    },
  },
});
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={client}>
      <Suspense
        fallback={
          inGameWindow ? null : (
            <div className="app-boot" role="status">
              {t("Iniciando OpenRetro…")}
            </div>
          )
        }
      >
        {partyChatWindow ? (
          <PartyChatOverlay />
        ) : inGameWindow ? (
          <InGameOverlay />
        ) : (
          <App />
        )}
      </Suspense>
    </QueryClientProvider>
  </React.StrictMode>,
);
// The window starts in the cached language; the saved choice wins, reloading
// once when they differ (first start, another device, or a changed setting).
bridge.settings().then(
  (settings) => adoptLanguage(settings.interfaceLanguage),
  () => undefined,
);
