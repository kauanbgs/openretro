# OpenRetro

A local, open-source launcher for classic games. Tauri 2 + React + TypeScript + Rust + SQLite. The first milestone focuses on **import → confirm platform and metadata → library → configure emulator → launch → record session**.

## OpenRetro Runtime

The Windows installer contains **OpenRetro Runtime**, a minimal, reproducible
RetroArch build made specifically for OpenRetro. It has no RetroArch menu,
updater, catalog, network services, achievements, recording or media tools.
OpenRetro owns the complete interface and downloads only the compatible
Libretro core required by the game on first play.

On Windows, the runtime's video surface is attached directly to OpenRetro's
main window. Starting a compatible game therefore keeps the player inside the
same fullscreen application, without a separate RetroArch window or taskbar
entry. The runtime remains an isolated child process so OpenRetro can recover
cleanly if a core fails.

The build pins the exact RetroArch and controller-profile commits, keeps the
GPL notice and dependency licenses in the package, and publishes the
corresponding source archive beside every release. The player never has to
install or configure another application. See
[docs/OPENRETRO_RUNTIME.md](docs/OPENRETRO_RUNTIME.md) for the feature boundary,
local build and update process.

## Samsung Tizen TV

The Tizen 5.5+ target reuses Big Picture as a signed Web application and runs
the official RetroArch Emscripten frontend in an OpenRetro-owned canvas. The
initial pinned runtime covers NES, SNES, Game Boy/Color/Advance, Master System,
Mega Drive and Game Gear. It reads controllers through the TV Gamepad API,
keeps saves in IndexedDB, downloads direct HTTPS files with the Tizen Download
API and extracts compatible ZIP files with the Tizen Archive API.

`npm run build:tizen` creates an unsigned staging directory. The reproducible
WASM runtime is built with `npm run build:runtime:tizen`; `npm run
package:tizen -- -CertificateProfile <name>` creates a signed WGT when Tizen
Studio and a Samsung certificate are installed. See
[platforms/tizen/README.md](platforms/tizen/README.md). A real TV remains
required for controller and performance qualification.

## Players, resume and local co-op

Use **Settings → General → Trocar jogador**, or **Big Picture → Sistema →
Jogadores**, to create and switch local players. Games and downloads are shared;
favorites, recent activity and playtime belong to the selected player. Existing
progress stays with Jogador 1. Profile switching is blocked during a running game.

The managed RetroArch runtime isolates new players' cartridge saves and states
under `players/<profile>/<game fingerprint>` in application data. Jogador 1 keeps
the runtime's existing save paths, including custom paths. External emulators
such as PCSX2 retain their own save configuration.

**Continuar de onde parou** is enabled by default and can be disabled in General
settings. For cores supporting save states, a normal emulator exit creates an
automatic state and the next launch loads it. Forced termination and power loss
cannot guarantee a state save. Manual slots remain available in the game menu.

The runtime assigns the first four detected controllers to player ports 1–4 and
uses automatic SDL mappings. Connect controllers before launching; supported
player counts and multitap requirements depend on the game and core. Multitap is
not forced. Physical controller order and automatic resume need device testing.

## Big Picture tools

Big Picture includes the same game details/configuration, file and folder import,
emulator installers/detection/defaults, complete download controls, JSON sources,
and application settings as desktop mode. Use **Gerenciar** on the library hero,
**Detalhes e gerenciamento** in catalog details, or **Sistema** for tools. These
screens stay inside the console shell and load only when opened.

Use the D-pad/stick to focus controls and A to activate. Selects require A to open,
Up/Down to highlight and A to apply; B cancels. Text fields open the virtual
keyboard; Y cycles lowercase, uppercase and symbols. LB/RB moves through fields
in document order. B closes the current dialog or opens the console sidebar.

File selection for games, BIOS, executables, JSON sources and download folders
uses an integrated controller-navigable browser in the native app. Directory
listings show up to 500 entries; search by name to find entries beyond that limit.
Native file access and emulation require the Tauri app, not browser preview.

## Automatic updates

OpenRetro checks GitHub Releases after startup. When a signed newer release is
available, an **Update** button downloads it and restarts the app through the
Windows updater.

The signing key is intentionally kept outside this repository. Before the
first release, add the content of the local `openretro-updater.key` file to the
GitHub Actions secret `TAURI_SIGNING_PRIVATE_KEY`. The public key is already in
`src-tauri/tauri.conf.json`. Publish a release by increasing the version in
`src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, then push a matching
`v*` tag; `.github/workflows/release.yml` builds the signed installer and
publishes `latest.json` for the updater.

Discover now connects to **IGDB**, with real covers, screenshots, developers, console libraries, genre filters, search, ordering, and pagination. The mock provider is retained only as a development/test fixture; the application does not silently fall back to fictional games.

## Run

Use Node.js 22.12+ (or 24 LTS) and npm.

```powershell
npm ci
npm run dev
```

Open http://127.0.0.1:1420 for the browser preview. This mode persists imported metadata in localStorage; browsers cannot retain real executable paths or launch emulators. Preview data is intentionally separate from the desktop database.

For the desktop app, install the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/): Rust stable, Windows Visual Studio C++ Build Tools and WebView2; on Linux install WebKitGTK 4.1 and native development packages.

```powershell
npm run tauri dev
# Production desktop bundle:
npm run tauri build
```

Windows MSVC prerequisite: **Desktop development with C++**, including the Windows SDK. Linux (Ubuntu/Debian): `libwebkit2gtk-4.1-dev build-essential libxdo-dev libssl-dev librsvg2-dev libayatana-appindicator3-dev`. macOS is not validated in this milestone.

## Connect IGDB

1. Enable Twitch two-factor authentication, then register an application in the [Twitch developer console](https://dev.twitch.tv/console/apps). Choose **Confidential** so you can generate a Client Secret. Follow the [IGDB account and authentication instructions](https://api-docs.igdb.com/#account-creation).
2. Copy `.env.example` to **`.env.local` in the project root**, beside `package.json`, and fill in:

```dotenv
IGDB_CLIENT_ID=your_client_id
IGDB_CLIENT_SECRET=your_client_secret
```

3. Run `npm run dev` or `npm run tauri dev`, then open **Discover**. The local backend obtains the OAuth token from Twitch and refreshes it before expiry or once after an IGDB 401. No access token needs to be entered manually.

`.env.local` is ignored by Git. Do not use a `VITE_` prefix: these values must never be exposed to the frontend. For an installed desktop build, set the same environment variables or create `providers.env` in the application data directory shown in **Settings → Advanced**. Development source paths are only consulted in debug builds.

The browser development server includes a localhost-only proxy; a static `vite preview` deployment does not include this backend. Desktop requests run in Rust and need no Node installation once packaged. Requests are serialized below IGDB's four-per-second limit. Public metadata is cached for 24 hours, and consoles/genres for seven days, in SQLite on desktop and `.cache/igdb` for browser development. Secrets and OAuth tokens are never stored in those caches.

### Browse

- Select **Discover**, then a console or All consoles. Fourteen initial systems are mapped from IGDB's platform catalog.
- Choose a genre. Console and genre filtering, ordering, and pagination are performed by IGDB rather than filtering only a loaded page.
- Search by title; results use IGDB relevance ordering. **Load more games** fetches another 24 entries. Most rated, highest rated (minimum five ratings), alphabetical, newest, and oldest ordering apply when no text search is active.
- Open a game for its overview, developer and screenshots. **Find download** searches your enabled sources; **Add local file** associates an existing file with its metadata. Games available on multiple supported consoles retain compatible console choices during import.
- IGDB supplies metadata and artwork only. It is not a game-download provider.

## Try the vertical slice

### Download using your JSON sources

1. In the **desktop app**, open **Downloads → Add source** (also available in Settings → Downloads).
2. Paste an HTTPS JSON URL, choose a `.json` file, or paste its JSON text. The supported Hydra-style format is:

```json
{
  "name": "My source",
  "downloads": [
    {
      "title": "Game title",
      "uris": [
        "magnet:?xt=urn:btih:REPLACE_WITH_REAL_40_HEX_OR_32_BASE32_HASH"
      ],
      "uploadDate": "2026-10-20T00:00:00Z",
      "fileSize": "32 MB"
    }
  ]
}
```

This is a format template, not a working download. Sources are user-supplied; none are bundled. Unknown extra fields are ignored. Direct HTTP download links and v2-only magnets are skipped. Sources must contain at least one valid v1 magnet. Imports are limited to 16 MB/100,000 entries. Duplicate entries/links are removed. Remote source refresh is manual and preserves enabled state; imported files can be replaced with new JSON.

3. Search titles in **Downloads**, or open an IGDB game and click **Find download**. Choose an edition and magnet, then **Start download**. Selecting a source result is explicit; IGDB records are never silently matched to unrelated files.
4. Native BitTorrent runs inside OpenRetro using [librqbit](https://github.com/ikatson/rqbit), without an external torrent client or HTTP control server. Progress, speed, remaining time and errors are real. You can pause, resume or cancel. Closing the app interrupts transfers; reopening restores them paused, and Resume rechecks existing pieces. Cancelling retains partial files. BitTorrent uploads pieces while downloading; completed transfers are detached and stop seeding.
5. At completion, click **Add to library**, choose the downloaded console file and confirm its platform/metadata. Archives must currently be extracted manually; installers and scripts are not executed. Configure a compatible emulator and click **Play game**. Automatic emulator installation is not implemented.

Settings → Downloads lets you choose the destination. Each transfer gets its own UUID folder, and its original directory remains saved even if the default changes. JSON sources, their enablement, and jobs persist in SQLite. Browser preview supports JSON source management and search with separate localStorage data; actual torrents, file access and launching require desktop.

### Import an existing file

1. Open the desktop app, click **Add Game**, and choose a legally obtained game file.
2. Confirm the detected platform. `.bin` and `.pbp` are ambiguous and require a deliberate selection. ZIP archives are treated as Arcade files and are never extracted automatically.
3. Choose matching IGDB metadata or keep your own title. Filename matching searches IGDB; a console-specific manual search is also available. You can still import when the metadata service is offline. No remote hash-match database is configured. SHA-256 fingerprints are streamed in Rust, then checked again on import.
4. Go to **Emulators → Add emulator**. Select an official, already-installed executable, mark its supported systems, and optionally make it the default for those systems. Detection only searches PATH for known emulator names.
5. Open the game and click **Play game**. The default launch is `executable` with a single game-path argument. For runtimes that need flags or a core (e.g. RetroArch), use **Configure**: one argument per line, with `{game}` and optional `{bios}` placeholders. Quote characters are unnecessary; paths with spaces are already passed as single arguments.
6. Close the emulator. The session duration, last-played date, and total playtime are saved. Emulators must run in the foreground rather than hand the game off to another process. Runtime compatibility, firmware validity, and core availability depend on the emulator.
7. Use **Details** to verify the checksum, relocate a moved file, or remove the library entry. Removing an entry never deletes the original file. Favorite games can be filtered in Library.

### BIOS and disc images

PlayStation currently requires a BIOS path plus an explicit `{bios}` argument in configuration. Use the flag required by your specific emulator; OpenRetro cannot assume all emulators use the same flag. Other firmware or core requirements can be represented through launch arguments but do not yet have automatic detection. CUE/BIN and other multi-file games retain their original locations; associated tracks must remain together. No BIOS files are included.

## Architecture

```text
src/
  components/       shared controls and original SVG artwork
  db/               platform catalog
  features/
    home/           continue playing and live catalog spotlight
    discover/       real IGDB catalog, consoles, genres and connection feedback
    library/        import wizard
    games/          game page, resolver feedback and configuration
    emulators/      executable registration, detection, defaults and path tests
    downloads/      JSON sources, source search, transfers and file import
    settings/       local preferences, storage paths and milestone boundaries
  hooks/            TanStack Query reads and invalidation
  providers/
    metadata/       MetadataProvider + IgdbMetadataProvider + test mock
    sources/        GameSourceProvider + LocalFileProvider + MockFreewareProvider
  services/         GameResolver, EmulatorManager, LibraryManager, DownloadManager, bridge
  types/            strict domain models
src-tauri/
  capabilities/     main-window permissions
  src/
    commands/       IPC handlers and input validation
    database/       SQLite setup, migrations 001/002 and queries
    metadata/       IGDB requests, Twitch OAuth and persistent cache
    filesystem/     canonical paths, executable validation, streamed SHA-256
    launcher/       process ownership and session accounting
    downloads/      validated source persistence and native BitTorrent engine
server/
  igdb.ts           browser-development proxy, OAuth and public metadata cache
```

`GameResolver` returns `READY`, `MISSING_GAME`, `MISSING_EMULATOR`, `MISSING_BIOS`, `CONFIGURATION_REQUIRED` or `UNSUPPORTED`. UI components explain the next action. The Rust launcher independently checks paths, compatibility and BIOS configuration before execution; it never trusts the frontend's readiness result.

`GameMetadata`, `Platform`, `LibraryItem`, `Emulator`, and `GameResolution` are the primary models. Metadata providers return catalog records without acquiring game files. Source providers resolve availability independently. `EmulatorInstaller` is an interface for future official installers; no executable downloader is supplied. The implementation uses Tailwind 4 alongside a custom stylesheet, Lucide icons, and small accessible controls rather than adding a component kit unnecessarily.

### SQLite

The database lives in Tauri's OS-specific app-data directory as `openretro.sqlite`. Settings → Advanced shows its exact path, plus cache and log directories. Foreign keys are enabled and WAL mode is used. Migrations 001 and 002 run in a transaction and record their versions in `schema_migrations`. Existing library entries remain compatible with the optional IGDB metadata fields.

| Table              | Purpose                                                                          |
| ------------------ | -------------------------------------------------------------------------------- |
| `games`            | Game metadata keyed by ID                                                        |
| `platforms`        | Known systems and file extensions                                                |
| `library_items`    | File path, SHA-256, source, emulator override, BIOS, args, favorite and playtime |
| `emulators`        | Registered executables, compatible systems and default systems                   |
| `play_sessions`    | Start, finish, duration and process exit code                                    |
| `sources`          | Local files and disabled mock fixtures                                           |
| `settings`         | Persisted application preferences                                                |
| `metadata_cache`   | Public IGDB responses with expiry; no credentials or tokens                      |
| `download_sources` | User-imported JSON catalogs, URLs, enabled state and refresh timestamp           |
| `download_jobs`    | Torrent identity, destination, linked metadata and latest transfer state         |

SHA-256 is unique in the library to prevent duplicate imports. Removing an emulator clears per-game overrides. A partial unique index prevents two active sessions of the same game. Crash-interrupted sessions close at startup with no invented offline time. Session tracking lasts until the launched process exits; keep OpenRetro open while playing.

## Security and scope

- Importing never modifies, copies, or executes the original game file.
- Paths must be absolute, canonicalize to files, and contain no `..` traversal or NUL. Executable permissions are checked on Linux; Windows accepts `.exe` executables only.
- Rust uses `std::process::Command` and separate arguments, never shell interpolation. Providers cannot supply executable scripts.
- The registered emulator is a trusted application chosen by the user. Per-game arguments may enable emulator-specific behavior; only use configuration you understand.
- Remote JSON sources require HTTPS, bounded UTF-8 responses and valid magnet entries. Torrent metadata is resolved before payload writes; filenames are validated against traversal, drive prefixes, alternate streams, symlinks and device names. BitTorrent validates piece hashes; library import computes SHA-256. This validates integrity, not the trustworthiness of third-party content. Automatic extraction, executable installation, queue/bandwidth limits and selective torrent files are not implemented.
- IGDB metadata requests are restricted to fixed official IGDB/Twitch endpoints. External query text is escaped, numeric filters and sorting are validated, images use the official IGDB CDN, and redirects are disabled. Credentials stay in the backend; OAuth tokens live in memory.
- No commercial ROMs, BIOS files, DRM bypass, secrets, analytics, or API keys are included in the repository.
- Autostart, folder scanning, complete gamepad navigation, automatic BIOS/core discovery and automatic emulator installation are not implemented. Settings label unavailable features as planned or reserved.
- Appearance, density, reduced motion, and developer details persist. English is the only interface language in this milestone.

## Jogo e menu durante a partida (Windows / OpenRetro Runtime)

O vídeo do runtime gerenciado, sem argumentos personalizados, ocupa a própria
janela principal do OpenRetro. O processo do runtime não aparece como outro
aplicativo. O menu de pausa também pertence ao OpenRetro. Abra com **PS** no DualShock 4,
**Share + Options** (Select + Start) ou **F1**. O menu nativo do RetroArch fica
sem atalho. Os comandos são enviados por um pipe privado para o processo.

O menu permite continuar, salvar/carregar estados, escolher slot, desfazer um
carregamento, capturar tela, reiniciar ou encerrar o jogo. Carregamento, reinício
e encerramento pedem confirmação. Estados dependem do suporte do core.
PCSX2 e emuladores personalizados ainda mantêm seus próprios atalhos.

Se a Steam capturar o botão PS, use **Conflito com Steam?** no menu e desligue
**Configurações → Controle → Botão Guia coloca a Steam em foco**.
O OpenRetro não altera as preferências da Steam automaticamente. O botão PS
precisa ser exposto pelo driver; Share + Options e F1 são alternativas.

Capturas ficam em `app_data/screenshots/<SHA-256 do jogo>/`, acessíveis por
**Minhas capturas**. Saves e estados mantêm as pastas configuradas no runtime.
A configuração adicional fica em `app_data/runtime-config/` e não sobrescreve
`retroarch.cfg`. A integração e o host de janela foram compilados e testados por
unidade; a validação com um DualShock 4 físico e uma partida real ainda está
pendente.

## Validation

```powershell
npm run test:runtime-recipe
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

Tests cover the domain, migrations, IGDB mapping/query boundaries, Hydra JSON parsing, source persistence and interrupted download recovery. Rust tests include a real local-peer magnet transfer with integrity verification, pause/unpause, file retention and downloaded-file detection. GitHub Actions builds/tests the frontend and checks Rust on Windows and Linux.

Local verification includes a frontend production build, frontend/database tests, `cargo check`, Rust tests, live IGDB queries, browser navigation/source management, responsive layouts, both themes and native desktop startup. Public-swarm availability depends on the user's source and peers. A real emulator session, production installer packaging, Linux execution and a remote CI run remain unverified. See [the validation record](docs/VALIDATION.md).

## License

Application code and original development illustrations: MIT, see [LICENSE](LICENSE). IGDB metadata and game artwork retain their respective providers' and owners' rights; they are not relicensed under MIT.

OpenRetro Runtime is built from RetroArch and remains GPL-3.0-or-later. Its
manifest, notices and corresponding source are distributed separately from the
MIT application. Downloaded Libretro cores retain their individual licenses.

Nunito Sans is bundled locally as a single Latin variable font; its SIL Open Font License notice are in `public/licenses/`. The visual system is documented in [docs/DESIGN.md](docs/DESIGN.md). librqbit is Apache-2.0; its dependency licensing remains separate from OpenRetro's MIT application code.
