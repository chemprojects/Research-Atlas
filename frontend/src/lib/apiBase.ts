/** Backend API base URL (dev and Tauri production both use local uvicorn). */
export const API_BASE = "http://127.0.0.1:8765/api";

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
