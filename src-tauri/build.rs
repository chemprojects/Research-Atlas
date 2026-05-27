use std::path::Path;
use std::process::Command;

fn main() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let profile = std::env::var("PROFILE").unwrap_or_default();
    let bundled = Path::new("bundled/python/bin/python3");

    if target_os == "macos" {
        println!("cargo:rerun-if-changed=bundled/python/bin/python3");
        println!("cargo:rerun-if-changed=../backend/requirements.txt");
        println!("cargo:rerun-if-changed=../backend/requirements-core.txt");
        println!("cargo:rerun-if-changed=../backend/requirements-ml.txt");

        if profile == "release" && !bundled.is_file() {
            if std::env::var("RA_SKIP_BUNDLED_PYTHON").is_ok() {
                println!(
                    "cargo:warning=Release build without bundled/python — first launch will bootstrap via pip."
                );
            } else {
                println!("cargo:warning=Bundled Python missing at src-tauri/bundled/python");
                println!("cargo:warning=Run: bash scripts/build-bundled-python.sh");
                if std::env::var("RA_BUILD_BUNDLED_PYTHON").is_ok() {
                    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
                    let root = manifest.parent().unwrap();
                    let script = root.join("scripts/build-bundled-python.sh");
                    if script.is_file() {
                        let status = Command::new("bash").arg(&script).current_dir(root).status();
                        if !matches!(status, Ok(s) if s.success()) {
                            println!("cargo:warning=build-bundled-python.sh failed");
                        }
                    }
                }
            }
        }
    }

    tauri_build::build();
}
