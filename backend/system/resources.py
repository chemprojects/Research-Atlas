from __future__ import annotations

import json
from typing import Any

from config import CONFIG_PATH, settings
from system.hardware import detect_hardware


def _read_saved() -> dict[str, Any]:
    if not settings.resource_allocation and CONFIG_PATH.exists():
        try:
            data = json.loads(CONFIG_PATH.read_text())
            ra = data.get("resource_allocation")
            if isinstance(ra, dict):
                settings.resource_allocation = ra
        except Exception:
            pass
    return dict(settings.resource_allocation or {})


def _limits_from_hw(hw: dict) -> dict[str, Any]:
    cpu_max = int(hw.get("cpu_threads") or hw.get("cpu_cores") or 1)
    ram_max = float(hw.get("ram_gb") or 1)
    disk_max = float(hw.get("disk_total_gb") or hw.get("disk_free_gb") or 1)
    gpu_available = bool(hw.get("gpu_available"))
    vram_max = float(hw.get("vram_gb") or 0) if gpu_available else 0.0
    return {
        "cpu_cores_max": max(1, cpu_max),
        "ram_gb_max": max(1.0, ram_max),
        "disk_gb_max": max(1.0, disk_max),
        "gpu_available": gpu_available,
        "gpu_vram_gb_max": max(0.0, vram_max),
    }


def default_allocation(limits: dict[str, Any]) -> dict[str, Any]:
    return {
        "cpu_cores": limits["cpu_cores_max"],
        "ram_gb": limits["ram_gb_max"],
        "disk_gb": limits["disk_gb_max"],
        "gpu_enabled": limits["gpu_available"],
        "gpu_vram_gb": limits["gpu_vram_gb_max"] if limits["gpu_available"] else 0.0,
    }


def get_hardware_with_allocation() -> dict[str, Any]:
    hw = detect_hardware()
    limits = _limits_from_hw(hw)
    saved = _read_saved()
    allocation = default_allocation(limits)
    if saved:
        allocation.update({k: saved[k] for k in allocation if k in saved})
    allocation = clamp_allocation(allocation, limits)
    return {
        **hw,
        "limits": limits,
        "allocation": allocation,
    }


def clamp_allocation(allocation: dict[str, Any], limits: dict[str, Any]) -> dict[str, Any]:
    cpu_max = int(limits["cpu_cores_max"])
    ram_max = float(limits["ram_gb_max"])
    disk_max = float(limits["disk_gb_max"])
    vram_max = float(limits["gpu_vram_gb_max"])
    gpu_ok = bool(limits["gpu_available"])

    cpu = int(allocation.get("cpu_cores", cpu_max))
    cpu = max(1, min(cpu, cpu_max))

    ram = float(allocation.get("ram_gb", ram_max))
    ram = max(1.0, min(ram, ram_max))

    disk = float(allocation.get("disk_gb", disk_max))
    disk = max(1.0, min(disk, disk_max))

    gpu_enabled = bool(allocation.get("gpu_enabled", gpu_ok)) and gpu_ok
    vram = float(allocation.get("gpu_vram_gb", vram_max if gpu_enabled else 0))
    if gpu_enabled and vram_max > 0:
        vram = max(0.5, min(vram, vram_max))
    else:
        vram = 0.0
        gpu_enabled = False

    return {
        "cpu_cores": cpu,
        "ram_gb": round(ram, 1),
        "disk_gb": round(disk, 1),
        "gpu_enabled": gpu_enabled,
        "gpu_vram_gb": round(vram, 1),
    }


def save_allocation(body: dict[str, Any]) -> dict[str, Any]:
    hw = detect_hardware()
    limits = _limits_from_hw(hw)
    merged = default_allocation(limits)
    if body:
        merged.update(body)
    merged = clamp_allocation(merged, limits)
    settings.resource_allocation = merged
    settings.save()
    if merged["gpu_enabled"]:
        settings.run_mode = "gpu"
    else:
        settings.run_mode = "cpu"
    settings.save()
    return get_hardware_with_allocation()
