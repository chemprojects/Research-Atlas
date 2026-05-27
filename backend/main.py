from __future__ import annotations

import sys

if sys.version_info < (3, 10):
    try:
        import eval_type_backport  # noqa: F401
    except ImportError:
        raise SystemExit(
            "Research Atlas backend requires Python 3.10+.\n"
            f"You are on {sys.version.split()[0]}. "
            "Use python3.10+ or: pip install eval-type-backport"
        ) from None

import logging
import asyncio
import time
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from database.db import init_db
from scheduler.jobs import start_scheduler, stop_scheduler
from api import papers, digest, sources, profile, models, system
from api.library import router as library_router
from api.chat import router as chat_router
from api.chats import router as chats_router
from perf import log_request_timing

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("main")
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

BACKEND_API_VERSION = 2


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Research Atlas backend starting...")
    await init_db()
    start_scheduler()
    log.info("Backend ready on http://127.0.0.1:8765")
    yield
    stop_scheduler()
    log.info("Backend stopped.")


app = FastAPI(
    title="Research Atlas",
    description="Private AI-powered scientific literature monitor",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_slow_requests(request: Request, call_next):
    start = time.perf_counter()
    path = request.url.path
    watch_prefixes = (
        "/api/papers",
        "/api/library",
        "/api/chat",
        "/api/chats",
        "/api/models",
        "/api/system",
    )
    always_log = path.startswith(watch_prefixes)
    threshold_ms = 250 if always_log else 500
    try:
        response = await call_next(request)
    except Exception:
        elapsed_ms = (time.perf_counter() - start) * 1000
        log_request_timing(
            request.method,
            path,
            500,
            elapsed_ms,
            slow_threshold_ms=threshold_ms,
            always_log=True,
        )
        raise
    elapsed_ms = (time.perf_counter() - start) * 1000
    response.headers["X-Response-Time-Ms"] = f"{elapsed_ms:.1f}"
    log_request_timing(
        request.method,
        path,
        response.status_code,
        elapsed_ms,
        slow_threshold_ms=threshold_ms,
        always_log=always_log,
    )
    return response

app.include_router(papers.router, prefix="/api")
app.include_router(digest.router, prefix="/api")
app.include_router(sources.router, prefix="/api")
app.include_router(profile.router, prefix="/api")
app.include_router(models.router, prefix="/api")
app.include_router(system.router, prefix="/api")
app.include_router(library_router, prefix="/api")
app.include_router(chat_router, prefix="/api")
app.include_router(chats_router, prefix="/api")


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "app": "research_atlas",
        "version": "0.1.0",
        "backend_api_version": BACKEND_API_VERSION,
        "features": {
            "safe_ollama_start": True,
            "blocking_model_install": True,
        },
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8765, reload=False)
