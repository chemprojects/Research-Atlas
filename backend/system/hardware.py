from __future__ import annotations
import platform, subprocess, shutil, os, json
import psutil


def _sysctl(key: str) -> str:
    try:
        return subprocess.check_output(["sysctl", "-n", key], timeout=3, text=True).strip()
    except Exception:
        return ""


def _is_apple_silicon() -> bool:
    """True only when running natively on Apple Silicon (arm64), not Intel."""
    return platform.system() == "Darwin" and platform.machine() == "arm64"


def _cpu_model_macos() -> str:
    # On Apple Silicon: sysctl machdep.cpu.brand_string may be empty; use hw.model instead
    brand = _sysctl("machdep.cpu.brand_string")
    if brand:
        return brand
    # Apple Silicon fallback: parse chip name from sysctl hw.chip_model or hw.model
    chip = _sysctl("hw.chip_model") or _sysctl("hw.model")
    return chip or "Apple Silicon"


def _cpu_model_linux() -> str:
    try:
        with open("/proc/cpuinfo") as f:
            for line in f:
                if line.startswith("model name"):
                    return line.split(":", 1)[1].strip()
    except Exception:
        pass
    return platform.processor() or "Unknown"


def _macos_gpu() -> tuple[bool, str | None, float | None]:
    """Detect GPU on macOS using system_profiler (works for Intel AMD/Nvidia and Apple Silicon)."""
    try:
        raw = subprocess.check_output(
            ["system_profiler", "SPDisplaysDataType", "-json"],
            timeout=10, text=True
        )
        data = json.loads(raw)
        gpus = data.get("SPDisplaysDataType", [])
        if not gpus:
            return False, None, None
        gpu = gpus[0]
        name = gpu.get("sppci_model") or gpu.get("_name") or "Unknown GPU"
        vram_str = gpu.get("sppci_vram") or gpu.get("spdisplays_vram") or ""
        # e.g. "4 GB" or "16384 MB"
        vram_gb = None
        if vram_str:
            parts = vram_str.strip().split()
            try:
                val = float(parts[0].replace(",", ""))
                unit = parts[1].upper() if len(parts) > 1 else "MB"
                vram_gb = round(val / 1024 if unit == "MB" else val, 1)
            except (ValueError, IndexError):
                pass
        # Apple Silicon: unified memory, so VRAM = system RAM
        if _is_apple_silicon() and vram_gb is None:
            vram_gb = round(psutil.virtual_memory().total / (1024 ** 3), 1)
        return True, name, vram_gb
    except Exception:
        # Fallback: if Apple Silicon, GPU is always available
        if _is_apple_silicon():
            chip = _sysctl("hw.chip_model") or "Apple Silicon"
            cores = _sysctl("hw.perflevel0.logicalcpu") or ""
            name = f"{chip} GPU ({cores}-core)" if cores else f"{chip} GPU"
            vram_gb = round(psutil.virtual_memory().total / (1024 ** 3), 1)
            return True, name, vram_gb
        return False, None, None


def _macos_version_tuple() -> tuple[int, ...]:
    try:
        ver = platform.mac_ver()[0]
        parts = [int(p) for p in ver.split(".") if p.isdigit()]
        return tuple(parts[:3]) if parts else (0,)
    except Exception:
        return (0,)


def ollama_supported_on_this_os() -> bool:
    """Ollama officially supports macOS 14+ and Windows 10/11."""
    system = platform.system()
    if system == "Darwin":
        return _macos_version_tuple() >= (14, 0)
    if system == "Windows":
        return True
    return True


def detect_hardware() -> dict:
    system = platform.system()
    os_name = {"Darwin": "macOS", "Linux": "Linux", "Windows": "Windows"}.get(system, system)
    os_version = platform.version()
    if system == "Darwin":
        os_version = platform.mac_ver()[0] or os_version
    elif system == "Windows":
        os_version = platform.win32_ver()[0] or os_version
    cpu_cores = psutil.cpu_count(logical=False) or psutil.cpu_count()
    cpu_threads = psutil.cpu_count(logical=True) or cpu_cores
    ram_gb = round(psutil.virtual_memory().total / (1024 ** 3), 1)
    disk = psutil.disk_usage(os.path.expanduser("~"))
    disk_total_gb = round(disk.total / (1024 ** 3), 1)
    disk_free_gb = round(disk.free / (1024 ** 3), 1)

    # CPU model
    if system == "Darwin":
        cpu_model = _cpu_model_macos()
    elif system == "Linux":
        cpu_model = _cpu_model_linux()
    else:
        cpu_model = platform.processor() or "Unknown"

    gpu_available = False
    gpu_name = None
    vram_gb = None

    # NVIDIA (Linux / Windows)
    if shutil.which("nvidia-smi"):
        try:
            out = subprocess.check_output(
                ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
                timeout=5, text=True
            ).strip().split("\n")[0]
            parts = out.split(", ")
            if len(parts) == 2:
                gpu_available = True
                gpu_name = parts[0].strip()
                vram_gb = round(int(parts[1].strip()) / 1024, 1)
        except Exception:
            pass

    # macOS (Intel AMD/Nvidia or Apple Silicon)
    if not gpu_available and system == "Darwin":
        gpu_available, gpu_name, vram_gb = _macos_gpu()

    # AMD ROCm (Linux)
    if not gpu_available and shutil.which("rocm-smi"):
        try:
            out = subprocess.check_output(["rocm-smi", "--showmeminfo", "vram"], timeout=5, text=True)
            if "VRAM" in out:
                gpu_available = True
                gpu_name = "AMD GPU (ROCm)"
        except Exception:
            pass

    ollama_installed, ollama_version = _check_ollama()
    recommended_model, recommended_mode = _recommend(ram_gb, cpu_cores, gpu_available, vram_gb)

    return {
        "os": os_name,
        "os_version": os_version,
        "ollama_supported": ollama_supported_on_this_os(),
        "cpu_cores": cpu_cores,
        "cpu_threads": cpu_threads,
        "cpu_model": cpu_model,
        "ram_gb": ram_gb,
        "disk_total_gb": disk_total_gb,
        "disk_free_gb": disk_free_gb,
        "gpu_available": gpu_available,
        "gpu_name": gpu_name,
        "vram_gb": vram_gb,
        "ollama_installed": ollama_installed,
        "ollama_version": ollama_version,
        "recommended_model": recommended_model,
        "recommended_mode": recommended_mode,
    }


def _check_ollama() -> tuple[bool, str | None]:
    if shutil.which("ollama"):
        try:
            out = subprocess.check_output(["ollama", "--version"], timeout=5, text=True).strip()
            return True, out.split()[-1] if out else "unknown"
        except Exception:
            return True, None
    return False, None


def _recommend(ram_gb: float, cpu_cores: int, gpu: bool, vram_gb: float | None) -> tuple[str, str]:
    if gpu and vram_gb and vram_gb >= 24:
        return "gemma4:26b", "gpu"
    if gpu and vram_gb and vram_gb >= 8:
        return "gemma4:e4b", "gpu"
    if gpu and vram_gb and vram_gb >= 6:
        return "gemma4:e2b", "gpu"
    if ram_gb >= 32 and cpu_cores >= 8:
        return "gemma4:e4b", "cpu"
    if ram_gb >= 8:
        return "gemma4:e2b", "cpu"
    return "phi4-mini:latest", "cpu"
