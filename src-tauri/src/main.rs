// Prevents console window on Windows in both debug and release builds.
#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

fn main() {
    app_lib::run();
}
