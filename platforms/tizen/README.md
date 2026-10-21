# OpenRetro for Samsung Tizen

This target packages the React Big Picture interface as a Samsung TV Web
application and runs the official RetroArch Emscripten frontend inside its own
canvas. It targets Samsung TV 5.5 or newer.

The generated package is not committed. Build the Web application with:

```powershell
npm run build:tizen
```

To include playable cores, first install and activate the Emscripten SDK, then
run `npm run build:runtime:tizen` from a shell that provides `emmake`. Package
and sign the staged application with:

```powershell
npm run package:tizen -- -CertificateProfile OpenRetroTV
```

Set `VITE_OPENRETRO_API_URL` at build time to an HTTPS OpenRetro catalog proxy.
IGDB credentials must remain on that server and are never embedded in the WGT.

The initial runtime supports NES, SNES, Game Boy, Game Boy Color, Game Boy
Advance, Master System, Mega Drive/Genesis and Game Gear. Each core is built
from a pinned upstream commit. Games, BIOS files and proprietary firmware are
not included.
