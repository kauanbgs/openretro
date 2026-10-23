# Runtime handle thread safety

Based on the published tauri-runtime-wry 2.12.2 crate, with its original licenses.

`Context` is marked `Send + Sync` and is cloned by AppHandle and window dispatchers
on background threads. Its derived Clone previously cloned
`DispatcherMainThreadContext.window_target`, which contains Tao's
`Rc<EventLoopRunner>`. Concurrent clones and drops raced on that non-atomic count,
causing heap corruption and `RcInnerPtr::inc_strong` precondition aborts.

This patch stores DispatcherMainThreadContext in an Arc. Context clones therefore
only increment an atomic count. Access to its contents remains guarded by the
existing main-thread checks. The runtime owns a reference throughout its event
loop lifetime. No unsafe implementations or cross-thread access rules are added.

Reproduce/verify on Windows with `cargo run --manifest-path src-tauri/Cargo.toml --example runtime_thread_stress`.
The test clones and drops a real runtime handle 800,000 times across eight workers.
The unpatched crate aborts with the same rc.rs assert_unchecked panic as Party.

Remove this patch only after an upstream runtime version fixes the same ownership
issue and passes the stress test. Do not suppress Rust UB checks to hide it.
