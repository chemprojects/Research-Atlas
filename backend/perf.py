from __future__ import annotations

import logging
import time
from collections import deque
from contextlib import contextmanager
from threading import Lock
from typing import Iterator, Any

log = logging.getLogger("perf")
_stats_lock = Lock()
_http_samples: dict[tuple[str, str], deque[float]] = {}
_stage_samples: dict[str, deque[float]] = {}
_http_counts: dict[tuple[str, str], int] = {}
_HTTP_MAX_SAMPLES = 200
_STAGE_MAX_SAMPLES = 200
_ALWAYS_LOG_SAMPLE_EVERY = 20


def _fmt_ms(ms: float) -> str:
    return f"{ms:.0f}ms"


def _append_sample(store: dict[Any, deque[float]], key: Any, value: float, maxlen: int) -> None:
    bucket = store.get(key)
    if bucket is None:
        bucket = deque(maxlen=maxlen)
        store[key] = bucket
    bucket.append(float(value))


def _record_stage(name: str, elapsed_ms: float) -> None:
    with _stats_lock:
        _append_sample(_stage_samples, name, elapsed_ms, _STAGE_MAX_SAMPLES)


def _record_http(method: str, path: str, elapsed_ms: float) -> int:
    key = (method, path)
    with _stats_lock:
        _append_sample(_http_samples, key, elapsed_ms, _HTTP_MAX_SAMPLES)
        next_count = int(_http_counts.get(key, 0)) + 1
        _http_counts[key] = next_count
        return next_count


def _sample_summary(values: deque[float]) -> dict[str, float | int]:
    if not values:
        return {"count": 0, "avg_ms": 0.0, "p95_ms": 0.0, "max_ms": 0.0, "last_ms": 0.0}
    seq = list(values)
    seq_sorted = sorted(seq)
    idx = max(0, min(len(seq_sorted) - 1, int(len(seq_sorted) * 0.95) - 1))
    return {
        "count": len(seq),
        "avg_ms": round(sum(seq) / len(seq), 1),
        "p95_ms": round(seq_sorted[idx], 1),
        "max_ms": round(max(seq), 1),
        "last_ms": round(seq[-1], 1),
    }


def perf_snapshot() -> dict[str, object]:
    with _stats_lock:
        http_rows = [
            {
                "method": method,
                "path": path,
                **_sample_summary(samples),
            }
            for (method, path), samples in _http_samples.items()
        ]
        stage_rows = [
            {
                "stage": stage,
                **_sample_summary(samples),
            }
            for stage, samples in _stage_samples.items()
        ]
    http_rows.sort(key=lambda row: (row.get("p95_ms", 0), row.get("avg_ms", 0)), reverse=True)
    stage_rows.sort(key=lambda row: (row.get("p95_ms", 0), row.get("avg_ms", 0)), reverse=True)
    return {
        "http": http_rows[:50],
        "stages": stage_rows[:50],
        "generated_at_unix": int(time.time()),
    }


def perf_reset() -> None:
    with _stats_lock:
        _http_samples.clear()
        _stage_samples.clear()
        _http_counts.clear()


@contextmanager
def timed_stage(name: str, **meta: object) -> Iterator[None]:
    started = time.perf_counter()
    try:
        yield
    finally:
        elapsed_ms = (time.perf_counter() - started) * 1000
        _record_stage(name, elapsed_ms)
        suffix = " ".join(f"{k}={v}" for k, v in meta.items() if v is not None)
        log.info("[stage] %s %s%s", name, _fmt_ms(elapsed_ms), f" {suffix}" if suffix else "")


def log_request_timing(
    method: str,
    path: str,
    status: int,
    elapsed_ms: float,
    *,
    slow_threshold_ms: float,
    always_log: bool,
) -> None:
    hit_count = _record_http(method, path, elapsed_ms)
    should_sample_log = always_log and (hit_count % _ALWAYS_LOG_SAMPLE_EVERY == 0)
    if not should_sample_log and elapsed_ms < slow_threshold_ms:
        return
    level = logging.WARNING if elapsed_ms >= max(2000.0, slow_threshold_ms * 3) else logging.INFO
    log.log(
        level,
        "[http] %s %s -> %s in %s%s%s",
        method,
        path,
        status,
        _fmt_ms(elapsed_ms),
        " [slow]" if elapsed_ms >= slow_threshold_ms else "",
        f" [sample #{hit_count}]" if should_sample_log and elapsed_ms < slow_threshold_ms else "",
    )
