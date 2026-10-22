# OpenRetro Runtime

OpenRetro Runtime is a downstream, minimal build of RetroArch used only as the
native Libretro host. It is launched as a private child process; every visible
screen, download, update, profile and in-game action belongs to OpenRetro.
On Windows, its native video window is reparented into the main OpenRetro HWND,
resized to the client area and removed from the taskbar. Keeping the runtime in
a child process preserves crash isolation without exposing a second app window.

## Included boundary

The runtime keeps dynamic Libretro core loading, configuration files, D3D11,
OpenGL and Vulkan hardware contexts, SDL2 and Windows controller input, WASAPI
and XAudio, threading, ZIP/7z/CHD support, save data, save states, screenshots
and the command channel used by OpenRetro's in-game menu.

It excludes the RetroArch menu drivers, widgets, database, playlists, online
updater, networking and netplay, achievements, Discord, recording, streaming,
media viewers, overlays, cheats, rewind, runahead, filters, translation,
accessibility, microphone, CD handling and unused legacy Windows drivers. The
authoritative list is `runtime/retroarch/configure-flags.txt`.

No emulator core, game or BIOS is bundled. A supported core is still downloaded
on first play and cached in the application data directory. The core is a
separate program with its own project and license.

## Reproducible inputs

`runtime/retroarch/upstream.env` pins full Git commits for RetroArch and the
controller profiles. `build-mingw64.sh` refuses a checkout whose `HEAD` differs
from the pin. The resulting package contains:

- `runtime-manifest.json`, including commits and the executable SHA-256;
- `SOURCE.md`, with the exact source locations;
- the RetroArch GPLv3 notice;
- licenses for copied MinGW runtime dependencies;
- SDL2 controller profiles only;
- `retroarch.exe`, its required non-system DLLs and a minimal base config.

The release workflow also uploads the binary runtime ZIP and the complete
corresponding RetroArch source archive to the OpenRetro GitHub release.

## Build on Windows

Install MSYS2, open its MINGW64 terminal and install the prerequisites once:

```sh
pacman -S --needed git make base-devel \
  mingw-w64-x86_64-toolchain \
  mingw-w64-x86_64-SDL2 \
  mingw-w64-x86_64-vulkan-headers \
  mingw-w64-x86_64-vulkan-loader \
  mingw-w64-x86_64-ntldd
```

From PowerShell in the OpenRetro repository:

```powershell
npm run build:runtime
npm run prepare:runtime
npm run bundle:windows
```

The build writes the installable runtime under
`src-tauri/resources/runtime/retroarch` and distributable archives under
`dist-runtime`. Both directories contain generated files and stay outside Git.

To iterate faster, also install `mingw-w64-x86_64-ccache`; the build uses it
automatically when present. `npm run build:runtime:dev` keeps the previous
objects and only reruns `configure` when `configure-flags.txt` changes, so a
rebuild without source changes takes seconds. Release packages always use the
clean `npm run build:runtime`.

The runtime must be built with the stdin command interface: OpenRetro pauses,
saves states, takes screenshots, resets and quits through it. MinGW's
`configure` drops it because `fcntl()` is missing, so the build forces it on
and fails if it is absent.

For development only, `npm run prepare:runtime:official` prepares the trimmed
official distribution. Release builds reject that fallback and require a
manifest whose kind is `openretro-minimal`.

## Updating upstream

1. Choose a released RetroArch revision and record its full commit in
   `upstream.env`.
2. Update the controller-profile commit separately.
3. Run `npm run test:runtime-recipe`.
4. Build the runtime and test every supported platform, controllers, save/load,
   screenshots, pause/resume and clean exit on a fresh Windows account.
5. Compare the runtime manifest, package size and dependency licenses.
6. Increase `OPENRETRO_RUNTIME_REVISION` whenever the flags or packaging change.

Keep downstream source changes small. If a source patch becomes necessary, put
it under `runtime/retroarch/patches`, apply it after commit verification and
include it in the corresponding source package. Configuration-only changes do
not require carrying a long-lived source fork.
