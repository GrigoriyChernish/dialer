// Команд для JS немає: Kotlin-клас сам додає в WebView міст `window.DialerNative` (див. Bridge.kt).
fn main() {
    tauri_plugin::Builder::new(&[]).android_path("android").build();
}
