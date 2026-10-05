use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

/// Реєструє Kotlin-плагін `CallStylePlugin` (лише Android); на інших платформах нічого не робить.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("callstyle")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _api.register_android_plugin("com.dialer.callstyle", "CallStylePlugin")?;
            Ok(())
        })
        .build()
}
