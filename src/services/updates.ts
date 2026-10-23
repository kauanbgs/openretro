import { useCallback, useEffect, useRef, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { t } from "../i18n";

export type UpdatePhase =
  "idle" | "available" | "downloading" | "ready" | "installing";

const STARTUP_DELAY = 1500;
const CHECK_EVERY = 6 * 60 * 60 * 1000;

/**
 * Finds new releases on start and every few hours. With automatic updates on,
 * one found at start is installed right away (nothing is open yet) and one
 * found later is downloaded in the background for the player to install.
 */
export function useUpdates({
  enabled,
  automatic,
  playing,
  notify,
}: {
  enabled: boolean;
  automatic: boolean;
  playing: boolean;
  notify: (message: string) => void;
}) {
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [version, setVersion] = useState<string>();
  const found = useRef<Update | null>(null);
  const downloaded = useRef(false);
  const startupChecked = useRef(false);
  const busy = useRef(playing);
  busy.current = playing;

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const run = async (startup: boolean) => {
      if (found.current) return;
      try {
        const update = await check();
        if (!alive || !update) return;
        found.current = update;
        setVersion(update.version);
        if (!automatic) return setPhase("available");
        if (startup && !busy.current) {
          setPhase("installing");
          await update.downloadAndInstall();
          await relaunch();
          return;
        }
        setPhase("downloading");
        await update.download();
        downloaded.current = true;
        if (!alive) return;
        setPhase("ready");
        notify(
          t("OpenRetro {version} foi baixado. Reinicie para atualizar.", {
            version: update.version,
          }),
        );
      } catch (error) {
        console.error(t("Automatic update failed:"), error);
        if (alive) {
          setPhase(found.current ? "available" : "idle");
          notify(
            t("Não foi possível atualizar o OpenRetro: {reason}", {
              reason: String(error),
            }),
          );
        }
      }
    };
    const startup = !startupChecked.current;
    const first = window.setTimeout(
      () => {
        startupChecked.current = true;
        void run(startup);
      },
      startup ? STARTUP_DELAY : 0,
    );
    const timer = window.setInterval(() => void run(false), CHECK_EVERY);
    return () => {
      alive = false;
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [enabled, automatic, notify]);

  const install = useCallback(async () => {
    setPhase("installing");
    try {
      const update = found.current ?? (await check());
      if (!update) {
        setPhase("idle");
        notify(t("OpenRetro já está atualizado."));
        return;
      }
      if (downloaded.current) await update.install();
      else await update.downloadAndInstall();
      await relaunch();
    } catch (error) {
      notify(
        t("Não foi possível instalar a atualização: {reason}", {
          reason: String(error),
        }),
      );
      setPhase(found.current ? "available" : "idle");
    }
  }, [notify]);

  return { phase, version, install };
}
