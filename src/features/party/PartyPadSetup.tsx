import { useEffect, useRef, useState } from "react";
import {
  BUTTON_STEPS,
  detectSource,
  saveMapping,
  snapshot,
  STICK_STEPS,
  type PadMapping,
  type PadSnapshot,
} from "./partyPadMapping";
import { t } from "../../i18n";

const STEPS = [
  ...BUTTON_STEPS.map((step) => ({ ...step, stick: false })),
  ...STICK_STEPS.map((step) => ({ ...step, stick: true })),
];

/**
 * Walks the player through every button and stick of a controller the
 * browser does not know, then saves the mapping for that controller model.
 * Each control is taken when it is used and released again, so holding one
 * never fills the next step.
 */
export function PartyPadSetup({
  padId,
  onDone,
  onCancel,
}: {
  padId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [step, setStep] = useState(0);
  const mapping = useRef<PadMapping>({ buttons: [], sticks: [] });
  const done = useRef(onDone);
  done.current = onDone;
  const skip = useRef<() => void>(() => undefined);
  useEffect(() => {
    let rest: PadSnapshot | null = null;
    let waitingRelease = false;
    let current = 0;
    let frame = 0;
    const advance = () => {
      current++;
      setStep(current);
      if (current === STEPS.length) {
        saveMapping(padId, mapping.current);
        done.current();
      }
    };
    skip.current = () => {
      const target = STEPS[current];
      if (!target) return;
      if (target.stick) mapping.current.sticks[target.index] = null;
      else mapping.current.buttons[target.index] = null;
      advance();
    };
    const poll = () => {
      const pad = navigator.getGamepads?.().find((p) => p?.id === padId);
      if (pad && current < STEPS.length) {
        // The pad at rest is the baseline; wait for it after each control.
        if (!rest) rest = snapshot(pad);
        const source = detectSource(rest, pad);
        if (waitingRelease) {
          if (!source) waitingRelease = false;
        } else if (source) {
          const target = STEPS[current];
          if (target.stick) {
            mapping.current.sticks[target.index] =
              "axis" in source
                ? { axis: source.axis, invert: source.value < 0 }
                : null;
          } else mapping.current.buttons[target.index] = source;
          waitingRelease = true;
          advance();
        }
      }
      frame = requestAnimationFrame(poll);
    };
    frame = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(frame);
  }, [padId]);
  const target = STEPS[Math.min(step, STEPS.length - 1)];
  return (
    <div className="party-guest-shade">
      <div
        className="party-guest-menu party-pad-setup"
        role="dialog"
        aria-modal="true"
        aria-label={t("Configurar controle")}
      >
        <h2>{t("Configurar controle")}</h2>
        <p className="muted">
          {t(
            "Solte o controle e use só o que for pedido. O OpenRetro guarda o mapeamento deste controle.",
          )}
        </p>
        <p className="party-pad-step" role="status">
          <small>
            {t("{step} de {total}", {
              step: Math.min(step + 1, STEPS.length),
              total: STEPS.length,
            })}
          </small>
          <strong>{t(target.label)}</strong>
        </p>
        <button className="button secondary" onClick={() => skip.current()}>
          {t("Pular (este controle não tem)")}
        </button>
        <button className="button secondary" onClick={onCancel}>
          {t("Cancelar")}
        </button>
      </div>
    </div>
  );
}
