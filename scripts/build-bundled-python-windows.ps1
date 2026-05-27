# Build a bundled Python runtime for Windows using NuGet.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/build-bundled-python-windows.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/build-bundled-python-windows.ps1 x64
#   powershell -ExecutionPolicy Bypass -File scripts/build-bundled-python-windows.ps1 arm64

param(
    [string]$Arch = "x64"
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$BundleDir = Join-Path $Root "src-tauri\bundled\python"
$NugetDir = Join-Path $Root ".cache\nuget"
$NugetExe = Join-Path $NugetDir "nuget.exe"
$PythonVersion = "3.11.9"

Write-Host "=== Building bundled Python $PythonVersion for Windows ($Arch) ==="

Remove-Item $BundleDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $BundleDir | Out-Null
New-Item -ItemType Directory -Force $NugetDir | Out-Null

# Download nuget.exe if missing
if (!(Test-Path $NugetExe)) {
    Write-Host "Downloading nuget.exe..."
    Invoke-WebRequest `
        -Uri "https://dist.nuget.org/win-x86-commandline/latest/nuget.exe" `
        -OutFile $NugetExe
}

# Install Python via NuGet
$PkgDir = Join-Path $Root ".cache\python"
Remove-Item $PkgDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $PkgDir | Out-Null

Write-Host "Installing Python $PythonVersion via NuGet..."
& $NugetExe install python `
    -Version $PythonVersion `
    -OutputDirectory $PkgDir `
    -ExcludeVersion

$PythonSrc = Join-Path $PkgDir "python\tools"
Copy-Item "$PythonSrc\*" $BundleDir -Recurse -Force

$PythonExe = Join-Path $BundleDir "python.exe"
if (!(Test-Path $PythonExe)) {
    Write-Error "python.exe not found at $PythonExe after NuGet install. Check NuGet package layout."
    exit 1
}

# Bootstrap pip and core tools
Write-Host "Setting up pip..."
& $PythonExe -m ensurepip
if ($LASTEXITCODE -ne 0) { throw "ensurepip failed" }

& $PythonExe -m pip install --upgrade pip setuptools wheel
if ($LASTEXITCODE -ne 0) { throw "pip upgrade failed" }

# Install backend requirements
$Req = Join-Path $Root "backend\requirements.txt"
if (Test-Path $Req) {
    Write-Host "Installing backend requirements..."
    & $PythonExe -m pip install -r $Req
    if ($LASTEXITCODE -ne 0) { throw "pip install -r requirements.txt failed" }
}

# Copy backend source into the bundle (Tauri resource dir mirrors this on install)
$BackendSrc = Join-Path $Root "backend"
$BackendDst = Join-Path $BundleDir "backend"
if (Test-Path $BackendSrc) {
    Write-Host "Copying backend source..."
    Copy-Item $BackendSrc $BackendDst -Recurse -Force
}

# Verify
Write-Host ""
Write-Host "Verifying bundled Python..."
& $PythonExe --version
& $PythonExe -c "import fastapi, uvicorn; print('Core imports OK')"
if ($LASTEXITCODE -ne 0) {
    Write-Warning "Core import verification failed. The bundled Python may be incomplete."
}

Write-Host ""
Write-Host "Bundled Python created at $BundleDir"
