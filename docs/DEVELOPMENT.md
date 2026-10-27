# OpenRetro — developer guide

A local, open-source launcher for classic games. Tauri 2 + React + TypeScript + Rust + SQLite. The first milestone focuses on **import → confirm platform and metadata → library → configure emulator → launch → record session**.

## OpenRetro Runtime

The Windows installer contains **OpenRetro Runtime**, a minimal, reproducible
RetroArch build made specifically for OpenRetro. It has no RetroArch menu,
updater, catalog, network services, achievements, recording or media tools.
OpenRetro owns the complete interface and downloads only the compatible
Libretro core required by the game on first play.

OpenRetro installs the runtime into application data and registers it as the
default for every console when it starts, and copies a newer one over it after
an app update. It never appears in **Emuladores**, which lists only external
emulators a player adds; nothing has to be installed or repaired by hand.

On Windows, the runtime's video surface is attached directly to OpenRetro's
main window. Starting a compatible game therefore keeps the player inside the
same fullscreen application, without a separate RetroArch window or taskbar
entry. The runtime remains an isolated child process so OpenRetro can recover
cleanly if a core fails.

The build pins the exact RetroArch and controller-profile commits, keeps the
GPL notice and dependency licenses in the package, and publishes the
corresponding source archive beside every release. The player never has to
install or configure another application. See
[docs/OPENRETRO_RUNTIME.md](OPENRETRO_RUNTIME.md) for the feature boundary,
local build and update process.

## PlayStation 3

PS3 games run on [RPCS3](https://rpcs3.net/) (GPL-2.0), which OpenRetro manages
like the runtime: the first PS3 game downloads a pinned, hash-checked RPCS3
build into application data, installs Sony's official system software from
Sony's update server and fetches Redump's disc keys. Nothing is installed or
configured by hand, and RPCS3's own interface never appears; games start inside
the OpenRetro window from the command line. Each connected controller becomes a player
(Xbox controllers through XInput, other controllers including DualShock 4 and
DualSense through SDL using the detected device name), or the keyboard when none is connected. RPCS3's source is at
<https://github.com/RPCS3/rpcs3>.

Games are disc folders, imported through `PS3_GAME/USRDIR/EBOOT.BIN`, or
Redump disc images, recognised by their disc header and decrypted with their
Redump key. The first launch of each game compiles its code for the PC, which
can take a few minutes; later launches are fast. PS3 emulation needs a recent
multi-core CPU and a Vulkan GPU, and compatibility varies per game (see
<https://rpcs3.net/compatibility>). Save states and online play are not
available for PS3.

Party and phone play work with PS3 games. Their picture is captured from the OpenRetro
window and their sound from the RPCS3 process alone (Windows 10 version 2004
or later). RPCS3 has no remote gamepad, so for a Party OpenRetro writes its own
`xinput1_3.dll` (`src-tauri/xinput-shim`) next to `rpcs3.exe`: RPCS3 loads it
before Windows' copy, and it shows guests J2–J4 as XInput pads 2–4 while
passing pad 1 through to Windows. RPCS3 reads its controllers only at boot, so
guests and phones play when the room or phone play is already open as the PS3
game starts; then only the PC's first controller plays locally. A phone can
play as J1 when the PC has no controller (or an Xbox one); with another kind of
controller on the PC, phones play from J2. Phones have no save or load for PS3,
and "Sair do jogo" closes RPCS3's window. Without remote players the DLL is
removed.

The managed emulator exits when the game ends. On Windows it also belongs to
an OpenRetro-owned process job, so closing or crashing the launcher does not
leave the emulator running. If the embedded game window disappears but its
process stays alive, OpenRetro gives it five seconds to finish before stopping
it. A new launch checks `RPCS3.buf`: a live instance is reported in OpenRetro;
only an abandoned, exclusively accessible lock is removed. Saves and installed
game data are not removed during this recovery.

Before a PS3 game starts, OpenRetro installs its official updates from Sony's
update server (checked at most once a day per game, SHA-1 verified, and
skippable in **Settings → Emuladores**) and keeps RPCS3's recommended settings
database (<https://api.rpcs3.net/config/?api=v1>) on disk, so RPCS3 applies the
community's settings for each game as its own interface would.

## Discord

**Settings → General → Mostrar o jogo no Discord** (off by default) shows
the running game on Discord: its title in the short status ("Playing Super
Mario World"), the console, the cover and the time played. OpenRetro talks to
the Discord app on the same PC through its local pipe; no server or sign-in
is involved, and nothing happens while Discord is closed.

## Players, resume and local co-op

Use **Settings → General → Trocar jogador**, or **Big Picture → Central de
controle → Configurações**, to create and switch local players. Games and downloads are shared;
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

## Online play

On a library game that runs in the OpenRetro Runtime, the **Jogar online**
button hosts a direct-IP netplay session or joins one. Everyone needs the same
game file; the host shares the address shown in the dialog, an optional room
password, and the port (55435 by default, opened through UPnP when the router
allows it). Over the internet without UPnP, forward the port or use a gaming VPN
such as Tailscale, ZeroTier or Radmin VPN. Players who join start from the
host's state and never load or overwrite their own resume state. NES, SNES,
Game Boy, GBA, Master System, Genesis, Game Gear, PlayStation and Arcade games
are supported.

## VPN invitations for a demo

On Windows, each PC running a game in the integrated runtime can choose its own
screen region from the in-game menu (**F1**, PS, or Share + Options). Activate
**Tela dividida** to cycle through left/right, top/bottom and four quadrants,
then choose **Minha região**. **Ver tela inteira / Ver minha tela** switches
between the selected region and the complete picture for menus and results.
These actions work with the mouse or the menu's controller navigation.

This is a local crop of the rendered game window, preserving its proportions
and any existing letterboxing. It does not change the player's controller port,
send video over netplay, or create independent cameras. Each PC chooses its
region manually, and the preference lasts for the running session. The game
must already support split-screen. Phone streaming keeps its own view settings.

To use netplay between different networks without running an OpenRetro server:

1. Install Tailscale or Radmin VPN on both PCs and connect them to the same
   private VPN network. Both PCs need the same game file and compatible cores.
2. On the host, open the library game, choose **Jogar online → Hospedar partida**,
   and paste the host PC's IP from the VPN application into **Seu endereço na VPN**.
   The detected local address is only a reference; it may be a Wi-Fi address,
   so do not assume it is the VPN address.
3. Copy the generated **Convite**, share it with the other player, and select
   **Hospedar e jogar**. Share the optional session password separately.
4. On the other PC, open the same library game, choose **Jogar online → Entrar em
   uma partida**, and paste the invitation. OpenRetro checks the console and
   stored SHA-256 fingerprint before enabling **Entrar e jogar**. Enter the
   separate password if required. The runtime checks core compatibility during
   its connection handshake.

Invitations are portable connection details, not short server-backed room codes.
They contain the host address, port, title, console and game fingerprint, but no
password or local game path. They do not create a VPN, expire, verify that the
host is online, or bypass a firewall. Recreate the invitation if the host address
or port changes. Allow OpenRetro/runtime traffic through the host firewall when
needed. **Endereço e porta** remains available for manual connections and older
imports without fingerprints. The same invitation flow also works over LAN with
the host's local address. It does not add video/audio streaming or a lobby.

## Party

**Party** creates a browser room for up to three friends. It is not anonymous:
the host signs in to an OpenRetro account to create it, and friends join from
their own account by clicking **Entrar** in the friends panel, which opens the
Party page with a single-use ticket. There is no joining by code or name. The
host runs the game and guests receive WebRTC video/audio and send controller
input. Cloudflare Workers and
Durable Objects manage rooms; Cloudflare Realtime TURN carries the stream.
Users never enter server addresses or keys. The operator configures TURN once
with `npm run turn:configure --prefix party-server`.
See [Party setup and validation](PARTY.md).

## Chat

Friends can send each other direct messages from the **Conversas** tab of the
friends panel, or from the chat button beside a friend. Only friends can write,
and only the two people in a conversation can read it. New messages arrive over
the same connection that carries presence, with an unread count on the account
button. Messages have up to 400 characters, each conversation keeps its newest
500, and the server limits how fast an account can send. Removing a friend
leaves the conversation read-only; blocking deletes it for both.

## Achievements

Sign in to [RetroAchievements](https://retroachievements.org) in
**Configurações › Conquistas** to earn achievements in the classics. The
password is only used to sign in; OpenRetro keeps just the session token, in
Windows Credential Manager. During play each unlock shows up on screen, and
the game page's **Conquistas** tab lists the whole set with your progress and
each achievement's rarity. Hardcore mode counts toward the main ranking but
does not allow loading states; online sessions always play in softcore. PS3
games have no achievements.

## Play on your phone

**Celular → Ativar** in the header shows a QR code. A phone on the same Wi-Fi
opens it in the browser, no app needed, and gets the game's picture and sound,
touch controls, and the library to start a game. When it opens, each phone
picks a player; players already taken by another phone are greyed out, and J1
is left to the PC's controller or keyboard by default, so one person can play
on the PC and another on the phone. A controller paired with the phone also
works where the browser allows it. Up to four people can therefore play the
same local multiplayer game from one PC. The game keeps running on the PC.

To play this one-PC mode over the internet, connect the PC and phones through
a gaming VPN or forward TCP port 47820 to the PC and share its reachable
address. The pairing URL is the authorization: do not share it publicly.
The phone's **Jogar online** option also starts or joins the usual direct-IP
netplay session on the PC; that mode still requires every remote emulator to
have the same game file and core.

For a split-screen game, open the phone's game menu and set **Tela dividida
deste jogo** to left/right, top/bottom, or four quadrants. The PC saves that
layout for the game and sends each phone only its player's region, cropped
before encoding. J1/J2 receive the left/right or top/bottom halves; in a
four-player layout J1–J4 receive top-left, top-right, bottom-left, bottom-right.
**Minha parte da tela** overrides the image region without changing the
controller's player. **Ver tela inteira** temporarily shows menus and results
on that phone; **Ver minha tela** returns to its region. All phones share the
same audio. A phone on J3/J4 sees the full picture in a two-region layout until
it selects a valid image region. This uses the game's existing split-screen;
shared-camera games keep the full-screen layout, and crops do not add detail
or independent cameras.

The picture starts as JPEG frames and moves to WebRTC video once it plays:
OpenRetro's own window encodes one H.264 stream per screen region (VP8/VP9
when H.264 is unavailable), up to 720p, sent directly over the local
network. Sound stays PCM, since phones play WebRTC audio at call volume. **Settings → General →
Fluidez no celular** chooses 30 (default) or 60 frames per second. The
phone's top bar shows the frame rate, bitrate, codec and resolution, plus
lost packets, freezes and whether a pause came from the PC or the network.
Where WebRTC cannot connect, for example through a TCP-only port forward, the
phone keeps the JPEG picture.

Touch controls are translucent by default. Adjust **Visibilidade dos controles**
in the phone's game menu; that preference stays on the phone. Held buttons are
refreshed while connected so starting the runtime or dropping an input packet
does not permanently lose a press. Leaving the page releases its controls;
the server also releases them if the phone stops sending input heartbeats.

The page only opens with the random token in the QR code, which changes each
time phone play starts. The runtime publishes each frame in shared memory, so
the picture reaches the phone even with the PC's screen off: frames from
software cores at the console's own resolution, and frames from GPU-drawn
games (N64, PSP, PS2) read back only while a phone watches. Screen capture
shows OpenRetro itself when no game runs, and sends nothing while another app
is in front, so guests and phones never see the rest of the PC. Sound is the
PC's output. Phone buttons reach the runtime's remote gamepad, which listens
on loopback only.
Windows asks once whether OpenRetro may use the network; allow private
networks. Phones cannot connect while the PC's network is marked as Public:
the phone dialog then warns about it and opens the Windows page where the
network profile is changed to Private, and the warning clears on its own.

## Big Picture tools

Big Picture is laid out like a PlayStation 5. The top bar holds the **Jogos**,
**Biblioteca** and **Explorar** tabs (LB/RB switch them; Up from the content
reaches the bar) and shortcuts to search, downloads, friends and settings.
**Jogos** shows the recently played games in a row with the library, catalog
and import tiles after them; the focused tile's hub below has Play, online play,
favorite and options, with playtime, last session, achievements and the game's
description. X favorites and Y opens the game's options (play, play online,
manage, favorite, remove) on home and in the library.

Options (or the PS / Xbox button, where the browser exposes it, or M on the
keyboard) opens the **Central de controle** at the bottom of the screen:
downloads, friends, Party, phone play, background theme, game import, download
sources, settings and power. Everything the desktop has is reachable there: game
details/configuration, file and folder import, emulator installers, download
controls, JSON sources and application settings. These screens stay inside the
console shell and load only when opened.

The background is a parallax scene that shifts with the focus and the mouse.
The focused game's art is the default. The other themes are blue waves, real public-domain photos
(NASA, the U.S. Air Force and U.S. national parks) and pixel-art layers from
CC0 game art packs by ansimuz, each layer moving at its own depth; sources and
licenses are listed in `public/themes/CREDITS.md`, and the OpenRetro pixel
valley. **Central de
controle → Tema do fundo** also turns the player's own pictures into
backgrounds; each one is copied into `backgrounds` in application data (PNG,
JPG, WEBP or GIF, up to 40 MB), so it keeps working after the original moves.

Use the D-pad/stick to focus controls and A to activate. Selects require A to open,
Up/Down to highlight and A to apply; B cancels. Text fields open the virtual
keyboard; Y cycles lowercase, uppercase and symbols. LB/RB moves through fields
in document order. B closes the current dialog or screen.

File selection for games, BIOS, executables, JSON sources, background pictures
and download folders uses an integrated controller-navigable browser in the
native app. Directory listings show up to 500 entries; search by name to find
entries beyond that limit. Native file access and emulation require the Tauri
app, not browser preview.

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

The desktop catalog uses **LaunchBox Games Database**, with real covers, screenshots, developers, console libraries, genre filters, search, ordering, and pagination. The mock provider is retained only as a development/test fixture; the application does not silently fall back to fictional games.

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

## LaunchBox catalog

The desktop app downloads the public [LaunchBox Games Database](https://gamesdb.launchbox-app.com/) dump on first launch and builds a local SQLite index for the 16 supported consoles. No API key or account is needed. Open **Catálogo** to follow download/indexing progress; failed downloads can be retried there. An existing index stays usable during its weekly background refresh.

Catalog search, console/genre filters, ordering and pagination run against the local index. Covers and screenshots load from LaunchBox as needed. Gameplay thumbnails are resized and cached locally; the image viewer loads the original. Browser previews show that the catalog requires the desktop app.

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

3. Search titles in **Downloads**, or open an LaunchBox game and click **Find download**. Choose an edition and magnet, then **Start download**. Selecting a source result is explicit; LaunchBox records are never silently matched to unrelated files.
4. Native BitTorrent runs inside OpenRetro using [librqbit](https://github.com/ikatson/rqbit), without an external torrent client or HTTP control server. Progress, speed, remaining time and errors are real. You can pause, resume or cancel. Closing the app interrupts transfers; reopening restores them paused, and Resume rechecks existing pieces. Cancelling retains partial files. BitTorrent uploads pieces while downloading; completed transfers are detached and stop seeding.
5. At completion, click **Add to library**, choose the downloaded console file and confirm its platform/metadata. Archives must currently be extracted manually; installers and scripts are not executed. Configure a compatible emulator and click **Play game**. Automatic emulator installation is not implemented.

Settings → Downloads lets you choose the destination. Each transfer gets its own UUID folder, and its original directory remains saved even if the default changes. JSON sources, their enablement, and jobs persist in SQLite. Browser preview supports JSON source management and search with separate localStorage data; actual torrents, file access and launching require desktop.

### Import an existing file

1. Open the desktop app, click **Add Game**, and choose a legally obtained game file.
2. Confirm the detected platform. `.bin` and `.pbp` are ambiguous and require a deliberate selection. ZIP archives are treated as Arcade files and are never extracted automatically.
3. Choose matching LaunchBox metadata or keep your own title. Filename matching uses normalized names and aliases in the local LaunchBox index; a console-specific manual search is also available. You can still import when the metadata service is offline. No remote hash-match database is configured. SHA-256 fingerprints are streamed in Rust, then reused on import while the file size and modification time match.
4. Optional: the OpenRetro Runtime already plays every console. To use an external emulator instead, go to **Emulators → Add emulator**, select an official, already-installed executable, mark its supported systems, and optionally make it the default for those systems. Detection only searches PATH for known emulator names.
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
    discover/       local LaunchBox catalog, consoles, genres and indexing progress
    library/        import wizard
    games/          game page, resolver feedback and configuration
    emulators/      executable registration, detection, defaults and path tests
    downloads/      JSON sources, source search, transfers and file import
    settings/       local preferences, storage paths and milestone boundaries
  hooks/            TanStack Query reads and invalidation
  providers/
    metadata/       MetadataProvider + LaunchboxMetadataProvider + test mock
    sources/        GameSourceProvider + LocalFileProvider + MockFreewareProvider
  services/         GameResolver, EmulatorManager, LibraryManager, DownloadManager, bridge
  types/            strict domain models
src-tauri/
  capabilities/     main-window permissions
  src/
    commands/       IPC handlers and input validation
    database/       SQLite setup, migrations 001/002 and queries
    metadata/       LaunchBox download, streaming XML parser and SQLite index
    filesystem/     canonical paths, executable validation, streamed SHA-256
    launcher/       process ownership and session accounting
    downloads/      validated source persistence and native BitTorrent engine
```

`GameResolver` returns `READY`, `MISSING_GAME`, `MISSING_EMULATOR`, `MISSING_BIOS`, `CONFIGURATION_REQUIRED` or `UNSUPPORTED`. UI components explain the next action. The Rust launcher independently checks paths, compatibility and BIOS configuration before execution; it never trusts the frontend's readiness result.

`GameMetadata`, `Platform`, `LibraryItem`, `Emulator`, and `GameResolution` are the primary models. Metadata providers return catalog records without acquiring game files. Source providers resolve availability independently. `EmulatorInstaller` is an interface for future official installers; no executable downloader is supplied. The implementation uses Tailwind 4 alongside a custom stylesheet, Lucide icons, and small accessible controls rather than adding a component kit unnecessarily.

### SQLite

The database lives in Tauri's OS-specific app-data directory as `openretro.sqlite`. Settings → Advanced shows its exact path, plus cache and log directories. Foreign keys are enabled and WAL mode is used. Migrations 001 and 002 run in a transaction and record their versions in `schema_migrations`. Existing library entries remain compatible with the optional LaunchBox metadata fields.

| Table              | Purpose                                                                          |
| ------------------ | -------------------------------------------------------------------------------- |
| `games`            | Game metadata keyed by ID                                                        |
| `platforms`        | Known systems and file extensions                                                |
| `library_items`    | File path, SHA-256, source, emulator override, BIOS, args, favorite and playtime |
| `emulators`        | Registered executables, compatible systems and default systems                   |
| `play_sessions`    | Start, finish, duration and process exit code                                    |
| `sources`          | Local files and disabled mock fixtures                                           |
| `settings`         | Persisted application preferences                                                |
| `metadata_cache`   | Legacy public metadata cache; retained for database compatibility                |
| `download_sources` | User-imported JSON catalogs, URLs, enabled state and refresh timestamp           |
| `download_jobs`    | Torrent identity, destination, linked metadata and latest transfer state         |

SHA-256 is unique in the library to prevent duplicate imports. Removing an emulator clears per-game overrides. A partial unique index prevents two active sessions of the same game. Crash-interrupted sessions close at startup with no invented offline time. Session tracking lasts until the launched process exits; keep OpenRetro open while playing.

## Security and scope

- Importing never modifies, copies, or executes the original game file.
- Paths must be absolute, canonicalize to files, and contain no `..` traversal or NUL. Executable permissions are checked on Linux; Windows accepts `.exe` executables only.
- Rust uses `std::process::Command` and separate arguments, never shell interpolation. Providers cannot supply executable scripts.
- The registered emulator is a trusted application chosen by the user. Per-game arguments may enable emulator-specific behavior; only use configuration you understand.
- Remote JSON sources require HTTPS, bounded UTF-8 responses and valid magnet entries. Torrent metadata is resolved before payload writes; filenames are validated against traversal, drive prefixes, alternate streams, symlinks and device names. BitTorrent validates piece hashes; library import computes SHA-256. This validates integrity, not the trustworthiness of third-party content. Automatic extraction, executable installation, queue/bandwidth limits and selective torrent files are not implemented.
- Catalog metadata comes from the public LaunchBox dump, downloaded and indexed by Rust. SQL filters use bound parameters. Remote thumbnails accept only filenames on the official LaunchBox image CDN, with bounded downloads and decoding; local screenshots use a scoped asset protocol.
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

Tests cover the domain, migrations, LaunchBox normalization and provider commands, Hydra JSON parsing, source persistence and interrupted download recovery. Rust tests include a real local-peer magnet transfer with integrity verification, pause/unpause, file retention and downloaded-file detection. GitHub Actions builds/tests the frontend and checks Rust on Windows and Linux.

Local verification includes a frontend production build, frontend/database tests, `cargo check`, Rust tests, catalog fixture checks, browser navigation/source management, responsive layouts, both themes and native desktop startup. Public-swarm availability depends on the user's source and peers. A real emulator session, production installer packaging, Linux execution and a remote CI run remain unverified. See [the validation record](VALIDATION.md).

## License

Application code and original development illustrations: MIT, see [LICENSE](../LICENSE). LaunchBox metadata and game artwork retain their respective providers' and owners' rights; they are not relicensed under MIT.

OpenRetro Runtime is built from RetroArch and remains GPL-3.0-or-later. Its
manifest, notices and corresponding source are distributed separately from the
MIT application. Downloaded Libretro cores retain their individual licenses.

Nunito Sans is bundled locally as a single Latin variable font; its SIL Open Font License notice are in `public/licenses/`. The visual system is documented in [docs/DESIGN.md](DESIGN.md). librqbit is Apache-2.0; its dependency licensing remains separate from OpenRetro's MIT application code.
