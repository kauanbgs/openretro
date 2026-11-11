// The web build of OpenRetro (npm run dev:play / build:play): the same
// interface, with games that run in the browser through EmulatorJS instead of
// the desktop runtime.
export const isWebPlay = import.meta.env.MODE === "play";

/** Set once the player finishes or closes the web build's welcome. */
export const WEB_ONBOARDING_KEY = "openretro-web-onboarding-v1";

export function webOnboardingSeen() {
  try {
    return localStorage.getItem(WEB_ONBOARDING_KEY) === "1";
  } catch {
    return true;
  }
}
