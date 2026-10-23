fn main() {
    tauri_build::build();
    // Examples need the same Common Controls v6 manifest and icon as the app.
    if std::env::var("TARGET").is_ok_and(|target| target.contains("windows-msvc")) {
        let resource =
            std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap()).join("resource.lib");
        println!(
            "cargo:rustc-link-arg-examples={}",
            resource.display()
        );
    }
}
