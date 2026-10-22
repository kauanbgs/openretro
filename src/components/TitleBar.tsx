import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { BrandMark } from "./Brand";

/** Replaces the system title bar: drag anywhere, double-click to maximize. */
export function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    const window = getCurrentWindow();
    const sync = () => void window.isMaximized().then(setMaximized);
    sync();
    const unlisten = window.onResized(sync);
    return () => void unlisten.then((stop) => stop());
  }, []);
  const window = getCurrentWindow();
  return (
    <header className="titlebar" data-tauri-drag-region>
      <span className="titlebar-brand" data-tauri-drag-region>
        <BrandMark />
        OpenRetro
      </span>
      <div className="titlebar-controls">
        <button aria-label="Minimizar" onClick={() => void window.minimize()}>
          <Minus size={15} strokeWidth={1.5} />
        </button>
        <button
          aria-label={maximized ? "Restaurar" : "Maximizar"}
          onClick={() => void window.toggleMaximize()}
        >
          {maximized ? (
            <Copy size={13} strokeWidth={1.5} />
          ) : (
            <Square size={12} strokeWidth={1.5} />
          )}
        </button>
        <button
          className="titlebar-close"
          aria-label="Fechar"
          onClick={() => void window.close()}
        >
          <X size={16} strokeWidth={1.5} />
        </button>
      </div>
    </header>
  );
}
