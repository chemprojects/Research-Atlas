import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./apiBase";

export interface LauncherStatus {
  backend_running: boolean;
  phase: string;
  message: string;
  error: string | null;
  log_path: string;
  app_data_dir: string;
  venv_ready: boolean;
  bundled_python?: boolean;
}

let bootstrapPromise: Promise<LauncherStatus | null> | null = null;

export async function getLauncherStatus(): Promise<LauncherStatus | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<LauncherStatus>("get_launcher_status");
  } catch {
    return null;
  }
}

/** Ensure data dir exists and try to start the backend once per app session. */
export async function ensureBackendStarted(): Promise<LauncherStatus | null> {
  if (!isTauri()) return null;
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      try {
        await invoke<string>("get_app_data_dir");
        const running = await invoke<boolean>("get_backend_status");
        if (!running) {
          await invoke<string>("start_backend");
        }
        return await getLauncherStatus();
      } catch {
        return await getLauncherStatus();
      }
    })();
  }
  return bootstrapPromise;
}

export async function retryBackendStart(): Promise<LauncherStatus | null> {
  if (!isTauri()) return null;
  bootstrapPromise = null;
  try {
    await invoke<string>("start_backend");
  } catch {
    /* status carries error */
  }
  return getLauncherStatus();
}
