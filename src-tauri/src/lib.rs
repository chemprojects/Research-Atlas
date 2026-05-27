mod launcher;

use std::path::PathBuf;
use std::process::Child;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use launcher::{
    app_data_dir, ensure_app_data_dirs, has_bundled_python, launcher_log_path, log_line,
    python_ready, spawn_backend_process, LauncherState,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, RunEvent, State, WindowEvent,
};

const REQUIRED_BACKEND_API_VERSION: u64 = 2;

#[derive(Clone)]
struct BackendProcess(Arc<Mutex<Option<Child>>>);

#[derive(serde::Deserialize)]
struct InstallModelRequest {
    name: String,
    role: String,
}

#[derive(serde::Deserialize)]
struct BackendHealth {
    status: Option<String>,
    app: Option<String>,
    backend_api_version: Option<u64>,
}

enum BackendProbe {
    Compatible,
    Incompatible(String),
    NotRunning,
}

async fn probe_backend() -> Result<BackendProbe, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = match client.get("http://127.0.0.1:8765/api/health").send().await {
        Ok(resp) => resp,
        Err(_) => return Ok(BackendProbe::NotRunning),
    };

    if !resp.status().is_success() {
        return Ok(BackendProbe::Incompatible(format!(
            "health returned HTTP {}",
            resp.status().as_u16()
        )));
    }

    let text = resp.text().await.map_err(|e| e.to_string())?;
    let health = match serde_json::from_str::<BackendHealth>(&text) {
        Ok(health) => health,
        Err(_) => {
            return Ok(BackendProbe::Incompatible(
                "health response was not Research Atlas JSON".into(),
            ));
        }
    };

    if health.status.as_deref() != Some("ok") {
        return Ok(BackendProbe::Incompatible(
            "health status was not ok".into(),
        ));
    }
    if health.app.as_deref() != Some("research_atlas") {
        return Ok(BackendProbe::Incompatible(
            "health response came from an older or unknown backend".into(),
        ));
    }
    let version = health.backend_api_version.unwrap_or(0);
    if version < REQUIRED_BACKEND_API_VERSION {
        return Ok(BackendProbe::Incompatible(format!(
            "backend API version {version} is older than required {REQUIRED_BACKEND_API_VERSION}"
        )));
    }

    Ok(BackendProbe::Compatible)
}

async fn shutdown_running_backend(reason: &str) {
    log_line(&format!("Stopping incompatible backend: {reason}"));
    let _ = reqwest::Client::new()
        .post("http://127.0.0.1:8765/api/system/shutdown")
        .timeout(Duration::from_secs(2))
        .send()
        .await;
    for _ in 0..20 {
        if matches!(probe_backend().await, Ok(BackendProbe::NotRunning)) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

fn resolve_backend_dir(app: &tauri::AppHandle) -> PathBuf {
    let resource = app.path().resource_dir().ok().map(|r| r.join("backend"));
    if let Some(ref p) = resource {
        if p.join("main.py").exists() {
            return p.clone();
        }
    }

    let candidates = vec![
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../backend"),
        PathBuf::from("backend"),
        PathBuf::from("../backend"),
    ];
    for c in candidates {
        if c.join("main.py").exists() {
            return c.canonicalize().unwrap_or(c);
        }
    }
    PathBuf::from("backend")
}

fn stop_backend_internal(state: &BackendProcess) -> Result<(), String> {
    let mut guard = state.0.lock().unwrap();
    if let Some(mut child) = guard.take() {
        child
            .kill()
            .map_err(|e| format!("Failed to kill backend: {e}"))?;
    }
    Ok(())
}

async fn try_start_backend(
    app: &tauri::AppHandle,
    state: &BackendProcess,
    launcher: &LauncherState,
) -> Result<(), String> {
    match probe_backend().await? {
        BackendProbe::Compatible => {
            launcher.set_phase("ready", "Backend is running.");
            return Ok(());
        }
        BackendProbe::Incompatible(reason) => {
            launcher.set_phase("starting", "Refreshing backend…");
            shutdown_running_backend(&reason).await;
        }
        BackendProbe::NotRunning => {}
    }

    let _ = ensure_app_data_dirs();
    log_line("Starting backend launcher…");

    let backend_dir = resolve_backend_dir(app);
    if !backend_dir.join("main.py").exists() {
        let err = format!(
            "Backend not found at {}. Reinstall Research Atlas.",
            backend_dir.display()
        );
        launcher.set_error("error", "Backend files missing in app bundle.", err.clone());
        return Err(err);
    }

    match spawn_backend_process(app, &backend_dir, launcher) {
        Ok(child) => {
            let mut guard = state.0.lock().unwrap();
            *guard = Some(child);
            log_line("Backend process spawned.");
            Ok(())
        }
        Err(e) => {
            launcher.set_error(
                "error",
                "Could not start the backend. Install Python 3.10+ and try Retry.",
                e.clone(),
            );
            Err(e)
        }
    }
}

#[tauri::command]
async fn start_backend(
    app: tauri::AppHandle,
    state: State<'_, BackendProcess>,
    launcher: State<'_, LauncherState>,
) -> Result<String, String> {
    let bundled = has_bundled_python(&app);
    let first_install = !bundled && !python_ready(&app);
    try_start_backend(&app, &state, &launcher).await?;
    if finish_backend_startup(&app, &launcher, first_install, bundled).await {
        Ok("Backend started on port 8765".to_string())
    } else if !python_ready(&app) {
        Ok("Setup in progress".to_string())
    } else {
        Err("Backend not responding yet. Try again in a moment.".to_string())
    }
}

#[tauri::command]
async fn stop_backend(state: State<'_, BackendProcess>) -> Result<String, String> {
    let _ = reqwest::Client::new()
        .post("http://127.0.0.1:8765/api/system/shutdown")
        .timeout(Duration::from_secs(2))
        .send()
        .await;
    std::thread::sleep(Duration::from_millis(400));
    stop_backend_internal(&state)?;
    Ok("Backend stopped".to_string())
}

#[tauri::command]
async fn get_backend_status() -> Result<bool, String> {
    Ok(matches!(probe_backend().await?, BackendProbe::Compatible))
}

fn parse_install_response(text: &str) -> Result<serde_json::Value, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("Backend returned an empty response.".into());
    }

    if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
        return Ok(value);
    }

    let mut last_event: Option<serde_json::Value> = None;
    for line in trimmed.lines() {
        let line = line.trim();
        let Some(payload) = line.strip_prefix("data:") else {
            continue;
        };
        let payload = payload.trim();
        if payload.is_empty() {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(payload) {
            if value.get("status").and_then(|s| s.as_str()) != Some("done") {
                last_event = Some(value);
            }
        }
    }

    if let Some(value) = last_event {
        return Ok(value);
    }

    Err(format!(
        "Invalid backend response. First bytes: {}",
        trimmed.chars().take(300).collect::<String>()
    ))
}

#[tauri::command]
async fn install_model_via_backend(
    request: InstallModelRequest,
) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(1_800))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post("http://127.0.0.1:8765/api/models/install")
        .json(&serde_json::json!({
            "name": request.name,
            "role": request.role,
            "stream": false,
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!(
            "Backend error ({}): {}",
            status.as_u16(),
            if text.trim().is_empty() {
                status.to_string()
            } else {
                text
            }
        ));
    }

    parse_install_response(&text)
}

#[tauri::command]
async fn start_ollama_via_backend() -> Result<serde_json::Value, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post("http://127.0.0.1:8765/api/system/start-ollama")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!(
            "Backend error ({}): {}",
            status.as_u16(),
            if text.trim().is_empty() {
                status.to_string()
            } else {
                text
            }
        ));
    }

    serde_json::from_str(&text).map_err(|e| {
        format!(
            "Invalid backend response: {e}. First bytes: {}",
            text.trim().chars().take(300).collect::<String>()
        )
    })
}

#[tauri::command]
async fn get_launcher_status(
    app: tauri::AppHandle,
    launcher: State<'_, LauncherState>,
) -> Result<launcher::LauncherStatus, String> {
    let running = get_backend_status().await?;
    let bundled = has_bundled_python(&app);
    let ready = python_ready(&app);
    if running {
        launcher.clear_error();
        launcher.set_phase("ready", "Research Atlas is ready.");
    } else if bundled || !ready {
        launcher.clear_error();
    }
    Ok(launcher.snapshot(
        running,
        &app_data_dir(),
        ready,
        bundled,
        &launcher_log_path(),
    ))
}

#[tauri::command]
async fn quit_app(app: tauri::AppHandle, state: State<'_, BackendProcess>) -> Result<(), String> {
    let _ = stop_backend(state).await;
    app.exit(0);
    Ok(())
}

#[tauri::command]
async fn remove_application(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "macos")]
    {
        let helper = format!(
            r#"#!/bin/bash
sleep 2
APP="/Applications/Research Atlas.app"
if [ -d "$APP" ]; then
  osascript -e "tell application \"Finder\" to delete POSIX file \"$APP\"" || rm -rf "$APP"
fi
"#,
        );
        let tmp = std::env::temp_dir().join("research_atlas_remove_app.sh");
        std::fs::write(&tmp, helper).map_err(|e| e.to_string())?;
        std::process::Command::new("chmod")
            .args(["+x", tmp.to_str().unwrap()])
            .spawn()
            .map_err(|e| e.to_string())?;
        std::process::Command::new("nohup")
            .arg(&tmp)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| e.to_string())?;
        app.exit(0);
        return Ok(serde_json::json!({
            "ok": true,
            "message": "Research Atlas will move to the Trash. If it remains in Applications, drag it to Trash manually."
        }));
    }

    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("cmd")
            .args(["/C", "start", "ms-settings:appsfeatures"])
            .spawn();
        return Ok(serde_json::json!({
            "ok": true,
            "message": "Opened Windows Apps settings. Uninstall Research Atlas there after removing your data."
        }));
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Ok(serde_json::json!({
            "ok": false,
            "message": "Remove the application folder manually from your package manager or install location."
        }))
    }
}

#[tauri::command]
async fn open_file(path: String) -> Result<(), String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("path is empty".into());
    }
    let p = std::path::Path::new(path);
    if !p.is_file() {
        return Err(format!("File not found: {path}"));
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "", path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = path;
        return Err("open_file is not supported on this platform".into());
    }
    Ok(())
}

#[tauri::command]
async fn open_folder(path: String) -> Result<(), String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("path is empty".into());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn open_external_url(url: String) -> Result<(), String> {
    let url = url.trim();
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Only http(s) URLs can be opened externally.".into());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "", url])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = url;
        return Err("open_external_url is not supported on this platform".into());
    }
    Ok(())
}

#[tauri::command]
async fn get_app_data_dir() -> Result<String, String> {
    ensure_app_data_dirs()?;
    Ok(app_data_dir().to_string_lossy().into())
}

async fn wait_for_backend(
    max_secs: u64,
    app: &tauri::AppHandle,
    launcher: &LauncherState,
    bundled: bool,
) -> bool {
    for i in 0..max_secs {
        if get_backend_status().await.unwrap_or(false) {
            launcher.clear_error();
            launcher.set_phase("ready", "Research Atlas is ready.");
            return true;
        }
        if !bundled && i > 0 && i % 8 == 0 {
            let msg = if !python_ready(app) {
                "Installing Python packages — please keep Research Atlas open…"
            } else {
                "Starting the research engine…"
            };
            let phase = if !python_ready(app) {
                "bootstrapping"
            } else {
                "starting"
            };
            launcher.set_phase(phase, msg);
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    false
}

async fn finish_backend_startup(
    app: &tauri::AppHandle,
    launcher: &LauncherState,
    first_install: bool,
    bundled: bool,
) -> bool {
    let max_secs = if bundled {
        45
    } else if first_install {
        300
    } else {
        90
    };
    if wait_for_backend(max_secs, app, launcher, bundled).await {
        return true;
    }

    if !python_ready(app) {
        launcher.clear_error();
        launcher.set_phase(
            "bootstrapping",
            "Still installing dependencies — first setup can take 15–25 minutes. Keep this window open.",
        );
        log_line("Health check waiting: Python runtime not ready yet.");
        return false;
    }

    launcher.set_error(
        "error",
        "Engine is still warming up.",
        "Tap Try again in a moment, or check ~/.research_atlas/logs/backend.log".into(),
    );
    log_line(&format!(
        "Backend health check timed out after {}s (first_install={}, bundled={}).",
        max_secs, first_install, bundled
    ));
    false
}

async fn auto_start_backend(
    handle: tauri::AppHandle,
    state: BackendProcess,
    launcher: LauncherState,
) {
    let _ = ensure_app_data_dirs();
    log_line("Research Atlas launched.");

    if get_backend_status().await.unwrap_or(false) {
        launcher.set_phase("ready", "Backend is running.");
        return;
    }

    launcher.set_phase("starting", "Preparing backend…");

    let bundled = has_bundled_python(&handle);
    let first_install = !bundled && !python_ready(&handle);

    if bundled {
        launcher.set_phase("starting", "Starting Research Atlas…");
    }

    if let Err(e) = try_start_backend(&handle, &state, &launcher).await {
        log_line(&format!("Auto-start failed: {e}"));
        return;
    }

    if finish_backend_startup(&handle, &launcher, first_install, bundled).await {
        log_line("Backend health check OK.");
    }
}

pub fn run() {
    let backend_state = BackendProcess(Arc::new(Mutex::new(None)));
    let launcher_state = LauncherState::new();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .manage(backend_state.clone())
        .manage(launcher_state.clone())
        .setup(move |app| {
            let open_item =
                MenuItem::with_id(app, "open", "Open Research Atlas", true, None::<&str>)?;
            let scan_item = MenuItem::with_id(app, "scan", "Run Scan Now", true, None::<&str>)?;
            let quit_item =
                MenuItem::with_id(app, "quit", "Quit Research Atlas", true, None::<&str>)?;

            let menu = Menu::with_items(app, &[&open_item, &scan_item, &quit_item])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event({
                    let state = backend_state.clone();
                    move |app, event| match event.id.as_ref() {
                        "open" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "scan" => {
                            std::thread::spawn(|| {
                                let _ = reqwest::blocking::Client::new()
                                    .post("http://127.0.0.1:8765/api/system/scan")
                                    .send();
                            });
                        }
                        "quit" => {
                            let _ = stop_backend_internal(&state);
                            app.exit(0);
                        }
                        _ => {}
                    }
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
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            if let Some(window) = app.get_webview_window("main") {
                let state = backend_state.clone();
                let app_handle = window.app_handle().clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = stop_backend_internal(&state);
                        app_handle.exit(0);
                    }
                });
            }

            let handle = app.handle().clone();
            let state = backend_state.clone();
            let launcher = launcher_state.clone();
            tauri::async_runtime::spawn(auto_start_backend(handle, state, launcher));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_backend,
            stop_backend,
            get_backend_status,
            install_model_via_backend,
            start_ollama_via_backend,
            get_launcher_status,
            quit_app,
            remove_application,
            open_folder,
            open_file,
            open_external_url,
            get_app_data_dir,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::Exit = event {
            if let Some(state) = app_handle.try_state::<BackendProcess>() {
                let _ = stop_backend_internal(&state);
            }
        }
    });
}
