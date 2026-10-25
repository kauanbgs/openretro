fn main() {
    // RPCS3 asks for ordinal 100 (XInputGetStateEx, which has the Guide
    // button) before the named export; only a .def file exports ordinals.
    let def = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("exports.def");
    println!("cargo:rerun-if-changed={}", def.display());
    println!("cargo:rustc-cdylib-link-arg=/DEF:{}", def.display());
}
