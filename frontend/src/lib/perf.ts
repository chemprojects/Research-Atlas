const marks = new Map<string, number>();
const samples = new Map<string, number[]>();
const MAX_SAMPLES = 120;
const SUMMARY_EVERY = 25;
let events = 0;

function isDev(): boolean {
  return Boolean(import.meta.env?.DEV);
}

function addSample(label: string, ms: number): void {
  const list = samples.get(label) ?? [];
  list.push(ms);
  if (list.length > MAX_SAMPLES) list.shift();
  samples.set(label, list);
}

function summary(label: string): string {
  const list = samples.get(label) ?? [];
  if (list.length === 0) return "n=0";
  const sorted = [...list].sort((a, b) => a - b);
  const p95 = sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95) - 1))] ?? 0;
  const avg = list.reduce((a, b) => a + b, 0) / list.length;
  const max = Math.max(...list);
  return `n=${list.length} avg=${Math.round(avg)}ms p95=${Math.round(p95)}ms max=${Math.round(max)}ms`;
}

export function perfStart(label: string): void {
  if (!isDev()) return;
  marks.set(label, performance.now());
}

export function perfEnd(label: string, meta?: Record<string, string | number | boolean>): void {
  if (!isDev()) return;
  const started = marks.get(label);
  if (started == null) return;
  marks.delete(label);
  const ms = Math.round(performance.now() - started);
  addSample(label, ms);
  events += 1;
  const suffix = meta
    ? ` ${Object.entries(meta)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(" ")}`
    : "";
  console.info(`[perf] ${label} ${ms}ms${suffix} (${summary(label)})`);
  if (events % SUMMARY_EVERY === 0) {
    const top = [...samples.entries()]
      .map(([name, vals]) => {
        if (!vals.length) return { name, avg: 0 };
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        return { name, avg };
      })
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 5)
      .map((row) => `${row.name}:${Math.round(row.avg)}ms`)
      .join(" | ");
    console.info(`[perf] summary top avg -> ${top}`);
  }
}

export function perfSnapshot(): Record<string, { count: number; avg_ms: number; max_ms: number }> {
  const out: Record<string, { count: number; avg_ms: number; max_ms: number }> = {};
  for (const [label, vals] of samples.entries()) {
    if (!vals.length) continue;
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    out[label] = {
      count: vals.length,
      avg_ms: Math.round(avg),
      max_ms: Math.round(Math.max(...vals)),
    };
  }
  return out;
}
