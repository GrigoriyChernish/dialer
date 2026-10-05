#[cfg(desktop)]
use tauri::Manager;

#[tauri::command]
fn focus_window(_app: tauri::AppHandle, window: tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    let _ = _app.set_activation_policy(tauri::ActivationPolicy::Regular);

    #[cfg(desktop)]
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    #[cfg(desktop)]
    let _ = window.request_user_attention(Some(tauri::UserAttentionType::Critical));
}

#[cfg(desktop)]
fn show_main_window(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg(desktop)]
fn hide_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![focus_window]);

    #[cfg(desktop)]
    {
        builder = builder
            .on_window_event(|window, event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    // Замість виходу ховаємо вікно і прибираємо з Dock (залишається лише в треї)
                    hide_main_window(window.app_handle());
                    api.prevent_close();
                }
            })
            .setup(|app| {
                use tauri::{
                    menu::{Menu, MenuItem},
                    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
                    Manager,
                };

                let show_i = MenuItem::with_id(app, "show", "Показати Dialer Dev", true, None::<&str>)?;
                let quit_i = MenuItem::with_id(app, "quit", "Вийти з Dialer Dev", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

                let mut tray = TrayIconBuilder::new()
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => {
                            show_main_window(app);
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                if window.is_visible().unwrap_or(false) {
                                    hide_main_window(app);
                                } else {
                                    show_main_window(app);
                                }
                            }
                        }
                    });

                if let Some(icon) = app.default_window_icon() {
                    tray = tray.icon(icon.clone());
                }

                let _ = tray.build(app)?;

                Ok(())
            });
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
