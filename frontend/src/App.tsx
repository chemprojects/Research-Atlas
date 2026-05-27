import { useEffect, useState } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { PanelLeftOpen } from "lucide-react";
import { Sidebar } from "./components/Layout/Sidebar";
import { Logo } from "./components/Layout/Logo";
import DailyDigest from "./pages/Dashboard";
import Settings from "./pages/Settings";
import Uninstall from "./pages/Uninstall";
import Library from "./pages/Library";
import { useAppStore } from "./store";
import Chat from "./pages/Chat";
import { ChatProvider } from "./contexts/ChatProvider";
import { API_BASE } from "./lib/apiBase";
import { BackendSetupBanner } from "./components/BackendSetupBanner";
import { isTauri } from "./lib/apiBase";
import { ChatSidebarPanel } from "./components/Layout/ChatSidebarPanel";

function AppLayout() {
  const location = useLocation();
  const backendReady = useAppStore((s) => s.systemStatus?.backend_ready ?? false);
  const showSetupBanner = isTauri() && !backendReady;
  const onChatRoute = location.pathname === "/chat";

  const [sidebarOpen, setSidebarOpen] = useState(() => {
    const stored = localStorage.getItem("sidebar_open");
    return stored !== "false";
  });

  const toggleSidebar = (open: boolean) => {
    setSidebarOpen(open);
    localStorage.setItem("sidebar_open", String(open));
  };

  return (
    <ChatProvider>
      <div className="flex h-screen overflow-hidden bg-surface">
        {sidebarOpen && <Sidebar onClose={() => toggleSidebar(false)} />}
        {onChatRoute && (
          <aside className="relative z-30 w-72 flex-shrink-0 h-full bg-surface-raised border-r border-surface-border overflow-visible flex flex-col">
            <ChatSidebarPanel className="h-full px-3 py-3" />
          </aside>
        )}
        <main className="flex-1 overflow-auto flex flex-col min-w-0">
          {showSetupBanner && <BackendSetupBanner />}
          {!sidebarOpen && (
            <div className="flex items-center gap-3 px-4 py-3 border-b border-surface-border bg-surface-raised flex-shrink-0">
              <button
                type="button"
                onClick={() => toggleSidebar(true)}
                className="p-2 rounded-lg text-gray-300 hover:text-gray-100 hover:bg-surface-overlay border border-surface-border transition-colors"
                title="Open sidebar"
              >
                <PanelLeftOpen size={20} />
              </button>
              <Logo compact />
            </div>
          )}
          <div className="flex-1 overflow-auto min-h-0">
            <Routes>
              <Route path="/" element={<DailyDigest />} />
              <Route path="/library" element={<Library />} />
              <Route path="/chat" element={<Chat />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/uninstall" element={<Uninstall />} />
              <Route path="/papers" element={<Navigate to="/" replace />} />
              <Route path="/digest" element={<Navigate to="/" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </ChatProvider>
  );
}

export default function App() {
  const pollSystemStatus = useAppStore((s) => s.pollSystemStatus);

  useEffect(() => {
    localStorage.setItem("setup_complete", "true");
    if (localStorage.getItem("atlas_setup_bootstrapped") === "true") return;
    fetch(`${API_BASE}/system/complete-setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
      .then(() => localStorage.setItem("atlas_setup_bootstrapped", "true"))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const stop = pollSystemStatus();
    return stop;
  }, [pollSystemStatus]);

  return <AppLayout />;
}
