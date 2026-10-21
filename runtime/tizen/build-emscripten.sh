#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$PROJECT_ROOT/runtime/retroarch/upstream.env"
source "$SCRIPT_DIR/cores.env"

CACHE_ROOT="${OPENRETRO_TIZEN_CACHE:-$PROJECT_ROOT/.cache/openretro-tizen}"
OUTPUT_ROOT="${OPENRETRO_TIZEN_OUTPUT:-$PROJECT_ROOT/dist-runtime/tizen}"
RETROARCH_DIR="$CACHE_ROOT/RetroArch"

for command in git emmake make sha256sum tar; do
  command -v "$command" >/dev/null 2>&1 || {
    echo "Missing build command: $command" >&2
    exit 1
  }
done

checkout_pinned() {
  local repository="$1" commit="$2" destination="$3"
  if [[ ! -d "$destination/.git" ]]; then
    rm -rf "$destination"
    git clone --filter=blob:none --no-checkout "$repository" "$destination"
  fi
  git -C "$destination" fetch --depth 1 origin "$commit"
  git -C "$destination" checkout --detach --force "$commit"
  [[ "$(git -C "$destination" rev-parse HEAD)" == "$commit" ]]
}

checkout_pinned "$RETROARCH_REPOSITORY" "$RETROARCH_COMMIT" "$RETROARCH_DIR"
rm -rf "$OUTPUT_ROOT"
mkdir -p "$OUTPUT_ROOT/licenses"
cp "$RETROARCH_DIR/COPYING" "$OUTPUT_ROOT/licenses/RetroArch-GPL-3.0.txt"

build_core() {
  local name="$1" repository="$2" commit="$3"
  local core_dir="$CACHE_ROOT/$name"
  if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
    echo "::group::Build libretro core: $name"
  fi
  checkout_pinned "$repository" "$commit" "$core_dir"
  local license
  license="$(find "$core_dir" -maxdepth 1 -type f \( -iname 'copying*' -o -iname 'license*' \) | head -n 1)"
  if [[ -n "$license" ]]; then
    cp "$license" "$OUTPUT_ROOT/licenses/$name-$(basename "$license")"
  fi
  pushd "$core_dir" >/dev/null
  local makefile
  if [[ -f Makefile.libretro ]]; then
    makefile="Makefile.libretro"
  elif [[ -f Makefile ]]; then
    makefile="Makefile"
  else
    echo "No libretro Makefile found for $name" >&2
    exit 1
  fi
  echo "Building $name with $makefile"
  emmake make -f "$makefile" clean platform=emscripten >/dev/null 2>&1 || true
  emmake make -f "$makefile" platform=emscripten -j"${NUMBER_OF_PROCESSORS:-$(nproc)}"
  local library
  library="$(find . -maxdepth 3 -type f \( -name '*_libretro_emscripten.bc' -o -name '*_libretro_emscripten.a' \) | head -n 1)"
  [[ -n "$library" ]] || { echo "No Emscripten library produced for $name" >&2; exit 1; }
  cp "$library" "$RETROARCH_DIR/libretro_emscripten.bc"
  popd >/dev/null

  pushd "$RETROARCH_DIR" >/dev/null
  make -f Makefile.emscripten clean >/dev/null 2>&1 || true
  emmake make -f Makefile.emscripten -j"${NUMBER_OF_PROCESSORS:-$(nproc)}" \
    LIBRETRO="$name" TARGET="${name}_libretro.js" \
    HAVE_MENU=0 HAVE_RGUI=0 HAVE_GFX_WIDGETS=0 HAVE_NETWORKING=0 \
    HAVE_ONLINE_UPDATER=0 HAVE_UPDATE_ASSETS=0 HAVE_LIBRETRODB=0 \
    HAVE_CHEATS=0 HAVE_REWIND=0 HAVE_RUNAHEAD=0 HAVE_OVERLAY=0 \
    HAVE_SCREENSHOTS=1 HAVE_COMMAND=1 HAVE_STDIN_CMD=0 \
    ASYNC=1 LTO=1 INITIAL_HEAP=134217728 STACK_SIZE=16777216
  mkdir -p "$OUTPUT_ROOT/$name"
  cp "${name}_libretro.js" "${name}_libretro.wasm" "$OUTPUT_ROOT/$name/"
  popd >/dev/null
  if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
    echo "::endgroup::"
  fi
}

build_core fceumm "$FCEUMM_REPOSITORY" "$FCEUMM_COMMIT"
build_core gambatte "$GAMBATTE_REPOSITORY" "$GAMBATTE_COMMIT"
build_core snes9x2005 "$SNES9X2005_REPOSITORY" "$SNES9X2005_COMMIT"
build_core genesis_plus_gx "$GENESIS_PLUS_GX_REPOSITORY" "$GENESIS_PLUS_GX_COMMIT"
build_core gpsp "$GPSP_REPOSITORY" "$GPSP_COMMIT"

cat > "$OUTPUT_ROOT/runtime-manifest.json" <<EOF
{
  "kind": "openretro-tizen-wasm",
  "runtimeRevision": 1,
  "retroarchVersion": "$RETROARCH_VERSION",
  "retroarchCommit": "$RETROARCH_COMMIT",
  "target": "tizen-tv-5.5-wasm",
  "cores": ["fceumm", "gambatte", "snes9x2005", "genesis_plus_gx", "gpsp"]
}
EOF

find "$OUTPUT_ROOT" -type f \( -name '*.js' -o -name '*.wasm' \) -print0 |
  sort -z | xargs -0 sha256sum > "$OUTPUT_ROOT/SHA256SUMS"

cat > "$OUTPUT_ROOT/SOURCE.md" <<EOF
# Corresponding source

This runtime contains RetroArch $RETROARCH_VERSION at $RETROARCH_COMMIT from
$RETROARCH_REPOSITORY and statically linked Libretro cores at the commits in
runtime/tizen/cores.env. The exact build recipe is
runtime/tizen/build-emscripten.sh in the OpenRetro repository.

The complete corresponding source archive is published beside the binary
artifact as openretro-runtime-tizen-source-$RETROARCH_VERSION.tar.gz.
EOF

SOURCE_STAGE="$CACHE_ROOT/source-package"
rm -rf "$SOURCE_STAGE"
mkdir -p "$SOURCE_STAGE/openretro-runtime-tizen/openretro-build"
git -C "$RETROARCH_DIR" archive "$RETROARCH_COMMIT" | tar -x -C "$SOURCE_STAGE/openretro-runtime-tizen"
for name in fceumm gambatte snes9x2005 genesis_plus_gx gpsp; do
  mkdir -p "$SOURCE_STAGE/openretro-runtime-tizen/cores/$name"
  git -C "$CACHE_ROOT/$name" archive HEAD | tar -x -C "$SOURCE_STAGE/openretro-runtime-tizen/cores/$name"
done
cp "$SCRIPT_DIR"/{build-emscripten.sh,cores.env} "$SOURCE_STAGE/openretro-runtime-tizen/openretro-build/"
tar -czf "$PROJECT_ROOT/dist-runtime/openretro-runtime-tizen-source-$RETROARCH_VERSION.tar.gz" \
  -C "$SOURCE_STAGE" openretro-runtime-tizen
echo "OpenRetro Tizen runtime ready: $OUTPUT_ROOT"
