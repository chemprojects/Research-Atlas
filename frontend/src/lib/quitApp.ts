import { API_BASE, isTauri } from "./apiBase";

export async function quitResearchAtlas(): Promise<void> {
  try {
    await fetch(`${API_BASE}/system/shutdown`, { method: "POST" });
  } catch {
    /* backend may already be down */
  }

  if (isTauri()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("quit_app");
      return;
    } catch {
      /* fall through */
    }
  }
  window.alert("Research Atlas backend is stopping. You can close this browser tab.");
}

export async function removeApplicationAfterQuit(): Promise<{ ok: boolean; message: string }> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke("remove_application");
  } catch (e) {
    return {
      ok: false,
      message:
        e instanceof Error
          ? e.message
          : "Remove application is only available in the desktop app.",
    };
  }
}
