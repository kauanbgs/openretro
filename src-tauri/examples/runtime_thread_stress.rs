//! Exercises concurrent runtime-handle clones with a real Windows event loop.
//! Run with: cargo run --manifest-path src-tauri/Cargo.toml --example runtime_thread_stress
fn main() {
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    tauri::Builder::default()
        .setup(|app| {
            let handle = std::sync::Arc::new(app.handle().clone());
            std::thread::spawn(move || {
                let barrier = std::sync::Barrier::new(8);
                std::thread::scope(|scope| {
                    for _ in 0..8 {
                        let handle = &handle;
                        let barrier = &barrier;
                        scope.spawn(move || {
                            barrier.wait();
                            for _ in 0..100_000 {
                                std::hint::black_box(handle.as_ref().clone());
                            }
                        });
                    }
                });
                eprintln!("Runtime handle stress: 800000 clones completed");
                handle.exit(0);
            });
            Ok(())
        })
        .run(context)
        .expect("runtime stress app");
}
