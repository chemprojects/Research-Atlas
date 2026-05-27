# Research Atlas

**Your private AI research scout** — a local desktop app that monitors scientific literature, ranks papers by relevance, and generates personalized digests. No cloud subscriptions required for core use.

All paper data and AI processing stay on your machine.

---

## For end users (packaged app)

### Downloads

- 🍎 macOS (Apple Silicon):  
  [Download (.dmg)](https://github.com/{repo}/ResearchAtlas/releases/latest/download/ResearchAtlas-arm64.dmg)

- 🪟 Windows:  
  [Download Installer (.exe)](https://github.com/{repo}/ResearchAtlas/releases/latest/download/ResearchAtlas-Setup.exe)

### macOS launch note

If macOS says the app is from an unknown developer and it does not appear under
System Settings → Privacy & Security, remove the quarantine flag manually:

```bash
xattr -dr com.apple.quarantine "/Applications/Research Atlas.app"
```

### Windows launch note

If Windows blocks the app:

1. Right-click **Research Atlas**
2. Select **Run as administrator**
3. Click **Yes**

If Windows SmartScreen shows a warning:

1. Click **More info**
2. Click **Run anyway**

### First launch

1. Open **Research Atlas** from Applications (Mac) or the Start menu (Windows).
2. The app creates local storage at **`~/.research_atlas`** and sets up a private Python environment automatically.
3. Open **Settings** to configure:
   - **Research Profile** — interests and keywords for ranking
   - **Sources** — OpenAlex, arXiv, PubMed, etc.
   - **AI Models** — install **Ollama**, then pull a language model
   - **Schedule** — daily scan time

Everything is configured in **Settings**.

### Daily use

- **Daily Digest** — ranked papers for today
- **Library** — saved papers, folders, PDFs
- **Chat** — ask questions about your library (requires Ollama)
- **Run Scan Now** — sidebar button to fetch new papers

**Pause background scans:** Sidebar → **Pause background scans** (does not quit the app).

**Quit:** Sidebar → **Quit Research Atlas**.

### AI models (Ollama)

1. Settings → **AI Models**
2. **Step 1:** Install **Ollama runtime**
3. **Step 2:** Install a **language model** (e.g. Mistral 7B Instruct)
4. **Step 3:** Install an **embedding model** (e.g. SPECTER2) for ranking

**System requirements for Ollama:** macOS 14+ or Windows 10/11. Older macOS versions can still use library and digest without local LLM.

---

## Uninstalling

Sidebar → **Uninstall**:

| Action | What it does |
|--------|----------------|
| **Back up data** | Zip `~/.research_atlas` to your Desktop |
| **Remove all Research Atlas data** | Deletes app data, venv, Ollama app, and `~/.ollama` |
| **Remove selected** | Pick individual components |
| **Remove application** | Move Mac app to Trash / Windows uninstall |

---

## Data locations

| Item | Path |
|------|------|
| App data | `~/.research_atlas/` |
| Database | `~/.research_atlas/papers.db` |
| Embeddings | `~/.research_atlas/models/embedding/` |
| Isolated Python | `~/.research_atlas/venv/` |
| Ollama models | `~/.ollama/` (shared with other Ollama apps) |
| Logs | `~/.research_atlas/logs/` |

---

## License

Research Atlas is licensed under the PolyForm Noncommercial License 1.0.0.

You may:

- use the software for non-commercial purposes
- study the source code
- modify the code
- submit contributions

You may not:

- use the software commercially
- sell the software
- incorporate it into commercial products or services

---

## For developers

### 1. Install prerequisites

| Tool | Purpose |
|------|---------|
| Rust + Cargo | Tauri desktop shell |
| Node.js 18+ | Frontend build |
| Python 3.10+ | Dev fallback only (release builds bundle Python) |

**Linux only (Tauri deps):**

```bash
sudo apt install libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
```

### 2. Install frontend dependencies

```bash
cd frontend
npm install
```

### 3. Run (desktop — recommended)

```bash
cd src-tauri
cargo tauri dev
```

Without a bundled runtime, the first `cargo tauri dev` bootstraps `~/.research_atlas/venv` via pip (slow). For release-like dev, run `bash scripts/build-bundled-python.sh` once.

### 4. Alternative: backend + Vite (no Tauri)

```bash
cd backend
~/.research_atlas/venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8765 --reload
```

```bash
cd frontend && npm run dev
```

Open http://localhost:1420 only if you are testing the web UI without Tauri.

### 5. Production build (macOS)

Build on the **same kind of Mac** you want the `.app` to run on:

| Build machine | App runs on |
|---------------|-------------|
| Intel Mac | Intel Macs |
| Apple Silicon (M1/M2/M3/M4/M5) | Apple Silicon Macs |

```bash
bash scripts/build-release-macos.sh
```

Or step by step:

```bash
bash scripts/build-bundled-python.sh   # ~5–15 min, needs network once
npm run build --prefix frontend
cd src-tauri && cargo tauri build      # uses native target automatically
```

The DMG includes `Contents/Resources/python/`. End users need **no system Python**.

> **Note:** An Intel build does not run natively on Apple Silicon (and vice versa) unless you ship a Universal binary — build twice and distribute two DMGs, or build each arch on matching hardware.

### Build Apple Silicon `.app` on an Intel iMac

```bash
# On Intel iMac (Xcode Command Line Tools + Rust required)
bash scripts/build-release-macos.sh arm64
```

This will:

1. Download the **arm64** Python runtime and install **arm64** wheels via cross-pip (no import test on Intel).
2. Cross-compile the Tauri shell for `aarch64-apple-darwin`.

Copy the DMG from `src-tauri/target/aarch64-apple-darwin/release/bundle/macos/` to your M1, install, and run.

**Easier alternative:** run the same command on the M1 Mac itself (`bash scripts/build-release-macos.sh` with no args) — no cross-compile, and import tests run during the build.

**Requirements for cross-build:** `xcode-select --install`, `rustup target add aarch64-apple-darwin`, and Python 3 on the Intel Mac (for cross-pip only).

---

## Troubleshooting

**Backend offline**

- Quit and reopen the app, or use **Quit Research Atlas** then relaunch.
- **Release app (`.dmg`)**: backend should start within ~30s. Logs: `~/.research_atlas/logs/launcher.log` and `backend.log`.
- **Dev / old builds without bundled Python**: first launch runs `bootstrap_venv.py` + pip into `~/.research_atlas/venv` (slow; needs internet). Delete `~/.research_atlas/venv` and retry if corrupted.
- Rebuild the bundled runtime after dependency changes: `bash scripts/build-bundled-python.sh` then `cargo tauri build`.

**Ollama not supported on this Mac**

- Ollama requires macOS 14+. Upgrade macOS or use library/sources without LLM features.

**Port 8765 in use**

- Another Research Atlas instance may be running. Quit from the sidebar or Activity Monitor.

**Embedding download**

- Models cache to `~/.research_atlas/models/embedding/`

**Logs**

- `~/.research_atlas/logs/`

---

## Project structure

```
PaperTracker/
├── backend/          FastAPI + scheduler + ingestion
├── frontend/         React UI
├── src-tauri/        Desktop shell (Research Atlas)
└── scripts/          build & release helpers
```

