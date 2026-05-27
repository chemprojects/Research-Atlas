import type { HardwareResponse, ResourceAllocation } from "../lib/hardware";

interface HardwareSettingsPanelProps {
  hw: HardwareResponse | null;
  alloc: ResourceAllocation | null;
  loading: boolean;
  onAllocChange: (next: ResourceAllocation) => void;
}

export function HardwareSettingsPanel({
  hw,
  alloc,
  loading,
  onAllocChange,
}: HardwareSettingsPanelProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-2 border-primary-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!hw || !alloc) {
    return (
      <p className="text-sm text-gray-500 py-6 text-center">
        Unable to load hardware info. Make sure Research Atlas is online.
      </p>
    );
  }

  const set = (patch: Partial<ResourceAllocation>) => onAllocChange({ ...alloc, ...patch });

  return (
    <>
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">
          Detected system
        </h3>
        <div className="grid grid-cols-2 gap-3">
          {hw.cpu_model && (
            <div className="p-4 rounded-lg bg-surface-overlay border border-surface-border col-span-2">
              <p className="text-xs text-gray-500 mb-1">CPU</p>
              <p className="text-sm text-gray-200">{hw.cpu_model}</p>
            </div>
          )}
          <div className="p-4 rounded-lg bg-surface-overlay border border-surface-border">
            <p className="text-xs text-gray-500 mb-1">CPU threads</p>
            <p className="text-sm text-gray-200">{hw.limits.cpu_cores_max}</p>
          </div>
          <div className="p-4 rounded-lg bg-surface-overlay border border-surface-border">
            <p className="text-xs text-gray-500 mb-1">RAM (total)</p>
            <p className="text-sm text-gray-200">{hw.limits.ram_gb_max} GB</p>
          </div>
          <div className="p-4 rounded-lg bg-surface-overlay border border-surface-border col-span-2">
            <p className="text-xs text-gray-500 mb-1">GPU</p>
            <p className="text-sm text-gray-200">
              {hw.gpu_available
                ? `${hw.gpu_name ?? "GPU"}${hw.limits.gpu_vram_gb_max ? ` · ${hw.limits.gpu_vram_gb_max} GB VRAM` : ""}`
                : "Not detected"}
            </p>
          </div>
          <div className="p-4 rounded-lg bg-surface-overlay border border-surface-border">
            <p className="text-xs text-gray-500 mb-1">Disk (total)</p>
            <p className="text-sm text-gray-200">{hw.limits.disk_gb_max} GB</p>
          </div>
          <div className="p-4 rounded-lg bg-surface-overlay border border-surface-border">
            <p className="text-xs text-gray-500 mb-1">Disk (free)</p>
            <p className="text-sm text-gray-200">{hw.disk_free_gb ?? "—"} GB</p>
          </div>
        </div>
      </section>

      <section className="card space-y-5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
          Allocate to Research Atlas
        </h3>
        <p className="text-xs text-gray-500 -mt-2">
          Defaults use full system capacity. Drag sliders to limit resources for other apps, then click Save Settings.
        </p>

        <div>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-gray-300">CPU cores</span>
            <span className="text-gray-400 tabular-nums">
              {alloc.cpu_cores} / {hw.limits.cpu_cores_max}
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={hw.limits.cpu_cores_max}
            step={1}
            value={alloc.cpu_cores}
            onChange={(e) => set({ cpu_cores: Number(e.target.value) })}
            className="w-full accent-primary-500"
          />
        </div>

        <div>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-gray-300">RAM</span>
            <span className="text-gray-400 tabular-nums">
              {alloc.ram_gb} / {hw.limits.ram_gb_max} GB
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={hw.limits.ram_gb_max}
            step={0.5}
            value={alloc.ram_gb}
            onChange={(e) => set({ ram_gb: Number(e.target.value) })}
            className="w-full accent-primary-500"
          />
        </div>

        <div>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-gray-300">Disk space</span>
            <span className="text-gray-400 tabular-nums">
              {alloc.disk_gb} / {hw.limits.disk_gb_max} GB
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={hw.limits.disk_gb_max}
            step={1}
            value={alloc.disk_gb}
            onChange={(e) => set({ disk_gb: Number(e.target.value) })}
            className="w-full accent-primary-500"
          />
        </div>

        {hw.limits.gpu_available && (
          <>
            <label className="flex items-center justify-between gap-4 py-1">
              <span className="text-sm text-gray-300">Use GPU acceleration</span>
              <input
                type="checkbox"
                checked={alloc.gpu_enabled}
                onChange={(e) =>
                  set({
                    gpu_enabled: e.target.checked,
                    gpu_vram_gb: e.target.checked ? hw.limits.gpu_vram_gb_max : 0,
                  })
                }
                className="rounded border-surface-border"
              />
            </label>
            {alloc.gpu_enabled && hw.limits.gpu_vram_gb_max > 0 && (
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-gray-300">GPU memory</span>
                  <span className="text-gray-400 tabular-nums">
                    {alloc.gpu_vram_gb} / {hw.limits.gpu_vram_gb_max} GB
                  </span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={hw.limits.gpu_vram_gb_max}
                  step={0.5}
                  value={alloc.gpu_vram_gb}
                  onChange={(e) => set({ gpu_vram_gb: Number(e.target.value) })}
                  className="w-full accent-primary-500"
                />
              </div>
            )}
          </>
        )}

        <button
          type="button"
          className="btn-secondary text-sm w-full"
          onClick={() =>
            onAllocChange({
              cpu_cores: hw.limits.cpu_cores_max,
              ram_gb: hw.limits.ram_gb_max,
              disk_gb: hw.limits.disk_gb_max,
              gpu_enabled: hw.limits.gpu_available,
              gpu_vram_gb: hw.limits.gpu_vram_gb_max,
            })
          }
        >
          Reset to full system capacity
        </button>
      </section>
    </>
  );
}
