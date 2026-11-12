import { useQuery } from "@tanstack/react-query";
import { t } from "../i18n";
import { bridge } from "../services/bridge";
import {
  DEFAULT_LAYOUT,
  keyLabel,
  resolveLayout,
  type KeyActionId,
  type KeyboardBindings,
} from "../features/settings/keyboardBindings";

/** Player 1's keyboard in the OpenRetro Runtime, with the keys chosen in
 * Configurações › Teclado. */
const ROWS: [string, KeyActionId[]][] = [
  [t("Direcional"), ["up", "left", "down", "right"]],
  ["A · B", ["a", "b"]],
  ["X · Y", ["x", "y"]],
  ["L · R", ["l", "r"]],
  ["L2 · R2", ["l2", "r2"]],
  ["L3 · R3", ["l3", "r3"]],
  [t("Start · Select"), ["start", "select"]],
  [t("Analógico esquerdo"), ["l_y_minus", "l_x_minus", "l_y_plus", "l_x_plus"]],
  [t("Analógico direito"), ["r_y_minus", "r_x_minus", "r_y_plus", "r_x_plus"]],
];

/** The runtime's own shortcuts; they are not part of the layout. */
const SHORTCUTS: [string, string[]][] = [
  [t("Menu do jogo"), ["F1"]],
  [t("Salvar · carregar estado"), ["F2", "·", "F4"]],
  [t("Trocar slot"), ["F6", "·", "F7"]],
  [t("Capturar tela"), ["F8"]],
];

const ARROWS: KeyActionId[] = ["up", "left", "down", "right"];

function keysOf(
  layout: Record<KeyActionId, string>,
  ids: KeyActionId[],
): string[] {
  const arrows =
    ids.join() === ARROWS.join() &&
    ids.every((id) => layout[id] === DEFAULT_LAYOUT[id]);
  if (arrows) return [t("Setas")];
  const keys = ids.map((id) => keyLabel(layout[id]));
  // Pairs read "X · Z"; directions read as a row, like I J K L.
  return ids.length === 2 ? [keys[0], "·", keys[1]] : keys;
}

export function KeyboardMap() {
  const { data: settings } = useQuery({
    queryKey: ["settings"],
    queryFn: bridge.settings,
  });
  const layout = resolveLayout(
    settings?.keyboardBindings as KeyboardBindings | undefined,
  );
  const rows: [string, string[]][] = [
    ...ROWS.map(([button, ids]): [string, string[]] => [
      button,
      keysOf(layout, ids),
    ]),
    ...SHORTCUTS,
  ];
  return (
    <div className="keyboard-map">
      <dl>
        {rows.map(([button, keys]) => (
          <div key={button}>
            <dt>{button}</dt>
            <dd>
              {keys.map((key, index) =>
                key === "·" ? (
                  <span key={index}> · </span>
                ) : (
                  <kbd key={index}>{key}</kbd>
                ),
              )}
            </dd>
          </div>
        ))}
      </dl>
      <p>
        {t(
          "No PlayStation: Círculo = {a}, Cruz = {b}, Triângulo = {x} e Quadrado = {y}.",
          {
            a: keyLabel(layout.a),
            b: keyLabel(layout.b),
            x: keyLabel(layout.x),
            y: keyLabel(layout.y),
          },
        )}
      </p>
    </div>
  );
}
