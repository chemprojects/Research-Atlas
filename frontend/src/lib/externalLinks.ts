import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./apiBase";

export async function openExternalUrl(url: string): Promise<void> {
  const trimmed = url.trim();
  if (!trimmed) return;

  if (isTauri()) {
    await invoke("open_external_url", { url: trimmed });
    return;
  }

  window.open(trimmed, "_blank", "noopener,noreferrer");
}
