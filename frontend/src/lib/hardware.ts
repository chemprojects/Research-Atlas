import { API_BASE as API } from "./apiBase";

export interface ResourceLimits {
  cpu_cores_max: number;
  ram_gb_max: number;
  disk_gb_max: number;
  gpu_available: boolean;
  gpu_vram_gb_max: number;
}

export interface ResourceAllocation {
  cpu_cores: number;
  ram_gb: number;
  disk_gb: number;
  gpu_enabled: boolean;
  gpu_vram_gb: number;
}

export interface HardwareResponse {
  os?: string;
  cpu_model?: string;
  cpu_cores?: number;
  cpu_threads?: number;
  ram_gb?: number;
  disk_total_gb?: number;
  disk_free_gb?: number;
  gpu_available?: boolean;
  gpu_name?: string;
  vram_gb?: number;
  limits: ResourceLimits;
  allocation: ResourceAllocation;
}

export async function fetchHardware(): Promise<HardwareResponse> {
  const r = await fetch(`${API}/system/hardware`);
  if (!r.ok) throw new Error("Failed to load hardware");
  return r.json();
}

export async function updateResourceAllocation(
  allocation: ResourceAllocation,
): Promise<HardwareResponse> {
  const r = await fetch(`${API}/system/resource-allocation`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(allocation),
  });
  if (!r.ok) throw new Error("Failed to save resource allocation");
  return r.json();
}
