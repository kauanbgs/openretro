#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$SCRIPT_DIR/upstream.env"

CACHE_ROOT="${OPENRETRO_RUNTIME_CACHE:-$PROJECT_ROOT/.cache/openretro-runtime}"
SOURCE_DIR="$CACHE_ROOT/RetroArch"
AUTOCONFIG_DIR="$CACHE_ROOT/retroarch-joypad-autoconfig"
OUTPUT_ROOT="${OPENRETRO_RUNTIME_OUTPUT:-$PROJECT_ROOT/src-tauri/resources/runtime/retroarch}"
DIST_ROOT="${OPENRETRO_RUNTIME_DIST:-$PROJECT_ROOT/dist-runtime}"
SOURCE_STAGE="$CACHE_ROOT/source-package"
# Incremental builds reuse the previous objects and configure run. Releases
# leave it unset so every package is built from a clean tree.
INCREMENTAL="${OPENRETRO_RUNTIME_INCREMENTAL:-0}"

for command in git make gcc strip ntldd sha256sum tar; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "Missing build command: $command" >&2
    exit 1
  }
done

checkout_pinned() {
  local repository="$1"
  local commit="$2"
  local destination="$3"
  if [[ ! -d "$destination/.git" ]]; then
    rm -rf "$destination"
    git clone --filter=blob:none --no-checkout "$repository" "$destination"
  fi
  # The pinned commit never changes, so only fetch it once.
  git -C "$destination" cat-file -e "$commit^{commit}" 2>/dev/null ||
    git -C "$destination" fetch --depth 1 origin "$commit"
  # A forced checkout rewrites the patched files, which makes make rebuild
  # them; incremental builds keep the tree when it is already on the commit.
  if [[ "$INCREMENTAL" != 1 || "$(git -C "$destination" rev-parse HEAD)" != "$commit" ]]; then
    git -C "$destination" checkout --detach --force "$commit"
  fi
  local actual
  actual="$(git -C "$destination" rev-parse HEAD)"
  [[ "$actual" == "$commit" ]] || {
    echo "Pinned source mismatch: expected $commit, got $actual" >&2
    exit 1
  }
}

# Patches can depend on earlier patches. Restack in reverse order when the
# recipe changes; checking each older patch in isolation fails after a later
# patch edits its context. An unchanged incremental build skips this entirely.
PATCH_FILES=("$SCRIPT_DIR"/patches/*.patch)
PATCH_STAMP="$(cat "${PATCH_FILES[@]}" | sha256sum | cut -d' ' -f1)"
NEEDS_PATCHES=1
if [[ "$INCREMENTAL" == 1 && -d "$SOURCE_DIR/.git" \
   && "$(git -C "$SOURCE_DIR" rev-parse HEAD)" == "$RETROARCH_COMMIT" \
   && "$(cat "$SOURCE_DIR/.openretro-patches" 2>/dev/null)" == "$PATCH_STAMP" ]]; then
  NEEDS_PATCHES=0
elif [[ -d "$SOURCE_DIR/.git" ]]; then
  for ((i=${#PATCH_FILES[@]}-1; i>=0; i--)); do
    if git -C "$SOURCE_DIR" apply --reverse --check --whitespace=nowarn "${PATCH_FILES[i]}" 2>/dev/null; then
      git -C "$SOURCE_DIR" apply --reverse --whitespace=nowarn "${PATCH_FILES[i]}"
    fi
  done
fi

checkout_pinned "$RETROARCH_REPOSITORY" "$RETROARCH_COMMIT" "$SOURCE_DIR"
checkout_pinned "$AUTOCONFIG_REPOSITORY" "$AUTOCONFIG_COMMIT" "$AUTOCONFIG_DIR"
if [[ "$NEEDS_PATCHES" == 1 ]]; then
  for patch in "${PATCH_FILES[@]}"; do
    git -C "$SOURCE_DIR" apply --whitespace=nowarn "$patch"
  done
  echo "$PATCH_STAMP" > "$SOURCE_DIR/.openretro-patches"
fi

# Exercise the same input reducer compiled into the runtime.
gcc -std=c99 -I"$SOURCE_DIR/input" -I"$SOURCE_DIR/libretro-common/include" \
  "$SCRIPT_DIR/tests/party-input.c" -o "$CACHE_ROOT/party-input-test.exe"
"$CACHE_ROOT/party-input-test.exe"

gcc -std=c99 -I"$SOURCE_DIR/audio" "$SCRIPT_DIR/tests/game-audio.c" -o "$CACHE_ROOT/game-audio-test.exe"
"$CACHE_ROOT/game-audio-test.exe"

mapfile -t CONFIGURE_FLAGS < <(sed -e 's/[[:space:]]*#.*$//' -e '/^[[:space:]]*$/d' "$SCRIPT_DIR/configure-flags.txt")

# ccache returns unchanged objects instantly, even after make clean or a new
# config.h. It is optional and only changes build speed, never the output.
COMPILERS=()
if command -v ccache >/dev/null 2>&1; then
  COMPILERS=(CC="ccache gcc" CXX="ccache g++")
  echo "Using ccache for the runtime build."
fi
CONFIGURE_STAMP="$(printf '%s\n' "${CONFIGURE_FLAGS[@]}" "${COMPILERS[@]}" | sha256sum | cut -d' ' -f1)"

pushd "$SOURCE_DIR" >/dev/null
if [[ "$INCREMENTAL" != 1 ]]; then
  make clean >/dev/null 2>&1 || true
fi
# Rerunning configure regenerates config.h, which every file includes, so an
# incremental build only reconfigures when the flags or compilers changed.
if [[ "$INCREMENTAL" != 1 || ! -f config.mk || "$(cat .openretro-configure 2>/dev/null)" != "$CONFIGURE_STAMP" ]]; then
  rm -f config.mk config.log .openretro-configure
  env "${COMPILERS[@]}" \
  CFLAGS="-Os -DNDEBUG -ffunction-sections -fdata-sections" \
  CXXFLAGS="-Os -DNDEBUG -ffunction-sections -fdata-sections" \
  LDFLAGS="-Wl,--gc-sections -s" \
    ./configure "${CONFIGURE_FLAGS[@]}"
  # configure only enables the stdin command interface when it finds fcntl(),
  # which MinGW lacks, so it silently drops it. The Windows implementation reads
  # the pipe with PeekNamedPipe and needs no fcntl. OpenRetro's in-game menu
  # (pause, states, screenshots, quit) depends on it, so force it on and fail
  # loudly if that ever stops working.
  sed -i 's/^HAVE_STDIN_CMD = 0$/HAVE_STDIN_CMD = 1/' config.mk
  sed -i 's|^/\* #undef HAVE_STDIN_CMD \*/$|#define HAVE_STDIN_CMD 1|' config.h
  echo "$CONFIGURE_STAMP" > .openretro-configure
fi
grep -q '^HAVE_STDIN_CMD = 1$' config.mk && grep -q '^#define HAVE_STDIN_CMD 1$' config.h || {
  echo "The runtime must be built with stdin commands enabled." >&2
  exit 1
}
make -j"${NUMBER_OF_PROCESSORS:-$(nproc)}"
strip -s retroarch.exe
popd >/dev/null

rm -rf "$OUTPUT_ROOT"
mkdir -p "$OUTPUT_ROOT/licenses" "$OUTPUT_ROOT/autoconfig/sdl2" "$DIST_ROOT"
cp "$SOURCE_DIR/retroarch.exe" "$OUTPUT_ROOT/retroarch.exe"
cp "$SCRIPT_DIR/retroarch.cfg" "$OUTPUT_ROOT/retroarch.cfg"
cp "$SOURCE_DIR/COPYING" "$OUTPUT_ROOT/licenses/RetroArch-GPL-3.0.txt"
cp -R "$AUTOCONFIG_DIR/sdl2/." "$OUTPUT_ROOT/autoconfig/sdl2/"
if [[ -f "$AUTOCONFIG_DIR/COPYING" ]]; then
  cp "$AUTOCONFIG_DIR/COPYING" "$OUTPUT_ROOT/licenses/RetroArch-autoconfig.txt"
fi

cat > "$OUTPUT_ROOT/DEPENDENCIES.txt" <<'EOF'
OpenRetro Runtime dynamic dependencies

Windows system DLLs are supplied by the operating system and are not copied.
The entries below are the MSYS2 packages that supplied copied DLLs. Package
source and metadata are available at https://packages.msys2.org/.
EOF

# Copy only non-system DLLs linked by the final executable. Windows system DLLs
# never live below /mingw64 and are intentionally left to the operating system.
while IFS= read -r dependency; do
  if [[ "$dependency" =~ ^[A-Za-z]:\\ ]]; then
    dependency="$(cygpath -u "$dependency")"
  fi
  [[ "$dependency" == /mingw64/* ]] || continue
  if [[ -f "$dependency" ]]; then
    cp -f "$dependency" "$OUTPUT_ROOT/$(basename "$dependency")"
    if command -v pacman >/dev/null 2>&1; then
      package="$(pacman -Qqo "$dependency" 2>/dev/null || true)"
      short_package="${package#mingw-w64-x86_64-}"
      license_dir="/mingw64/share/licenses/$short_package"
      if [[ -n "$package" && -d "$license_dir" ]]; then
        mkdir -p "$OUTPUT_ROOT/licenses/runtime-dependencies/$short_package"
        cp -R "$license_dir/." "$OUTPUT_ROOT/licenses/runtime-dependencies/$short_package/"
      fi
      if [[ -n "$package" ]]; then
        printf '%s — %s\n' "$(basename "$dependency")" "$(pacman -Q "$package")" >> "$OUTPUT_ROOT/DEPENDENCIES.txt"
      fi
    fi
  fi
# The C locale keeps sort from failing on non-ASCII project paths.
done < <(ntldd -R "$SOURCE_DIR/retroarch.exe" | awk '/=>/ { print $3 }' | LC_ALL=C sort -u)

# SDL2 is required both by RetroArch and by OpenRetro's Guide-button listener.
if [[ -f /mingw64/bin/SDL2.dll ]]; then
  cp -f /mingw64/bin/SDL2.dll "$OUTPUT_ROOT/SDL2.dll"
fi
for license in /mingw64/share/licenses/SDL2/LICENSE.txt /mingw64/share/licenses/SDL2/COPYING.txt; do
  if [[ -f "$license" ]]; then
    cp "$license" "$OUTPUT_ROOT/licenses/SDL2.txt"
    break
  fi
done

binary_sha="$(sha256sum "$OUTPUT_ROOT/retroarch.exe" | awk '{print $1}')"
cat > "$OUTPUT_ROOT/runtime-manifest.json" <<EOF
{
  "kind": "openretro-minimal",
  "runtimeRevision": $OPENRETRO_RUNTIME_REVISION,
  "retroarchVersion": "$RETROARCH_VERSION",
  "retroarchCommit": "$RETROARCH_COMMIT",
  "autoconfigCommit": "$AUTOCONFIG_COMMIT",
  "target": "windows-x86_64",
  "menuIncluded": false,
  "coresIncluded": false,
  "retroarchSha256": "$binary_sha"
}
EOF

cat > "$OUTPUT_ROOT/SOURCE.md" <<EOF
# OpenRetro Runtime source

This package contains a minimal build of RetroArch $RETROARCH_VERSION under
GPL-3.0-or-later. The exact corresponding source is commit
$RETROARCH_COMMIT from $RETROARCH_REPOSITORY.

The build recipe, pinned dependencies and configuration are distributed in the
runtime/retroarch directory of OpenRetro. The feature set is selected by
configure-flags.txt; the build-only fixes in openretro-build/patches are
applied to the upstream source before compiling.

The controller profiles come from commit $AUTOCONFIG_COMMIT of
$AUTOCONFIG_REPOSITORY. Emulator cores are not part of this package.

See DEPENDENCIES.txt and licenses/runtime-dependencies for the exact MSYS2
packages that supplied non-system DLLs and their notices.
EOF

# Append the recipe to the upstream archive instead of extracting it: MSYS2 tar
# cannot recreate the macOS framework symlinks shipped in the RetroArch tree.
rm -rf "$SOURCE_STAGE"
mkdir -p "$SOURCE_STAGE/RetroArch-$RETROARCH_VERSION/openretro-build"
git -C "$SOURCE_DIR" archive --format=tar --prefix="RetroArch-$RETROARCH_VERSION/" \
  -o "$SOURCE_STAGE/source.tar" "$RETROARCH_COMMIT"
cp "$SCRIPT_DIR"/{build-mingw64.sh,configure-flags.txt,retroarch.cfg,upstream.env} \
  "$SOURCE_STAGE/RetroArch-$RETROARCH_VERSION/openretro-build/"
cp -R "$SCRIPT_DIR/tests" "$SOURCE_STAGE/RetroArch-$RETROARCH_VERSION/openretro-build/"
cp -R "$SCRIPT_DIR/patches" "$SOURCE_STAGE/RetroArch-$RETROARCH_VERSION/openretro-build/"
tar -rf "$SOURCE_STAGE/source.tar" -C "$SOURCE_STAGE" "RetroArch-$RETROARCH_VERSION/openretro-build"
gzip -9 -c "$SOURCE_STAGE/source.tar" \
  > "$DIST_ROOT/openretro-runtime-source-$RETROARCH_VERSION-r$OPENRETRO_RUNTIME_REVISION.tar.gz"

powershell.exe -NoLogo -NoProfile -Command \
  "Compress-Archive -Path '$(cygpath -w "$OUTPUT_ROOT")\\*' -DestinationPath '$(cygpath -w "$DIST_ROOT/openretro-runtime-windows-x86_64.zip")' -Force"

size_bytes="$(du -sb "$OUTPUT_ROOT" | awk '{print $1}')"
echo "OpenRetro Runtime ready: $OUTPUT_ROOT ($((size_bytes / 1024 / 1024)) MB)"
echo "Binary package: $DIST_ROOT/openretro-runtime-windows-x86_64.zip"
echo "Source package: $DIST_ROOT/openretro-runtime-source-$RETROARCH_VERSION-r$OPENRETRO_RUNTIME_REVISION.tar.gz"
