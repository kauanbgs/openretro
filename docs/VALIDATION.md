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

- A real game/emulator session has not been exercised on this machine.
- Production installer packaging, Linux execution, macOS support and remote CI execution have not been verified.
- Automatic token renewal and one-time 401 recovery are implemented; natural token expiry was not awaited during live validation.

Browser imports remain isolated in localStorage; desktop library data and catalog caching use SQLite.
