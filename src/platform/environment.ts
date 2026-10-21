declare global {
  interface Window {
    tizen?: unknown;
  }
}

export const isTizen =
  typeof window !== "undefined" &&
  (import.meta.env.MODE === "tizen" || "tizen" in window);
