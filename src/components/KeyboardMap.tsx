import { t } from "../i18n"; /** Player 1's keyboard in the OpenRetro Runtime. Mirrors KEYBOARD_BINDINGS
 * in src-tauri/src/launcher/runtime_menu.rs. */
const KEYBOARD_MAP: [string, string[]][] = [
  [t("Direcional"), [t("Setas")]],
  ["A · B", ["X", "·", "Z"]],
  ["X · Y", ["S", "·", "A"]],
  ["L · R", ["Q", "·", "W"]],
  ["L2 · R2", ["E", "·", "R"]],
  ["L3 · R3", ["C", "·", "V"]],
  [t("Start · Select"), ["Enter", "·", t("Shift direito")]],
  [t("Analógico esquerdo"), ["I", "J", "K", "L"]],
  [t("Analógico direito"), ["T", "F", "G", "H"]],
  [t("Menu do jogo"), ["F1"]],
  [t("Salvar · carregar estado"), ["F2", "·", "F4"]],
  [t("Trocar slot"), ["F6", "·", "F7"]],
  [t("Capturar tela"), ["F8"]],
];

export function KeyboardMap() {
  return (
    <div className="keyboard-map">
      <dl>
        {KEYBOARD_MAP.map(([button, keys]) => (
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
          "No PlayStation: Círculo = X, Cruz = Z, Triângulo = S e Quadrado = A.",
        )}
      </p>
    </div>
  );
}
