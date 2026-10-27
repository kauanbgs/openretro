import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type RefObject,
} from "react";
import { t } from "../../i18n";
import { ConsoleClock } from "./ConsoleFx";

export interface ConsoleAction {
  id: string;
  label: string;
  detail?: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  badge?: number;
  danger?: boolean;
  run: () => void;
}

/** Arrow keys move along `actions`; A runs one; B closes. */
function useActionInput(
  input: RefObject<((key: string) => boolean) | null>,
  actions: ConsoleAction[],
  onClose: () => void,
  vertical: boolean,
) {
  const [index, setIndex] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const track = list.current;
    const item = track?.children[index] as HTMLElement | undefined;
    if (!track || !item) return;
    item.focus({ preventScroll: true });
    // Scroll only the list itself: the sheet is still sliding in, and
    // scrollIntoView would drag the whole console up to reach it.
    const start = item.offsetLeft - track.offsetLeft;
    if (start < track.scrollLeft)
      track.scrollTo({ left: start - 8, behavior: "smooth" });
    else if (start + item.offsetWidth > track.scrollLeft + track.clientWidth)
      track.scrollTo({
        left: start + item.offsetWidth - track.clientWidth + 8,
        behavior: "smooth",
      });
  }, [index]);
  useLayoutEffect(() => {
    input.current = (key) => {
      const back = vertical ? "up" : "left";
      const forward = vertical ? "down" : "right";
      if (key === back || key === forward)
        setIndex((value) =>
          Math.max(
            0,
            Math.min(actions.length - 1, value + (key === back ? -1 : 1)),
          ),
        );
      else if (key === "a") actions[index]?.run();
      else if (key === "b" || key === "menu" || key === "home") onClose();
      return true;
    };
    return () => {
      input.current = null;
    };
  });
  return { index, setIndex, list };
}

/**
 * The quick menu at the bottom of the screen, like the PlayStation 5 control
 * center: everything that is not a game is one press of Options away.
 */
export function ControlCenter({
  actions,
  input,
  onClose,
  account,
}: {
  actions: ConsoleAction[];
  input: RefObject<((key: string) => boolean) | null>;
  onClose: () => void;
  account?: React.ReactNode;
}) {
  const { index, setIndex, list } = useActionInput(
    input,
    actions,
    onClose,
    false,
  );
  return (
    <div className="ps-center-backdrop" onClick={onClose}>
      <section
        className="ps-center"
        role="dialog"
        aria-modal="true"
        aria-label={t("Central de controle")}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <ConsoleClock />
          {account}
        </header>
        <div className="ps-center-cards" ref={list}>
          {actions.map((action, position) => (
            <button
              key={action.id}
              className={`${position === index ? "focused" : ""} ${action.danger ? "danger" : ""}`}
              onFocus={() => setIndex(position)}
              onMouseEnter={() => setIndex(position)}
              onClick={action.run}
            >
              <action.icon size={28} strokeWidth={1.7} />
              <strong>{action.label}</strong>
              {action.detail && <small>{action.detail}</small>}
              {Boolean(action.badge) && <b>{action.badge}</b>}
            </button>
          ))}
        </div>
        <p className="ps-center-help">{t("A escolhe · B ou Options fecha")}</p>
      </section>
    </div>
  );
}

/** The Options menu of one game: a short list beside the screen's edge. */
export function OptionsMenu({
  title,
  actions,
  input,
  onClose,
}: {
  title: string;
  actions: ConsoleAction[];
  input: RefObject<((key: string) => boolean) | null>;
  onClose: () => void;
}) {
  const { index, setIndex, list } = useActionInput(
    input,
    actions,
    onClose,
    true,
  );
  return (
    <div className="ps-options-backdrop" onClick={onClose}>
      <section
        className="ps-options"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <h2>{title}</h2>
        <div ref={list}>
          {actions.map((action, position) => (
            <button
              key={action.id}
              className={`${position === index ? "focused" : ""} ${action.danger ? "danger" : ""}`}
              onFocus={() => setIndex(position)}
              onMouseEnter={() => setIndex(position)}
              onClick={action.run}
            >
              <action.icon size={20} />
              {action.label}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
