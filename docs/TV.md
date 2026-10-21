# Samsung / LG TV target

The current deliverable is a Windows/Tauri application. It is not a Tizen or
webOS package. A TV build must replace native IPC, the Windows runtime, process
launching, and the native BitTorrent engine; reusing the UI alone is insufficient.

## Smallest useful TV version

- Package the console UI for Samsung Tizen (`.wgt`) or LG webOS (`.ipk`). Confirm
  the exact TV model/year before choosing the JavaScript compilation target.
- Run lightweight emulation through a WebAssembly core worker and canvas/audio.
  Start with NES, GB/GBC, Master System and Mega Drive; measure SNES/GBA on the
  target hardware. Do not advertise PS2 support or a universal frame-rate target.
- Download one core when a supported game is first played. Cache it and the game
  locally; instantiate only one core and release its worker/memory on exit.
- Use HTTPS downloads with streaming, progress, cancellation, storage quota
  checks and recovery. A TV web app cannot directly reuse the desktop torrent
  engine. Arbitrary sources may require a server because of CORS/authentication.
- Keep IGDB credentials on a backend, with cached metadata responses. The
  desktop's Rust metadata service and development Vite proxy are not a TV backend.
- Store saves separately from game/core caches, export them, and handle storage
  eviction. Controller/remote mappings and platform-reserved PS/Guide buttons
  need tests on the actual television.

## Reductions implemented in the desktop code

- Desktop pages unmount while Big Picture is active, avoiding hidden catalog
  queries, page observers and image elements.
- Overlay and application code use separate lazy entry points.
- Catalog card images load lazily and decode asynchronously. Thumbnails use
  smaller artwork than detail views. No backdrop blur in the console UI.
- Controller sampling uses one stable 30 Hz loop, independent of React renders.
- The release runtime preparation omits cores, menu artwork, shaders, databases
  and other unused content by default. `-KeepExtras` retains the full distribution
  for debugging. Existing installations are not modified by this preparation.
- A console core is already fetched and reused only when required by Play.

These changes have not been benchmarked on a TV. Installer size depends on the
official runtime; the preparation script reports its size after trimming.

## Hardware verification before shipping

Measure cold startup, download size, idle CPU, UI frame times, process memory,
core startup, audio latency and sustained emulation on the actual lowest-end
supported model. Test library growth, large downloads, low storage, suspension,
controller reconnection and save recovery. Keep a per-model compatibility list.

Official platform references:

- [Samsung WebAssembly overview](https://developer.samsung.com/smarttv/develop/extension-libraries/webassembly/overview.html) — supported from Tizen 5.5 / 2020 models.
- [LG webOS engine versions](https://webostv.developer.lge.com/develop/specifications/web-api-and-web-engine) — engine and API compatibility vary by model generation.
