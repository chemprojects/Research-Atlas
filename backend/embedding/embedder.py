from __future__ import annotations
import numpy as np
import json
import logging
from config import settings

_model = None
_model_name = None
_embedding_disabled = False
_DEFAULT_DIM = 384
log = logging.getLogger("embedding")


def _load_model():
    global _model, _model_name, _embedding_disabled
    if _embedding_disabled:
        return None
    if _model is not None:
        return _model
    try:
        import torch  # noqa: F401 — required before transformers on some installs
        from sentence_transformers import SentenceTransformer
        model_name = settings.embedding_model
        cache_dir = str(settings.models_path / "embedding")
        try:
            _model = SentenceTransformer(model_name, cache_folder=cache_dir)
            _model_name = model_name
        except Exception:
            # Fallback to smaller model
            _model = SentenceTransformer("BAAI/bge-small-en-v1.5", cache_folder=cache_dir)
            _model_name = "BAAI/bge-small-en-v1.5"
    except Exception as e:
        _embedding_disabled = True
        _model = None
        _model_name = None
        log.error("Embedding backend unavailable; falling back to zero vectors: %s", e)
        return None
    return _model


def embed_texts(texts: list[str]) -> np.ndarray:
    model = _load_model()
    cleaned = [t[:512] for t in texts]  # truncate to avoid OOM
    if model is None:
        return np.zeros((len(cleaned), _DEFAULT_DIM), dtype=np.float32)
    try:
        vectors = model.encode(cleaned, normalize_embeddings=True, show_progress_bar=False)
        arr = np.asarray(vectors, dtype=np.float32)
        if arr.ndim == 1:
            return arr.reshape(1, -1)
        return arr
    except Exception as e:
        global _embedding_disabled
        _embedding_disabled = True
        log.error("Embedding encode failed; using zero vectors for this run: %s", e)
        return np.zeros((len(cleaned), _DEFAULT_DIM), dtype=np.float32)


def embed_single(text: str) -> np.ndarray:
    return embed_texts([text])[0]


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    if a is None or b is None:
        return 0.0
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))


def embedding_to_bytes(emb: np.ndarray) -> bytes:
    return emb.astype(np.float32).tobytes()


def bytes_to_embedding(data: bytes) -> np.ndarray:
    return np.frombuffer(data, dtype=np.float32)


def build_profile_text(profile: dict) -> str:
    parts = []
    interests = profile.get("interests") or []
    keywords = profile.get("keywords") or []
    domains = profile.get("domains") or []
    if isinstance(interests, str):
        interests = json.loads(interests)
    if isinstance(keywords, str):
        keywords = json.loads(keywords)
    if isinstance(domains, str):
        domains = json.loads(domains)
    parts.extend(interests)
    parts.extend(keywords)
    parts.extend(domains)
    return ". ".join(str(p) for p in parts if p)
