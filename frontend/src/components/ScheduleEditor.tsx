import { useEffect, useState } from "react";
import { Plus, Trash2, Clock } from "lucide-react";

export interface ScanSchedule {
  dailyTimes: string[];
  everyHours: number | null;
}

const STORAGE_KEY = "scan_schedule";

const DEFAULT_SCHEDULE: ScanSchedule = {
  dailyTimes: ["07:00"],
  everyHours: null,
};

export function loadScanSchedule(): ScanSchedule {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ScanSchedule;
      if (parsed.dailyTimes?.length) return parsed;
    }
  } catch { /* ignore */ }
  return DEFAULT_SCHEDULE;
}

export function saveScanSchedule(schedule: ScanSchedule) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(schedule));
}

export function scheduleToCronExpressions(schedule: ScanSchedule): string[] {
  const crons: string[] = [];
  for (const time of schedule.dailyTimes) {
    const [h, m] = time.split(":").map(Number);
    if (!Number.isNaN(h) && !Number.isNaN(m)) {
      crons.push(`${m} ${h} * * *`);
    }
  }
  if (schedule.everyHours && schedule.everyHours > 0) {
    crons.push(`0 */${schedule.everyHours} * * *`);
  }
  return crons;
}

interface ScheduleEditorProps {
  value: ScanSchedule;
  onChange: (schedule: ScanSchedule) => void;
}

export function ScheduleEditor({ value, onChange }: ScheduleEditorProps) {
  const [everyHoursEnabled, setEveryHoursEnabled] = useState(value.everyHours != null);

  useEffect(() => {
    setEveryHoursEnabled(value.everyHours != null);
  }, [value.everyHours]);

  const updateDailyTime = (index: number, time: string) => {
    const next = [...value.dailyTimes];
    next[index] = time;
    onChange({ ...value, dailyTimes: next });
  };

  const addDailyTime = () => {
    onChange({ ...value, dailyTimes: [...value.dailyTimes, "08:00"] });
  };

  const removeDailyTime = (index: number) => {
    if (value.dailyTimes.length <= 1) return;
    onChange({
      ...value,
      dailyTimes: value.dailyTimes.filter((_, i) => i !== index),
    });
  };

  return (
    <div className="space-y-6">
      <section className="card border border-surface-border">
        <h3 className="text-sm font-semibold text-gray-200 mb-1">Daily at</h3>
        <p className="text-sm text-gray-400 mb-4">
          Run a full literature scan at these times each day.
        </p>
        <div className="space-y-2">
          {value.dailyTimes.map((time, index) => (
            <div key={index} className="flex items-center gap-2">
              <span className="text-sm text-gray-300 w-16 flex-shrink-0">Daily at</span>
              <input
                type="time"
                value={time}
                onChange={(e) => updateDailyTime(index, e.target.value)}
                className="input w-36"
              />
              {value.dailyTimes.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeDailyTime(index)}
                  className="p-2 rounded-lg text-gray-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                  title="Remove time"
                >
                  <Trash2 size={16} />
                </button>
              )}
              {index === value.dailyTimes.length - 1 && (
                <button
                  type="button"
                  onClick={addDailyTime}
                  className="p-2 rounded-lg text-primary-400 hover:bg-primary-500/10 border border-primary-500/30 transition-colors"
                  title="Add another daily time"
                >
                  <Plus size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="card border border-surface-border">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={everyHoursEnabled}
            onChange={(e) => {
              const on = e.target.checked;
              setEveryHoursEnabled(on);
              onChange({
                ...value,
                everyHours: on ? (value.everyHours ?? 6) : null,
              });
            }}
            className="mt-1 rounded border-surface-border"
          />
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-gray-200">Repeat on an interval</h3>
            <p className="text-sm text-gray-400 mt-0.5">
              Optionally fetch new papers between daily scans.
            </p>
          </div>
        </label>

        {everyHoursEnabled && (
          <div className="flex items-center gap-2 mt-4 pl-7">
            <span className="text-sm text-gray-300">Every</span>
            <input
              type="number"
              min={1}
              max={24}
              value={value.everyHours ?? 6}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                onChange({
                  ...value,
                  everyHours: Number.isNaN(n) ? 6 : Math.min(24, Math.max(1, n)),
                });
              }}
              className="input w-20 text-center"
            />
            <span className="text-sm text-gray-300">hours</span>
          </div>
        )}
      </section>

      <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-surface-overlay border border-surface-border">
        <Clock size={16} className="text-primary-400 mt-0.5 flex-shrink-0" />
        <p className="text-sm text-gray-400">
          <span className="text-gray-300 font-medium">Active schedule: </span>
          {value.dailyTimes.map((t) => `daily at ${t}`).join(", ")}
          {everyHoursEnabled && value.everyHours
            ? ` · every ${value.everyHours}h`
            : ""}
        </p>
      </div>
    </div>
  );
}
