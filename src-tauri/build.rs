fn main() {
    tauri_build::build();
    // Examples need the same Common Controls v6 manifest and icon as the app.
    if std::env::var("TARGET").is_ok_and(|target| target.contains("windows-msvc")) {
        let resource =
            std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("resource.lib");
        println!("cargo:rustc-link-arg-examples={}", resource.display());
        xinput_shim();
    }
}

/// RPCS3's Party controllers come from OpenRetro's xinput1_3.dll, which the
/// app carries inside itself and writes next to RPCS3.
fn xinput_shim() {
    let manifest = std::path::PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let shim = manifest.join("xinput-shim");
    for file in ["Cargo.toml", "lib.rs", "build.rs", "exports.def"] {
        println!("cargo:rerun-if-changed={}", shim.join(file).display());
    }
    let target = std::env::var("TARGET").unwrap();
    let out = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
    let target_dir = out.join("xinput-shim");
    let cargo = std::env::var_os("CARGO").unwrap_or_else(|| "cargo".into());
    let status = std::process::Command::new(cargo)
        .args(["build", "--release", "--target", &target, "--manifest-path"])
        .arg(shim.join("Cargo.toml"))
        .arg("--target-dir")
        .arg(&target_dir)
        // The app's own flags (and its coverage or sanitizer settings) are
        // not the shim's.
        .env_remove("CARGO_ENCODED_RUSTFLAGS")
        .env_remove("RUSTFLAGS")
        .status()
        .expect("cargo could not build the XInput shim");
    assert!(status.success(), "the XInput shim failed to build");
    let built = target_dir
        .join(&target)
        .join("release")
        .join("xinput1_3.dll");
    std::fs::copy(&built, out.join("xinput1_3.dll")).expect("the XInput shim was not built");
}
