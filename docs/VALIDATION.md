# Milestone 1 validation

Validated locally on Windows:

- `npm run build`: passes, including TypeScript strict checking.
- `npm test`: 20 tests pass (domain and the actual SQLite migration).
- `npm run format:check`: passes.
- `npm audit`: zero vulnerabilities, including development dependencies.
- Browser: imported `tests/fixtures/OpenRetro test fixture.gba`, detected GBA, kept a custom title, calculated SHA-256, opened its detail page, marked favorite, and verified persistence after reload.
- Browser: Details displayed SHA-256 `e2c6c891837226d98f911eb1d735f06e7f44633094e93526f20f5e88e76b522c`; the local file's hash was checked independently.
- Browser: removed only the QA library entry through its confirmation dialog; the source file remains present.
- Browser: searching `moon` through `MockMetadataProvider` returns only Moonfall.
- Visual inspection: home screen, sidebar, game cards and import wizard checked in the in-app browser, including its narrow layout.

## Native validation pending

`npm run tauri info` finds WebView2 and Visual Studio Community 2022, but Rust/Cargo/rustup are absent. The Visual Studio installation does not expose a usable VC C++ tools component through `vswhere`. Native compilation, Rust tests, packaging, and an actual emulator process have **not** been verified on this machine. The Windows/Linux CI workflow is supplied, but has not been run remotely.

Once prerequisites are installed:

1. Run `cargo test --manifest-path src-tauri/Cargo.toml`.
2. Run `cargo check --manifest-path src-tauri/Cargo.toml`.
3. Run `npm run tauri dev`.
4. Import an authorized, playable game file. The `.gba` fixture is plain test text and cannot be played.
5. Register an installed compatible emulator and choose it as default.
6. Launch the game; close the emulator and verify `lastPlayedAt`, a completed `play_sessions` row, and accumulated playtime.
7. Run `npm run tauri build` to verify the installer/bundle.

Browser imports are intentionally isolated in localStorage and do not prove SQLite persistence through Rust or native launch behavior.
