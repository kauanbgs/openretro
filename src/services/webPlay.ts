// The web build of OpenRetro (npm run dev:play / build:play): the same
// interface, with games that run in the browser through EmulatorJS instead of
// the desktop runtime.
export const isWebPlay = import.meta.env.MODE === "play";
