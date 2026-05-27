# Full Windows release build with pre-bundled Python.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/build-release-windows.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/build-release-windows.ps1 x64

param(
    [string]$Arch = "x64"
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

switch ($Arch.ToLower()) {
    "x64"     { $TauriTarget = "x86_64-pc-windows-msvc" }
    "x86_64"  { $TauriTarget = "x86_64-pc-windows-msvc" }
    "amd64"   { $TauriTarget = "x86_64-pc-windows-msvc" }
    "arm64"   { $TauriTarget = "aarch64-pc-windows-msvc" }
    "aarch64" { $TauriTarget = "aarch64-pc-windows-msvc" }
    default {
        Write-Error "Unknown arch: $Arch. Use x64 or arm64."
        exit 1
    }
}

Write-Host "=== Windows Tauri target: $TauriTarget ==="

Write-Host "=== 1/3 Bundled Python ==="
if (Test-Path "$Root\scripts\build-bundled-python-windows.ps1") {
    powershell -ExecutionPolicy Bypass -File "$Root\scripts\build-bundled-python-windows.ps1" $Arch
}
elseif (Test-Path "$Root\scripts\build-bundled-python.sh") {
    Write-Warning "No Windows bundled-Python script found. Attempting existing shell script via bash."
    bash "$Root/scripts/build-bundled-python.sh" $Arch
}
else {
    Write-Error "Missing bundled Python script. Expected scripts/build-bundled-python-windows.ps1 or scripts/build-bundled-python.sh"
    exit 1
}

Write-Host "=== 2/3 Frontend ==="
npm run build --prefix frontend

Write-Host "=== Rust target ==="
rustup target add $TauriTarget

Write-Host "=== 3/3 Tauri ($TauriTarget) ==="
Set-Location "$Root\src-tauri"
cargo tauri build --target $TauriTarget

Write-Host ""
Write-Host "Done. Windows bundles should be in:"
Write-Host "  src-tauri\target\$TauriTarget\release\bundle\"
