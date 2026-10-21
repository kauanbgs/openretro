# OpenRetro validation record

## Automated checks

- `npm run build`: passes, including strict TypeScript checks for the UI and development proxy.
- `npm test`: 35 tests pass (domain, actual SQLite migrations, IGDB normalization, console mapping, safe images, query validation and pagination).
- `cargo check --manifest-path src-tauri/Cargo.toml`: passes on Windows with Rust stable/MSVC.
- `cargo test --manifest-path src-tauri/Cargo.toml`: six tests pass (paths, known SHA-256 vector and native IGDB query behavior).
- `npm run format:check` and `cargo fmt --check`: pass.
- `npm audit`: zero vulnerabilities, including development dependencies.
- The configured Client ID and Client Secret were checked against production frontend files; neither is present. `.env.local` is ignored by Git.

## Live IGDB integration

Verified using the user's locally configured Twitch application credentials. Secrets and token values are not included in this record.

- OAuth authentication succeeded, followed by real platform, genre, game and detail requests to IGDB.
- Fourteen supported local systems were mapped from IGDB's real platform catalog.
- The first catalog page returned 24 games plus a next-page indicator, including The Legend of Zelda: Ocarina of Time, Super Mario 64, Super Mario World, Super Mario Bros. 3 and The Legend of Zelda: A Link to the Past.
- A combined **SNES + RPG + highest rated** query returned real entries including Final Fantasy III, Chrono Trigger, EarthBound and Terranigma.
- In the browser, selecting **SNES + Role-playing (RPG)** displayed matching covers and entries. This genre filter runs at IGDB, not only on previously loaded results.
- Chrono Trigger's detail page loaded the developer information and eight gameplay screenshots from IGDB's CDN.
- Home displays live catalog entries and actual artwork; mocks are not a fallback for API failures.

## Native desktop startup

Installed Rust using the user's downloaded rustup installer, with the minimal stable profile and no automatic PATH modification. Added rustfmt. Rust commands are available under `%USERPROFILE%\.cargo\bin`; future terminals may need that directory on PATH.

`cargo run --manifest-path src-tauri/Cargo.toml` built and launched `openretro.exe`. Its startup log confirmed initialization. Read-only inspection of the native SQLite database verified migrations **1 and 2**, plus **four cached IGDB responses** containing real catalog titles. This confirms native IPC, OAuth, network requests and SQLite caching ran in the desktop process, independently of the browser proxy.

## Original local import flow

The previous milestone's browser check imported `tests/fixtures/OpenRetro test fixture.gba`, detected GBA, calculated SHA-256, opened the detail page, marked it favorite and confirmed persistence after reload. The QA entry was removed through its confirmation dialog; its source file remains intact.

The file fingerprint was independently checked as `e2c6c891837226d98f911eb1d735f06e7f44633094e93526f20f5e88e76b522c`. The fixture is plain test text, not a playable ROM. IGDB import now preserves external IDs, covers, genres and compatible consoles; custom-title import remains available offline.

## Remaining validation

### Load and idle-work reductions

- All nine application screens/dialogs now load in separate lazy chunks with local Suspense boundaries. The App chunk changed from 145.64 kB to 25.85 kB uncompressed; this is a chunk-size comparison, not an 82% reduction of total application code or RAM. Shared code and the opened page are still required.
- Download polling stays at two seconds during active work and slows to ten seconds while idle. Start/resume/actions explicitly invalidate download jobs, keeping immediate action feedback. Background polling remains disabled.
- Query defaults reuse fresh data for 30 seconds and release inactive cache entries after two minutes. Persistent library/download files and backend metadata caches are unchanged.
- Catalog ownership badges use a precomputed Set instead of scanning the library for every card. Home only processes the first catalog page and does not fetch filter taxonomy until Catalog is opened.
- Frontend tests: 41 passed; production build passed. No TV FPS, startup-time or memory benchmark was performed.

### Completed downloads in Big Picture

- Read-only inspection confirmed the latest completed download was already registered in the native library. The completion handler previously changed only the hidden desktop page.
- The shared completion event now reaches Big Picture after query refresh. The console opens Library, clears filters/search that could hide the arrival, selects the imported game/platform and focuses Play. It waits until a running game exits before changing focus.
- Memoized the shared refresh callback so completion subscriptions remain stable across download polling renders.
- An isolated browser fixture simulated completion while on Downloads, including library data arriving after the event. The UI switched to Library and focused Play for the imported title. No user library entries or download files were changed by this check.
- Frontend tests: 41 passed; production frontend build passed. No backend transfer behavior changed.

### Explicit selects, library scrolling and typography

- Replaced console filter controls with shared combobox/listbox controls: confirmation opens the menu, Up/Down highlights a draft, confirmation applies, and Back/Escape cancels. Closed controls navigate focus instead of changing values.
- Browser review used an isolated two-game fixture without modifying the user's library. Down moved focus to the first row and scrolled its cover cards into view. Opening sort and moving to Name kept the original value until confirmation; Right then focused the console control without altering it. Cancelling a draft console option preserved All consoles.
- Replaced the two previous font imports with one local Nunito Sans Latin variable font. The production font file is 31.08 kB; typography and select-menu appearance were reviewed in the browser.
- Frontend suite: 41 tests passed. Production frontend build passed. Native controller hardware was not retested for this UI-only change.

### Controller fixes, reference layouts and smaller payload — 2026-10-20

- Added persistent 30 Hz controller sampling, DS4 DirectInput mapping, modal-owned selection and modal input priority. Sampling pauses when the launcher loses focus and re-seeds held buttons on return.
- Frontend input regression suite covers held confirmation across a grid/dialog transition, a subsequent confirmation/cancel, directional repeat, disconnect and raw DS4 mappings. Frontend suite: 41 tests passed; Rust library suite: 15 tests passed.
- Browser review confirmed the discovery Home renders 12 live IGDB recommendations with an empty library, and catalog ordering/filters use the compact reference layout. Library adds actual sorting, console filtering and grid/list modes; there were no installed games in the browser preview used for review.
- Native Guide/PS handling now attempts the existing runtime SDL2 background controller driver, retaining Windows fallbacks. The installed runtime has SDL2.dll; a physical PS-button session remains unverified after recompilation.
- App and pause overlay have separate lazy chunks; desktop pages unmount in console mode; offscreen catalog images use lazy loading; console backdrop blur is removed. Release preparation trims optional runtime content by default. The preparation script was syntax-checked, not executed, and TV performance/installer-size reductions have not been measured.
- Samsung/LG adaptation constraints and proposed on-demand WebAssembly architecture are recorded in `TV.md`. No Tizen/webOS installer is produced by this change.

### Big Picture and OpenRetro in-game menu — 2026-10-20

- Production frontend build passed; frontend suite: 38 tests passed; Rust library suite: 15 tests passed.
- Browser check with live IGDB: catalog pagination loaded 48 games; opening details after scrolling focused the primary action immediately. Arrow navigation and Escape returned focus to the same card; Enter reopened details. Filters scroll away instead of covering the catalog. Landscape artwork was visible in cards and details.
- Added an independent native OpenRetro pause window, private stdin commands, Windows controller polling and disabled RetroArch's menu shortcut. Tests cover command allowlisting, slot bounds and unattached sessions.
- Actual controller input, emulator save/load/capture commands, overlay focus over a running game, and Steam behavior still require a physical gameplay check. Steam preferences were not changed automatically. PCSX2/custom emulators do not use this overlay yet.

- A real game/emulator session has not been exercised on this machine.
- Production installer packaging, Linux execution, macOS support and remote CI execution have not been verified.
- Automatic token renewal and one-time 401 recovery are implemented; natural token expiry was not awaited during live validation.

Browser imports remain isolated in localStorage; desktop library data and catalog caching use SQLite.

## UI redesign and JSON/magnet sources — 2026-10-20

- Rebuilt the application shell, Home, Discover, Library, game details, Emulators, Downloads, Settings and dialogs around the palette/type/layout in `DESIGN.md`. Bundled fonts and refreshed application icons.
- Browser checks covered both themes and a 390px responsive viewport. Home and source-import dialog had no horizontal overflow. Temporary viewport and theme changes were restored.
- Imported an original UI test source using the Hydra `name`/`downloads` schema. Verified validation errors for empty sources, results, enable/disable, persistence after reload, magnet selection and the explicit desktop requirement. Removed the UI test source after validation.
- Verified **IGDB game → Find download → source search** preserves the selected catalog game's context.
- `npm test`: **38 passed**. `npm run build`, `npm run format:check`, `git diff --check`: pass.
- `cargo check` and **11 Rust tests** passed. The local-peer test downloaded an original 256 KB fixture from a magnet, verified exact contents, paused/unpaused, detached without deleting files, corrupted the local copy, resumed/rechecked it, verified repair from the seed, and detected the downloaded Game Boy file. No commercial game files or public torrents were used.
- Native desktop startup succeeded with network downloads enabled. Read-only inspection confirmed migrations **1, 2 and 3**, plus the source/job tables. No test sources or jobs were inserted into the user's desktop database.
- Public-swarm availability and a real game/emulator session remain unverified. Archive extraction, automatic emulator installation, queue limits and speed limits are not implemented.


### Big Picture functional parity — 2026-10-21

- Reuses the desktop game, import, emulator, download, source and settings components inside a console workspace; desktop redirects were removed.
- Adds scoped controller navigation, explicit select confirmation/cancellation, text entry with symbols, focus repair after asynchronous content changes and integrated native file selection.
- File browsing is read-only, requires absolute paths, filters folders/names and bounds listings to 500 entries. JSON reads are limited to regular `.json` files and 16 MB.
- Frontend suite: 44 tests passed. Rust library suite: 17 tests passed. Production build passed.
- No browsers or native app windows are exposed to the UI tools in this session; a visual review and physical controller/file-dialog walkthrough remain unverified. Existing tests do not establish end-to-end input correctness.


### Shared UI/UX and idle work — 2026-10-21

- Refined desktop shell, cards, forms, dialogs, settings, transfer status and empty/loading states. Shared components carry changes into the console workspace. Main navigation and common actions use Portuguese labels; external metadata/runtime messages may remain English.
- Downloads add state filters, aggregate active/completed counts, transfer speed and expandable destination paths. Tiny files now display KB/B correctly. Opening import no longer incorrectly reports a completed library addition before confirmation.
- Settings writes are serialized, optimistic state merges consecutive edits, and the last failed write reloads persisted settings and shows failure. Dialogs handle nesting, visible focus targets and background scroll locking.
- Periodic download queries now stop when idle or playing. Read-only inspection confirmed native start/resume persists QUEUED/RESOLVING before returning, so explicit query invalidation restarts active polling. Native transfer workers continue independently.
- Memoized artwork and derived catalog/library lists reduce repeated work. Desktop offscreen cards use content-visibility where supported (painting optimization, not DOM virtualization). Console field navigation caches focusable controls and invalidates on structural/visibility changes and resize.
- Production build and 45 frontend tests passed. Native code was unchanged; Rust tests were not rerun. No hardware CPU/RAM/FPS benchmark or live visual/controller walkthrough was performed for this change.
