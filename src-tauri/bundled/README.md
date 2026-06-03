# Bundled Python runtime

This folder is populated by `scripts/build-bundled-python.sh` before a release build.

The resulting `python/` tree is copied into the `.app` as `Contents/Resources/python/` and used directly at launch — **no pip install on the user's Mac**.

```bash
bash scripts/build-bundled-python.sh
cd src-tauri && cargo tauri build
```

Or use the all-in-one script:

```bash
bash scripts/build-release-macos.sh
```

The `python/` directory is gitignored (~1–2 GB with PyTorch + sentence-transformers).
