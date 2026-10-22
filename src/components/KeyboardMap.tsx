/** Player 1's keyboard in the OpenRetro Runtime. Mirrors KEYBOARD_BINDINGS
 * in src-tauri/src/launcher/runtime_menu.rs. */
const KEYBOARD_MAP: [string, string[]][] = [
  ["Direcional", ["Setas"]],
  ["A · B", ["X", "·", "Z"]],
  ["X · Y", ["S", "·", "A"]],
  ["L · R", ["Q", "·", "W"]],
  ["L2 · R2", ["E", "·", "R"]],
  ["L3 · R3", ["C", "·", "V"]],
  ["Start · Select", ["Enter", "·", "Shift direito"]],
  ["Analógico esquerdo", ["I", "J", "K", "L"]],
  ["Analógico direito", ["T", "F", "G", "H"]],
  ["Menu do jogo", ["F1"]],
  ["Salvar · carregar estado", ["F2", "·", "F4"]],
  ["Trocar slot", ["F6", "·", "F7"]],
  ["Capturar tela", ["F8"]],
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
        No PlayStation: Círculo = X, Cruz = Z, Triângulo = S e Quadrado = A.
      </p>
    </div>
  );
}
