use std::collections::HashSet;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use tauri::Manager;

/// Windows creation flag that detaches process from console without interfering with DLL loading.
#[cfg(target_os = "windows")]
const DETACHED_PROCESS: u32 = 0x00000008;

/// Suppress console window creation on Windows. No-op on other platforms.
fn no_console(cmd: &mut Command) -> &mut Command {
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(DETACHED_PROCESS);
    }
    cmd
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub struct LauncherStatus {
    pub backend_running: bool,
    pub phase: String,
    pub message: String,
    pub error: Option<String>,
    pub log_path: String,
    pub app_data_dir: String,
    pub venv_ready: bool,
    /// True when the app ships with a pre-built Python runtime (no pip on first launch).
    pub bundled_python: bool,
}

#[derive(Clone)]
pub struct LauncherState(Arc<Mutex<Inner>>);

struct Inner {
    phase: String,
    message: String,
    error: Option<String>,
}

impl Default for Inner {
    fn default() -> Self {
        Self {
            phase: "idle".into(),
            message: "Waiting to start backend…".into(),
            error: None,
        }
    }
}

impl LauncherState {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(Inner::default())))
    }

    fn set(&self, phase: &str, message: &str, error: Option<String>) {
        let mut g = self.0.lock().unwrap();
        g.phase = phase.into();
        g.message = message.into();
        g.error = error;
    }

    pub fn set_phase(&self, phase: &str, message: &str) {
        self.set(phase, message, None);
    }

    pub fn set_error(&self, phase: &str, message: &str, err: String) {
        log_line(&format!("ERROR [{phase}]: {err}"));
        self.set(phase, message, Some(err));
    }

    pub fn clear_error(&self) {
        let mut g = self.0.lock().unwrap();
        g.error = None;
        if g.phase == "error" {
            g.phase = "bootstrapping".into();
        }
    }

    pub fn touch_bootstrapping_message(&self, message: &str) {
        let mut g = self.0.lock().unwrap();
        if g.phase == "bootstrapping" || g.phase == "error" || g.phase == "idle" {
            g.phase = "bootstrapping".into();
            g.message = message.into();
            g.error = None;
        }
    }

    pub fn snapshot(
        &self,
        backend_running: bool,
        app_data_dir: &Path,
        venv_ready: bool,
        bundled_python: bool,
        log_path: &Path,
    ) -> LauncherStatus {
        let g = self.0.lock().unwrap();
        LauncherStatus {
            backend_running,
            phase: g.phase.clone(),
            message: g.message.clone(),
            error: g.error.clone(),
            log_path: log_path.to_string_lossy().into(),
            app_data_dir: app_data_dir.to_string_lossy().into(),
            venv_ready,
            bundled_python,
        }
    }
}

/// Root of a python-build-standalone tree when `exe` is `.../python/bin/python3`.
fn bundled_python_home(exe: &Path) -> Option<PathBuf> {
    let bin = exe.parent()?;
    if bin.file_name().and_then(|n| n.to_str()) != Some("bin") {
        return None;
    }
    let home = bin.parent()?;
    if home.join("lib").is_dir() {
        Some(home.to_path_buf())
    } else {
        None
    }
}

fn apply_python_env(cmd: &mut Command, exe: &Path) {
    // Prevent Conda/Homebrew site-packages from leaking into the app runtime.
    cmd.env_remove("PYTHONPATH");
    cmd.env_remove("VIRTUAL_ENV");
    cmd.env_remove("CONDA_PREFIX");
    cmd.env_remove("CONDA_DEFAULT_ENV");
    if let Some(home) = bundled_python_home(exe) {
        cmd.env("PYTHONHOME", &home);
        cmd.env("PYTHONNOUSERSITE", "1");
        let bin = home.join("bin");
        if bin.is_dir() {
            let sep = if cfg!(target_os = "windows") {
                ";"
            } else {
                ":"
            };
            let path = std::env::var("PATH").unwrap_or_default();
            cmd.env("PATH", format!("{}{}{}", bin.display(), sep, path));
        }
    } else {
        cmd.env("PYTHONNOUSERSITE", "1");
    }
}

fn python_bin_candidates() -> [&'static str; 3] {
    if cfg!(target_os = "windows") {
        ["python.exe", "python3.exe", "python3.12.exe"]
    } else {
        ["python3", "python3.12", "python"]
    }
}

fn bundled_python_from_dir(root: &Path) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        for name in ["python.exe", "python3.exe", "python3.11.exe", "python3.12.exe"] {
            let p = root.join(name);
            if p.is_file() {
                return Some(p);
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        for name in ["python3", "python3.12", "python"] {
            let p = root.join("bin").join(name);
            if p.is_file() {
                return Some(p);
            }
        }
    }

    None
}

/// Pre-built runtime inside the .app Resources, or `src-tauri/bundled/python` during dev.
pub fn bundled_python_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Ok(resource) = app.path().resource_dir() {
        let p = resource.join("python");
        if let Some(exe) = bundled_python_from_dir(&p) {
            return Some(exe);
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bundled/python");
    bundled_python_from_dir(&dev)
}

pub fn has_bundled_python(app: &tauri::AppHandle) -> bool {
    bundled_python_path(app).is_some()
}

fn verify_python_imports(exe: &Path, modules: &str) -> bool {
    let mut cmd = Command::new(exe);
    apply_python_env(&mut cmd, exe);
    cmd.args(["-c", &format!("import {modules}")])
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    no_console(&mut cmd);
    cmd.status()
        .map(|s| s.success())
        .unwrap_or(false)
}

pub fn resolve_python_exe(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Some(bundled) = bundled_python_path(app) {
        if verify_python_imports(&bundled, "fastapi, uvicorn") {
            return Some(bundled);
        }
    }
    let user = venv_python();
    if user.is_file() && verify_python_imports(&user, "fastapi, uvicorn") {
        return Some(user);
    }
    None
}

pub fn python_ready(app: &tauri::AppHandle) -> bool {
    resolve_python_exe(app).is_some()
}

pub fn home_dir() -> PathBuf {
    dirs_next::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

pub fn app_data_dir() -> PathBuf {
    home_dir().join(".research_atlas")
}

pub fn logs_dir() -> PathBuf {
    app_data_dir().join("logs")
}

pub fn launcher_log_path() -> PathBuf {
    logs_dir().join("launcher.log")
}

pub fn backend_log_path() -> PathBuf {
    logs_dir().join("backend.log")
}

pub fn venv_python() -> PathBuf {
    if cfg!(target_os = "windows") {
        app_data_dir()
            .join("venv")
            .join("Scripts")
            .join("python.exe")
    } else {
        app_data_dir().join("venv").join("bin").join("python")
    }
}

pub fn ensure_app_data_dirs() -> Result<(), String> {
    let data = app_data_dir();
    std::fs::create_dir_all(logs_dir()).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(data.join("chats")).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(data.join("vectors")).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(data.join("pdfs")).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(data.join("models")).map_err(|e| e.to_string())?;
    Ok(())
}

/// Extra directories that may contain python3 (Conda, Homebrew, pyenv, python.org).
fn python_search_bin_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();

    #[cfg(target_os = "macos")]
    {
        dirs.push(PathBuf::from("/opt/homebrew/bin"));
        dirs.push(PathBuf::from("/usr/local/bin"));
    }

    #[cfg(target_os = "linux")]
    {
        dirs.push(PathBuf::from("/usr/local/bin"));
    }

    let home = home_dir();
    for rel in [
        "miniconda3/bin",
        "anaconda3/bin",
        "miniforge3/bin",
        "mambaforge/bin",
        "micromamba/bin",
        "opt/miniconda3/bin",
        "opt/anaconda3/bin",
        "pyenv/shims",
        ".pyenv/shims",
        ".local/bin",
    ] {
        dirs.push(home.join(rel));
    }

    for ver in ["3.12", "3.11", "3.10"] {
        dirs.push(home.join(format!(
            "Library/Frameworks/Python.framework/Versions/{ver}/bin"
        )));
    }

    if let Ok(cp) = std::env::var("CONDA_PREFIX") {
        dirs.push(PathBuf::from(cp).join("bin"));
    }
    if let Ok(root) = std::env::var("CONDA_EXE") {
        if let Some(bin) = PathBuf::from(root).parent() {
            dirs.push(bin.to_path_buf());
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            for ver in ["Python312", "Python311", "Python310"] {
                dirs.push(
                    PathBuf::from(&local)
                        .join("Programs")
                        .join("Python")
                        .join(ver),
                );
            }
        }
        if let Ok(userprofile) = std::env::var("USERPROFILE") {
            for name in ["miniconda3", "anaconda3", "miniforge3"] {
                dirs.push(PathBuf::from(&userprofile).join(name).join("Scripts"));
            }
        }
    }

    dirs
}

fn enriched_path() -> String {
    let mut parts: Vec<String> = Vec::new();
    for d in python_search_bin_dirs() {
        parts.push(d.to_string_lossy().into_owned());
    }
    if let Ok(p) = std::env::var("PATH") {
        parts.push(p);
    }
    parts.push("/usr/bin".into());
    parts.push("/bin".into());
    parts.join(if cfg!(target_os = "windows") {
        ";"
    } else {
        ":"
    })
}

pub fn log_line(msg: &str) {
    let _ = (|| -> std::io::Result<()> {
        let _ = ensure_app_data_dirs();
        let mut f = OpenOptions::new()
            .create(true)
            .append(true)
            .open(launcher_log_path())?;
        let ts = chrono_lite_timestamp();
        writeln!(f, "[{ts}] {msg}")?;
        Ok(())
    })();
}

fn chrono_lite_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}

fn which_in_path(cmd: &str) -> Option<PathBuf> {
    let path_env = enriched_path();
    let mut c = Command::new(if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    });
    c.arg(cmd).env("PATH", &path_env);
    no_console(&mut c);
    let output = c.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let line = String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()?
        .trim()
        .to_string();
    if line.is_empty() {
        None
    } else {
        Some(PathBuf::from(line))
    }
}

fn python_candidates() -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    let py_names = if cfg!(target_os = "windows") {
        vec![
            "python.exe",
            "python3.exe",
            "python3.12.exe",
            "python3.11.exe",
        ]
    } else {
        vec![
            "python3.12",
            "python3.11",
            "python3.10",
            "python3",
            "python",
        ]
    };

    for bin_dir in python_search_bin_dirs() {
        for name in &py_names {
            candidates.push(bin_dir.join(name));
        }
    }

    for name in &py_names {
        if let Some(p) = which_in_path(name) {
            candidates.push(p);
        }
    }

    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from("/opt/homebrew/bin/python3.12"));
        candidates.push(PathBuf::from("/opt/homebrew/bin/python3"));
        candidates.push(PathBuf::from("/usr/local/bin/python3.12"));
        candidates.push(PathBuf::from("/usr/local/bin/python3"));
    }

    #[cfg(target_os = "windows")]
    {
        candidates.push(PathBuf::from(r"C:\Python312\python.exe"));
        candidates.push(PathBuf::from(r"C:\Python311\python.exe"));
    }

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        // System Python last — often 3.9 on macOS and unsuitable.
        candidates.push(PathBuf::from("/usr/bin/python3"));
    }

    dedupe_candidate_paths(candidates)
}

fn dedupe_candidate_paths(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for p in paths {
        let key = p.canonicalize().unwrap_or_else(|_| p.clone());
        if seen.insert(key) {
            out.push(p);
        }
    }
    out
}

fn verify_python3(path: &Path) -> bool {
    let mut cmd = Command::new(path);
    cmd.args([
            "-c",
            "import sys; raise SystemExit(0 if sys.version_info[:2] >= (3, 10) else 1)",
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    no_console(&mut cmd);
    cmd.status()
        .map(|s| s.success())
        .unwrap_or(false)
}

pub fn find_system_python() -> Result<PathBuf, String> {
    let mut tried: Vec<String> = Vec::new();
    for path in python_candidates() {
        if !path.is_file() {
            continue;
        }
        tried.push(path.display().to_string());
        if verify_python3(&path) {
            log_line(&format!("Using Python at {}", path.display()));
            return Ok(path);
        }
    }
    let hint = if cfg!(target_os = "macos") {
        " Install Python 3.10+ via Homebrew (brew install python@3.12), python.org, or ensure Conda’s bin is on PATH."
    } else {
        " Install Python 3.10+ from https://www.python.org/downloads/"
    };
    Err(format!(
        "Python 3.10+ not found.{hint} Checked: {}",
        if tried.is_empty() {
            "no candidates".into()
        } else {
            tried.join(", ")
        }
    ))
}

fn apply_bootstrap_line(launcher: &LauncherState, line: &str) {
    let t = line.trim();
    if t.is_empty() {
        return;
    }
    if let Some(rest) = t.strip_prefix("PHASE:") {
        let mut parts = rest.splitn(2, ' ');
        let _tag = parts.next().unwrap_or("bootstrapping");
        let msg = parts.next().unwrap_or(rest).trim();
        if !msg.is_empty() {
            launcher.touch_bootstrapping_message(msg);
        }
        return;
    }
    if t.starts_with("PROGRESS:") {
        if let Some(msg) = t.strip_prefix("PROGRESS:") {
            let m = msg.trim();
            if !m.is_empty() && m.len() < 220 {
                launcher.touch_bootstrapping_message(m);
            }
        }
        return;
    }
    if t.len() < 220 && !t.starts_with("File \"") {
        launcher.touch_bootstrapping_message(t);
    }
}

fn pump_bootstrap_stream<R: std::io::BufRead>(launcher: &LauncherState, reader: R) {
    for line in std::io::BufRead::lines(reader) {
        if let Ok(line) = line {
            log_line(&format!("[bootstrap] {line}"));
            apply_bootstrap_line(launcher, &line);
        }
    }
}

pub fn bootstrap_venv(backend_dir: &Path, launcher: &LauncherState) -> Result<(), String> {
    launcher.clear_error();
    launcher.set_phase(
        "bootstrapping",
        "Preparing Python environment (first launch may take 15–25 minutes)…",
    );
    let py = find_system_python()?;
    log_line(&format!("Bootstrapping venv with {}", py.display()));

    let script = backend_dir.join("bootstrap_venv.py");
    if !script.is_file() {
        return Err(format!(
            "bootstrap_venv.py not found at {}. Reinstall Research Atlas.",
            script.display()
        ));
    }

    log_line(&format!("Running {}", script.display()));

    let backend_arg = backend_dir.to_string_lossy().into_owned();
    let mut cmd = Command::new(&py);
    cmd.current_dir(backend_dir)
        .env("PATH", enriched_path())
        .arg(&script)
        .arg("--backend-dir")
        .arg(&backend_arg)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    no_console(&mut cmd);
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to bootstrap venv: {e}"))?;

    let launcher_out = launcher.clone();
    if let Some(stdout) = child.stdout.take() {
        std::thread::spawn(move || {
            use std::io::BufReader;
            pump_bootstrap_stream(&launcher_out, BufReader::new(stdout));
        });
    }

    let launcher_err = launcher.clone();
    if let Some(stderr) = child.stderr.take() {
        std::thread::spawn(move || {
            use std::io::{BufRead, BufReader};
            for line in BufReader::new(stderr).lines().flatten() {
                log_line(&format!("[bootstrap:err] {line}"));
                apply_bootstrap_line(&launcher_err, &line);
            }
        });
    }

    let status = child
        .wait()
        .map_err(|e| format!("Failed while bootstrapping venv: {e}"))?;

    if !status.success() {
        return Err(
            "Could not finish setting up the Python environment. See ~/.research_atlas/logs/launcher.log"
                .into(),
        );
    }

    let user = venv_python();
    if !user.is_file() || !verify_python_imports(&user, "fastapi, uvicorn") {
        return Err(
            "Python environment was created but is not ready yet. Try again in a moment.".into(),
        );
    }

    log_line("Venv bootstrap completed.");
    launcher.set_phase(
        "bootstrapping",
        "Python environment ready — starting engine…",
    );
    Ok(())
}

pub fn spawn_backend_process(
    app: &tauri::AppHandle,
    backend_dir: &Path,
    launcher: &LauncherState,
) -> Result<Child, String> {
    let python = if let Some(exe) = resolve_python_exe(app) {
        exe
    } else {
        bootstrap_venv(backend_dir, launcher)?;
        resolve_python_exe(app).or_else(|| {
            let user = venv_python();
            if user.is_file() {
                Some(user)
            } else {
                None
            }
        }).ok_or_else(|| {
            "Python environment is not ready. Run scripts/build-bundled-python.sh for release builds."
                .to_string()
        })?
    };

    launcher.set_phase("starting", "Starting Research Atlas…");
    log_line(&format!("Spawning uvicorn via {}", python.display()));

    let log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(backend_log_path())
        .map_err(|e| e.to_string())?;

    let mut cmd = Command::new(&python);
    apply_python_env(&mut cmd, &python);
    cmd.current_dir(backend_dir)
        .env("PATH", enriched_path())
        .args([
            "-m",
            "uvicorn",
            "main:app",
            "--host",
            "127.0.0.1",
            "--port",
            "8765",
            "--log-level",
            "warning",
            "--no-access-log",
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::from(log_file));
    no_console(&mut cmd);

    cmd.spawn()
        .map_err(|e| format!("Failed to start backend: {e}"))
}
