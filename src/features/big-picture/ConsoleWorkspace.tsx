import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { ChevronLeft, Plus, RefreshCw } from "lucide-react";
import type {
  DownloadJob,
  Emulator,
  GameMetadata,
  ImportCandidate,
  LibraryGame,
} from "../../types";
import { ControllerKeyboard } from "./ControllerKeyboard";
import {
  changeField,
  nextControl,
  type Direction,
} from "./workspaceNavigation";
import {
  registerFilePicker,
  type FilePickerRequest,
} from "../../services/bridge";
import { ConsoleFilePicker } from "./ConsoleFilePicker";
import "./ConsoleWorkspace.css";
import { UserProfile } from "../social/UserProfile";
import { SocialPanel } from "../social/SocialPanel";
import { PartyGuestScreen } from "../party/PartyGuestScreen";
import { partyOwnsInput } from "../party/partyInput";
import type { Friend } from "../../services/social";
import { t } from "../../i18n";

const SettingsPage = lazy(() =>
  import("../settings/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);
const DownloadsPage = lazy(() =>
  import("../downloads/DownloadsPage").then((m) => ({
    default: m.DownloadsPage,
  })),
);
const GamePage = lazy(() =>
  import("../games/GamePage").then((m) => ({ default: m.GamePage })),
);
const ImportDialog = lazy(() =>
  import("../library/ImportDialog").then((m) => ({ default: m.ImportDialog })),
);
const SourceManager = lazy(() =>
  import("../downloads/SourceManager").then((m) => ({
    default: m.SourceManager,
  })),
);

export type WorkspacePage =
  | "settings"
  | "downloads"
  | "sources"
  | "game"
  | "import"
  | "profile"
  | "friends"
  | "party-guest";
export interface WorkspaceRoute {
  page: WorkspacePage;
  game?: GameMetadata;
  /** Open the game page with its online-play dialog showing. */
  online?: boolean;
  friend?: Friend;
  userId?: string;
  activity?: boolean;
  people?: boolean;
}
const titles: Record<WorkspacePage, string> = {
  "party-guest": t("Party"),
  friends: t("Amigos"),
  profile: t("Perfil"),
  settings: t("Configurações"),
  downloads: "Downloads",
  sources: t("Fontes de download"),
  game: t("Gerenciar jogo"),
  import: t("Adicionar jogos"),
};

export function ConsoleWorkspace({
  route,
  input,
  active,
  onContentFocus,
  library,
  emulators,
  jobs,
  refresh,
  notify,
  onClose,
  onMenu,
  onRoute,
  onImported,
  updateVersion,
  updating,
  onUpdate,
}: {
  route: WorkspaceRoute;
  input: RefObject<((key: string) => boolean) | null>;
  active: boolean;
  onContentFocus: () => void;
  library: LibraryGame[];
  emulators: Emulator[];
  jobs: DownloadJob[];
  refresh: () => Promise<void>;
  notify: (message: string) => void;
  onClose: () => void;
  onMenu: () => void;
  onRoute: (route: WorkspaceRoute) => void;
  onImported: (game: GameMetadata) => void;
  updateVersion?: string;
  updating?: boolean;
  onUpdate?: () => void;
}) {
  const root = useRef<HTMLElement>(null);
  const current = useRef<HTMLElement | null>(null);
  const controlCache = useRef<
    { scope: HTMLElement | null | undefined; nodes: HTMLElement[] } | undefined
  >(undefined);
  const routeHistory = useRef<WorkspaceRoute[]>([]);
  const navigate = (next: WorkspaceRoute) => {
    routeHistory.current.push(route);
    onRoute(next);
  };
  const back = () => {
    const previous = routeHistory.current.pop();
    if (previous) onRoute(previous);
    else onClose();
  };
  const keyboardInput = useRef<((key: string) => boolean) | null>(null);
  const [editing, setEditing] = useState<{
    field: HTMLInputElement | HTMLTextAreaElement;
    value: string;
  }>();
  const [select, setSelect] = useState<{
    field: HTMLSelectElement;
    options: HTMLOptionElement[];
    index: number;
  }>();
  const [importing, setImporting] = useState<{
    game?: GameMetadata;
    candidate?: ImportCandidate;
  }>();
  const [picker, setPicker] = useState<{
    request: FilePickerRequest;
    resolve: (path: string | null) => void;
  }>();
  const pendingPicker = useRef<((path: string | null) => void) | undefined>(
    undefined,
  );
  useEffect(
    () =>
      registerFilePicker(
        (request) =>
          new Promise((resolve) => {
            pendingPicker.current?.(null);
            pendingPicker.current = resolve;
            setPicker({ request, resolve });
          }),
      ),
    [],
  );
  useEffect(
    () => () => {
      pendingPicker.current?.(null);
    },
    [],
  );

  const scope = useCallback(() => {
    const dialogs = root.current?.querySelectorAll<HTMLElement>(
      '[role="dialog"][aria-modal="true"]',
    );
    return dialogs?.length ? dialogs[dialogs.length - 1] : root.current;
  }, []);
  const controls = useCallback(() => {
    const currentScope = scope();
    if (controlCache.current?.scope === currentScope)
      return controlCache.current.nodes;
    const nodes = Array.from(
      currentScope?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled):not([type="hidden"]):not([type="file"]), select:not(:disabled), textarea:not(:disabled), a[href], summary',
      ) ?? [],
    ).filter(
      (node) =>
        node.getClientRects().length &&
        !node.closest('[hidden], [inert], [aria-hidden="true"]'),
    );
    controlCache.current = { scope: currentScope, nodes };
    return nodes;
  }, [scope]);
  const focus = useCallback((node?: HTMLElement) => {
    if (!node) return;
    current.current?.removeAttribute("data-console-focus");
    current.current = node;
    node.setAttribute("data-console-focus", "true");
    node.focus({ preventScroll: true });
    node.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: "auto",
    });
  }, []);

  // Repair focus only when content/dialogs change, without querying each gamepad frame.
  useEffect(() => {
    let frame = 0;
    let previousScope: HTMLElement | null | undefined;
    const history: (HTMLElement | null)[] = [];
    const repair = () => {
      controlCache.current = undefined;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!active || editing || select) return;
        const nextScope = scope();
        if (nextScope !== previousScope) {
          if (
            previousScope?.isConnected &&
            nextScope?.getAttribute("role") === "dialog"
          )
            history.push(current.current);
          else {
            const restored = history.pop();
            if (restored?.isConnected && controls().includes(restored))
              focus(restored);
          }
          previousScope = nextScope;
        }
        const nodes = controls();
        if (!current.current || !nodes.includes(current.current)) {
          // Confirmations start on their close/cancel action, never a destructive button.
          focus(
            nodes.find((node) => node === document.activeElement) ?? nodes[0],
          );
        }
      });
    };
    const observer = new MutationObserver(repair);
    if (root.current)
      observer.observe(root.current, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["disabled", "hidden", "open", "aria-hidden", "style"],
      });
    repair();
    window.addEventListener("resize", repair);
    return () => {
      window.removeEventListener("resize", repair);
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [route, scope, controls, focus, editing, select, active]);

  const handle = (key: string) => {
    if (keyboardInput.current) return keyboardInput.current(key);
    if (select) {
      if (key === "b") {
        setSelect(undefined);
        focus(select.field);
      }
      if (key === "up" || key === "down")
        setSelect({
          ...select,
          index: Math.max(
            0,
            Math.min(
              select.options.length - 1,
              select.index + (key === "up" ? -1 : 1),
            ),
          ),
        });
      if (key === "a") {
        const option = select.options[select.index];
        if (option) changeField(select.field, option.value);
        setSelect(undefined);
        focus(select.field);
      }
      return true;
    }
    if (key === "b") {
      const dialog = scope();
      if (dialog?.getAttribute("role") === "dialog") {
        dialog
          .querySelector<HTMLButtonElement>(
            'header button[aria-label], button[aria-label="Close dialog"]',
          )
          ?.click();
      } else if (routeHistory.current.length) back();
      else onMenu();
      return true;
    }
    const nodes = controls();
    const active = nodes.includes(document.activeElement as HTMLElement)
      ? (document.activeElement as HTMLElement)
      : current.current;
    const index = Math.max(0, nodes.indexOf(active as HTMLElement));
    if (["up", "down", "left", "right"].includes(key)) {
      focus(
        nodes[
          nextControl(
            nodes.map((node) => node.getBoundingClientRect()),
            index,
            key as Direction,
          )
        ],
      );
    } else if (key === "lb" || key === "rb")
      focus(
        nodes[
          Math.max(
            0,
            Math.min(nodes.length - 1, index + (key === "lb" ? -1 : 1)),
          )
        ],
      );
    else if (key === "a") {
      const node = nodes[index];
      if (node instanceof HTMLSelectElement) {
        openSelect(node);
      } else if (
        (node instanceof HTMLInputElement ||
          node instanceof HTMLTextAreaElement) &&
        !["checkbox", "radio", "button", "submit", "range"].includes(
          node.type,
        ) &&
        !node.readOnly
      ) {
        setEditing({ field: node, value: node.value });
      } else node?.click();
    }
    return true;
  };
  function openSelect(field: HTMLSelectElement) {
    const options = Array.from(field.options).filter(
      (option) =>
        !option.disabled && !option.parentElement?.hasAttribute("disabled"),
    );
    setSelect({
      field,
      options,
      index: Math.max(
        0,
        options.findIndex((option) => option.value === field.value),
      ),
    });
  }
  const handler = useRef(handle);
  handler.current = handle;
  useEffect(() => {
    const forward = (key: string) => partyOwnsInput() || handler.current(key);
    input.current = forward;
    return () => {
      if (input.current === forward) input.current = null;
    };
  }, [input]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (partyOwnsInput()) return;
      if (!active) return;
      if (editing) return;
      if (
        select &&
        event.key === "Enter" &&
        event.target instanceof HTMLButtonElement
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        event.target.click();
        return;
      }
      if (event.key === "Tab") {
        const nodes = controls();
        const index = nodes.indexOf(document.activeElement as HTMLElement);
        if (nodes.length)
          focus(
            nodes[
              (index + (event.shiftKey ? -1 : 1) + nodes.length) % nodes.length
            ],
          );
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      const target = event.target;
      if (
        !select &&
        (target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement) &&
        event.key !== "Escape"
      )
        return;
      const key = (
        {
          ArrowUp: "up",
          ArrowDown: "down",
          ArrowLeft: "left",
          ArrowRight: "right",
          Escape: "b",
          Enter: "a",
        } as Record<string, string>
      )[event.key];
      if (!key || event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      handler.current(key);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [editing, select, active]);

  const imported = async (game: GameMetadata) => {
    await refresh();
    setImporting(undefined);
    onImported(game);
    notify(t("Jogo adicionado à biblioteca."));
  };
  const entry = library.find(
    (item) =>
      item.game.id === route.game?.id &&
      item.item.platformId === route.game.platformId,
  );
  if (route.page === "party-guest" && route.friend)
    return (
      <section className="tv-workspace tv-party-workspace">
        <PartyGuestScreen
          friend={route.friend}
          onClose={() => onRoute({ page: "friends" })}
        />
      </section>
    );
  return (
    <section
      ref={root}
      className="tv-workspace"
      aria-label={titles[route.page]}
      onPointerDownCapture={(event) => {
        if (
          event.target instanceof HTMLSelectElement &&
          !event.target.disabled
        ) {
          event.preventDefault();
          focus(event.target);
          openSelect(event.target);
        }
      }}
      onFocusCapture={(event) => {
        onContentFocus();
        if (
          event.target instanceof HTMLElement &&
          controls().includes(event.target)
        ) {
          current.current?.removeAttribute("data-console-focus");
          current.current = event.target;
          event.target.setAttribute("data-console-focus", "true");
        }
      }}
    >
      <header className="tv-workspace-header">
        <button onClick={back}>
          <ChevronLeft size={20} />
          {t("Voltar")}
        </button>
        <strong>{titles[route.page]}</strong>
        <div>
          {route.page === "downloads" && (
            <button onClick={() => navigate({ page: "sources" })}>
              {t("Gerenciar fontes")}
            </button>
          )}
          {route.page === "settings" && onUpdate && (
            <button disabled={updating} onClick={onUpdate}>
              <RefreshCw size={18} />
              {updating
                ? "Atualizando…"
                : updateVersion
                  ? t("Atualizar · {version}", { version: updateVersion })
                  : t("Verificar atualizações")}
            </button>
          )}
          {route.page !== "friends" && route.page !== "profile" && (
            <button onClick={() => setImporting({})}>
              <Plus size={18} />
              {t("Adicionar jogo")}
            </button>
          )}
        </div>
      </header>
      <div
        className="tv-workspace-scroll"
        key={route.page + (route.game?.id ?? route.userId ?? "")}
      >
        <Suspense
          fallback={
            <p className="tv-workspace-loading" role="status">
              {t("Carregando…")}
            </p>
          }
        >
          {route.page === "profile" && route.userId && (
            <UserProfile
              userId={route.userId}
              onBack={back}
              notify={notify}
              onJoinParty={(friend) =>
                navigate({ page: "party-guest", friend })
              }
            />
          )}
          {route.page === "friends" && (
            <SocialPanel
              onProfile={(userId) => navigate({ page: "profile", userId })}
              initialView={
                route.people
                  ? "people"
                  : route.activity
                    ? "activity"
                    : "friends"
              }
              notify={notify}
              layout="page"
              onJoinParty={(friend) => onRoute({ page: "party-guest", friend })}
            />
          )}
          {route.page === "settings" && <SettingsPage notify={notify} />}
          {route.page === "sources" && (
            <div className="page-content">
              <SourceManager />
            </div>
          )}
          {route.page === "downloads" && (
            <DownloadsPage
              jobs={jobs}
              onImport={() => setImporting({})}
              onDownloaded={(candidate, game) =>
                setImporting({ candidate, game })
              }
              notify={notify}
            />
          )}
          {route.page === "game" && route.game && (
            <GamePage
              key={entry?.item.id ?? route.game.id}
              game={route.game}
              entry={entry}
              emulators={emulators}
              onBack={back}
              onImport={(game) => setImporting({ game })}
              onSelect={(game) => navigate({ page: "game", game })}
              refresh={refresh}
              notify={notify}
              startOnline={route.online}
            />
          )}
          {route.page === "import" && (
            <>
              <p className="tv-workspace-loading">
                {t("Importe um arquivo ou uma pasta para sua biblioteca.")}
              </p>
              <button
                className="button primary"
                onClick={() => setImporting({})}
              >
                {t("Selecionar jogos")}
              </button>
            </>
          )}
          {importing && (
            <ImportDialog
              initial={importing.game}
              initialCandidate={importing.candidate}
              onClose={() => setImporting(undefined)}
              onImported={(game) => void imported(game)}
            />
          )}
        </Suspense>
      </div>
      {picker && (
        <ConsoleFilePicker
          request={picker.request}
          onClose={(path) => {
            pendingPicker.current = undefined;
            picker.resolve(path);
            setPicker(undefined);
          }}
        />
      )}
      {select && (
        <div className="tv-workspace-select-backdrop">
          <section
            className="tv-workspace-select"
            role="dialog"
            aria-modal="true"
            aria-label={
              select.field.getAttribute("aria-label") ?? t("Escolher opção")
            }
          >
            <header>
              <h2>
                {select.field.getAttribute("aria-label") ?? t("Escolher opção")}
              </h2>
              <button
                aria-label={t("Close dialog")}
                onClick={() => {
                  focus(select.field);
                  setSelect(undefined);
                }}
              >
                {t("Voltar")}
              </button>
            </header>
            <div role="listbox" aria-label={t("Opções")}>
              {select.options.map((option, index) => (
                <button
                  key={index}
                  role="option"
                  aria-selected={select.index === index}
                  data-highlight={select.index === index || undefined}
                  ref={(node) => {
                    if (select.index === index) {
                      node?.focus({ preventScroll: true });
                      node?.scrollIntoView({ block: "nearest" });
                    }
                  }}
                  onFocus={() =>
                    setSelect((current) =>
                      current && current.index !== index
                        ? { ...current, index }
                        : current,
                    )
                  }
                  onClick={() => {
                    changeField(select.field, option.value);
                    setSelect(undefined);
                    focus(select.field);
                  }}
                >
                  {option.text}
                </button>
              ))}
            </div>
            <p>{t("A confirma · B cancela")}</p>
          </section>
        </div>
      )}
      {editing && (
        <ControllerKeyboard
          input={keyboardInput}
          value={editing.value}
          title={
            editing.field.getAttribute("aria-label") ??
            editing.field.labels?.[0]?.textContent?.trim().slice(0, 80) ??
            t("Editar texto")
          }
          maxLength={
            editing.field.maxLength > 0
              ? editing.field.maxLength
              : Math.max(65536, editing.value.length + 1024)
          }
          onChange={(value) => {
            changeField(editing.field, value);
            setEditing({ ...editing, value });
          }}
          onClose={() => {
            focus(editing.field);
            setEditing(undefined);
          }}
        />
      )}
    </section>
  );
}
