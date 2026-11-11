/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OPENRETRO_API_URL?: string;
  /** Web build: where its game list is. Defaults to play/games.json. */
  readonly VITE_PLAY_CATALOG_URL?: string;
  /** Web build: the account server, for a local one in development. */
  readonly VITE_SOCIAL_URL?: string;
}
