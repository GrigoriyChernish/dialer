//! Вхідний дзвінок на десктопі: міні-вікно поверх усіх вікон і системна мелодія по колу.
//! Веб-застосунок керує ними командами (`show_incoming`, `hide_incoming`, `start_ringtone`, `stop_ringtone`), а дії користувача
//! (`incoming_action`) повертає в основне вікно тією ж подією `callstyle`, що й Android (`apps/web/src/shared/native/callstyle.ts`).

#[cfg(target_os = "macos")]
use std::process::Command;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindowBuilder};

const WINDOW: &str = "incoming";
const WIDTH: f64 = 392.0;
const HEIGHT: f64 = 148.0;
/// Мелодія не звучить довше за таймаут дзвінка, навіть якщо веб-застосунок не встиг її зупинити.
const RING_MAX: Duration = Duration::from_secs(60);

#[derive(Default)]
pub struct Incoming {
    /// Дзвінок, для якого відкрито міні-вікно (застарілий таймер не закриє вікно нового дзвінка).
    call: Mutex<Option<String>>,
    /// Прапорець зупинки поточної мелодії.
    ring: Mutex<Option<Arc<AtomicBool>>>,
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Кодує значення для query (лишає лише букви, цифри й `-._~`).
fn encode(value: &str) -> String {
    value
        .bytes()
        .map(|b| match b {
            b'0'..=b'9' | b'a'..=b'z' | b'A'..=b'Z' | b'-' | b'.' | b'_' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// Системна мелодія по колу: на macOS `afplay` із системним звуком, на інших платформах поки без звуку.
fn start_ring(state: &Incoming) {
    stop_ring(state);
    let stop = Arc::new(AtomicBool::new(false));
    *state.ring.lock().unwrap() = Some(stop.clone());
    thread::spawn(move || {
        let started = std::time::Instant::now();
        while !stop.load(Ordering::Relaxed) && started.elapsed() < RING_MAX {
            #[cfg(target_os = "macos")]
            if let Ok(mut child) = Command::new("afplay").arg("/System/Library/Sounds/Submarine.aiff").spawn() {
                loop {
                    match child.try_wait() {
                        Ok(Some(_)) | Err(_) => break,
                        Ok(None) if stop.load(Ordering::Relaxed) => {
                            let _ = child.kill();
                            break;
                        }
                        Ok(None) => thread::sleep(Duration::from_millis(50)),
                    }
                }
            }
            // інші платформи: мелодії ще немає (беклог), лише пауза між «повторами»
            #[cfg(not(target_os = "macos"))]
            thread::sleep(Duration::from_millis(500));
            // пауза між повторами
            for _ in 0..16 {
                if stop.load(Ordering::Relaxed) {
                    return;
                }
                thread::sleep(Duration::from_millis(50));
            }
        }
    });
}

fn stop_ring(state: &Incoming) {
    if let Some(stop) = state.ring.lock().unwrap().take() {
        stop.store(true, Ordering::Relaxed);
    }
}

fn close_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(WINDOW) {
        let _ = w.destroy();
    }
}

/// Закриває міні-вікно й зупиняє мелодію, якщо вони належать `call_id` (порожній: будь-якому дзвінку).
fn hide(app: &AppHandle, state: &Incoming, call_id: &str) {
    let mut call = state.call.lock().unwrap();
    if !call_id.is_empty() && call.as_deref() != Some(call_id) {
        return;
    }
    *call = None;
    drop(call);
    close_window(app);
    stop_ring(state);
}

#[tauri::command]
pub fn show_incoming(
    app: AppHandle,
    state: State<'_, Incoming>,
    call_id: String,
    name: String,
    expires_at: u64,
) -> Result<(), String> {
    close_window(&app);
    *state.call.lock().unwrap() = Some(call_id.clone());
    let url = format!("incoming.html?callId={}&name={}&expiresAt={expires_at}", encode(&call_id), encode(&name));
    let mut builder = WebviewWindowBuilder::new(&app, WINDOW, WebviewUrl::App(url.into()))
        .title("Вхідний дзвінок")
        .inner_size(WIDTH, HEIGHT)
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .focused(false)
        // macOS: перший клік по вікну без фокусу одразу натискає кнопку, а не лише активує вікно
        .accept_first_mouse(true);
    // правий верхній кут основного монітора
    if let Ok(Some(monitor)) = app.primary_monitor() {
        let scale = monitor.scale_factor();
        let x = monitor.position().x as f64 / scale + monitor.size().width as f64 / scale - WIDTH - 16.0;
        let y = monitor.position().y as f64 / scale + 44.0;
        builder = builder.position(x, y);
    }
    builder.build().map_err(|e| e.to_string())?;
    start_ring(&state);

    // дзвінок скінчився без нас (скасовано чи таймаут): вікно закриваємо само
    let handle = app.clone();
    thread::spawn(move || {
        let left = expires_at.saturating_sub(now_ms()).clamp(1_000, 120_000);
        thread::sleep(Duration::from_millis(left));
        hide(&handle, &handle.state::<Incoming>(), &call_id);
    });
    Ok(())
}

#[tauri::command]
pub fn hide_incoming(app: AppHandle, state: State<'_, Incoming>, call_id: String) {
    hide(&app, &state, &call_id);
}

#[tauri::command]
pub fn start_ringtone(state: State<'_, Incoming>) {
    start_ring(&state);
}

#[tauri::command]
pub fn stop_ringtone(state: State<'_, Incoming>) {
    stop_ring(&state);
}

/// Кнопка в міні-вікні: закриває його й передає вибір («answer» чи «decline») основному вікну.
#[tauri::command]
pub fn incoming_action(app: AppHandle, state: State<'_, Incoming>, kind: String, call_id: String) {
    hide(&app, &state, &call_id);
    if kind == "answer" {
        crate::show_main_window(&app);
    }
    if let Some(main) = app.get_webview_window("main") {
        let detail = serde_json::json!({ "type": kind, "callId": call_id });
        let _ = main.eval(&format!("window.dispatchEvent(new CustomEvent('callstyle',{{detail:{detail}}}))"));
    }
}
