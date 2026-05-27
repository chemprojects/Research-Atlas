# Bundled Python runtime

This folder is populated by `scripts/build-bundled-python.sh` before a release build.

The resulting `python/` tree is copied into the `.app` as `Contents/Resources/python/` and used directly at launch — **no pip install on the user's Mac**.

```bash
# From repo root (on the Mac arch you are targeting, with network once):
bash scripts/build-bundled-python.sh
cd src-tauri && cargo tauri build
```

Intel Mac → Intel app. M1/M2/M3 → Apple Silicon app.

Or use the all-in-one script:

```bash
bash scripts/build-release-macos.sh
```

The `python/` directory is gitignored (~1–2 GB with PyTorch + sentence-transformers).
