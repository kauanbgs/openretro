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
  git -C "$destination" fetch --depth 1 origin "$commit"
  git -C "$destination" checkout --detach --force "$commit"
  local actual
  actual="$(git -C "$destination" rev-parse HEAD)"
  [[ "$actual" == "$commit" ]] || {
    echo "Pinned source mismatch: expected $commit, got $actual" >&2
    exit 1
  }
}

checkout_pinned "$RETROARCH_REPOSITORY" "$RETROARCH_COMMIT" "$SOURCE_DIR"
checkout_pinned "$AUTOCONFIG_REPOSITORY" "$AUTOCONFIG_COMMIT" "$AUTOCONFIG_DIR"

mapfile -t CONFIGURE_FLAGS < <(sed -e 's/[[:space:]]*#.*$//' -e '/^[[:space:]]*$/d' "$SCRIPT_DIR/configure-flags.txt")

pushd "$SOURCE_DIR" >/dev/null
make clean >/dev/null 2>&1 || true
rm -f config.mk config.log
CFLAGS="-Os -DNDEBUG -ffunction-sections -fdata-sections" \
CXXFLAGS="-Os -DNDEBUG -ffunction-sections -fdata-sections" \
LDFLAGS="-Wl,--gc-sections -s" \
  ./configure "${CONFIGURE_FLAGS[@]}"
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
      package="$(pacman -Qo "$dependency" 2>/dev/null | awk '{print $5}' || true)"
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
done < <(ntldd -R "$SOURCE_DIR/retroarch.exe" | awk '/=>/ { print $3 }' | sort -u)

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
runtime/retroarch directory of OpenRetro. No source patch is applied; the
feature set is selected exclusively by configure-flags.txt.

The controller profiles come from commit $AUTOCONFIG_COMMIT of
$AUTOCONFIG_REPOSITORY. Emulator cores are not part of this package.

See DEPENDENCIES.txt and licenses/runtime-dependencies for the exact MSYS2
packages that supplied non-system DLLs and their notices.
EOF

rm -rf "$SOURCE_STAGE"
mkdir -p "$SOURCE_STAGE/RetroArch-$RETROARCH_VERSION/openretro-build"
git -C "$SOURCE_DIR" archive "$RETROARCH_COMMIT" | tar -x -C "$SOURCE_STAGE/RetroArch-$RETROARCH_VERSION"
cp "$SCRIPT_DIR"/{build-mingw64.sh,configure-flags.txt,retroarch.cfg,upstream.env} \
  "$SOURCE_STAGE/RetroArch-$RETROARCH_VERSION/openretro-build/"
tar -czf "$DIST_ROOT/openretro-runtime-source-$RETROARCH_VERSION-r$OPENRETRO_RUNTIME_REVISION.tar.gz" \
  -C "$SOURCE_STAGE" "RetroArch-$RETROARCH_VERSION"

powershell.exe -NoLogo -NoProfile -Command \
  "Compress-Archive -Path '$(cygpath -w "$OUTPUT_ROOT")\\*' -DestinationPath '$(cygpath -w "$DIST_ROOT/openretro-runtime-windows-x86_64.zip")' -Force"

size_bytes="$(du -sb "$OUTPUT_ROOT" | awk '{print $1}')"
echo "OpenRetro Runtime ready: $OUTPUT_ROOT ($((size_bytes / 1024 / 1024)) MB)"
echo "Binary package: $DIST_ROOT/openretro-runtime-windows-x86_64.zip"
echo "Source package: $DIST_ROOT/openretro-runtime-source-$RETROARCH_VERSION-r$OPENRETRO_RUNTIME_REVISION.tar.gz"
