import { Link, NavLink, useLocation } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  Home,
  Settings,
  Trash2,
  Zap,
  Wifi,
  WifiOff,
  BookMarked,
  MessageSquare,
  Moon,
  Play,
  PanelLeftClose,
  LogOut,
} from "lucide-react";
import clsx from "clsx";
import { useAppStore } from "../../store";
import { quitResearchAtlas } from "../../lib/quitApp";
import { API_BASE } from "../../lib/apiBase";
import { useState } from "react";
import { Logo } from "./Logo";

interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
}

const navItems: NavItem[] = [
  { label: "Daily Digest", to: "/", icon: Home },
  { label: "Library", to: "/library", icon: BookMarked },
  { label: "Chat", to: "/chat", icon: MessageSquare },
  { label: "Settings", to: "/settings", icon: Settings },
];

interface SidebarProps {
  onClose: () => void;
}

export function Sidebar({ onClose }: SidebarProps) {
  const location = useLocation();
  const systemStatus = useAppStore((s) => s.systemStatus);
  const scanRunning = useAppStore((s) => s.scanRunning);
  const runScan = useAppStore((s) => s.runScan);

  const backendReady = systemStatus?.backend_ready ?? false;
  const activeLlm = systemStatus?.current_llm?.trim() ?? "";
  const chatLlm = systemStatus?.chat_llm_model?.trim() || "";
  const [hibernating, setHibernating] = useState(false);

  const toggleHibernate = async () => {
    const next = !hibernating;
    setHibernating(next);
    try {
      await fetch(`${API_BASE}/system/hibernate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: next }),
      });
    } catch { /* ignore */ }
  };

  return (
    <aside
      className="flex-shrink-0 flex flex-col bg-surface border-r border-surface-border h-full overflow-hidden w-60"
    >
      <div className="px-4 py-4 border-b border-surface-border">
        <div className="flex items-center justify-between gap-2">
          <Logo />
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-100 hover:bg-surface-overlay transition-colors flex-shrink-0"
            title="Close sidebar"
          >
            <PanelLeftClose size={18} />
          </button>
        </div>
        {hibernating && (
          <p className="text-xs text-amber-400 mt-2 font-medium hibernate-status">Hibernating</p>
        )}
      </div>

      <nav className="flex-1 px-2 py-4 overflow-y-auto space-y-0.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === "/"}
                className={({ isActive }) =>
                  clsx("nav-item", isActive ? "nav-item-active" : "nav-item-inactive")
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      size={18}
                      className={clsx(isActive ? "text-primary-400" : "text-gray-400")}
                    />
                    <span>{item.label}</span>
                  </>
                )}
              </NavLink>
            </div>
          );
        })}

        <div className="border-t border-surface-border my-2" />

        <NavLink
          to="/uninstall"
          className={({ isActive }) =>
            clsx(
              "nav-item",
              isActive
                ? "bg-red-500/10 text-red-400"
                : "text-gray-400 hover:text-red-400 hover:bg-red-500/10",
            )
          }
        >
          {({ isActive }) => (
            <>
              <Trash2
                size={18}
                className={clsx(isActive ? "text-red-400" : "text-gray-500")}
              />
              <span>Uninstall</span>
            </>
          )}
        </NavLink>
      </nav>

      <div className="px-2 pb-4 pt-2 border-t border-surface-border space-y-2">
        <button
          onClick={() => runScan()}
          disabled={scanRunning || !backendReady}
          className={clsx(
            "w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg font-medium transition-colors",
            scanRunning || !backendReady
              ? "bg-surface-raised text-gray-500 cursor-not-allowed"
              : "bg-primary-500/20 hover:bg-primary-500/30 text-primary-300 border border-primary-500/30",
          )}
          style={{ fontSize: "calc(0.875rem * var(--font-scale))" }}
        >
          <Zap
            size={16}
            className={clsx(scanRunning && "animate-pulse text-yellow-400")}
          />
          {scanRunning ? "Scanning..." : "Run Scan Now"}
        </button>

        <button
          onClick={toggleHibernate}
          title={hibernating ? "Resume scans" : "Pause background scans"}
          className={clsx(
            "w-full flex items-center gap-2 px-3 py-2 rounded-lg font-medium transition-colors",
            hibernating
              ? "hibernate-btn-active bg-amber-500/20 text-amber-300 border border-amber-500/30"
              : "bg-surface-overlay text-gray-300 hover:text-gray-100 border border-surface-border",
          )}
          style={{ fontSize: "calc(0.8125rem * var(--font-scale))" }}
        >
          {hibernating ? <Play size={14} /> : <Moon size={14} />}
          {hibernating ? "Resume" : "Pause background scans"}
        </button>

        <button
          type="button"
          onClick={() => quitResearchAtlas()}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg font-medium transition-colors bg-surface-overlay text-gray-300 hover:text-gray-100 border border-surface-border"
          style={{ fontSize: "calc(0.8125rem * var(--font-scale))" }}
          title="Stop Research Atlas and close the app"
        >
          <LogOut size={14} />
          Quit Research Atlas
        </button>

        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-raised">
          {backendReady ? (
            <Wifi size={14} className="text-green-400" />
          ) : (
            <WifiOff size={14} className="text-red-400" />
          )}
          <span
            className={clsx(
              "font-medium",
              backendReady ? "text-green-400" : "text-red-400",
            )}
            style={{ fontSize: "calc(0.8125rem * var(--font-scale))" }}
          >
            {backendReady ? "Online" : "Offline"}
          </span>
          <div
            className={clsx(
              "ml-auto w-2 h-2 rounded-full",
              backendReady ? "bg-green-400 animate-pulse-slow" : "bg-red-400",
            )}
          />
        </div>

        <Link
          to="/settings?tab=models"
          className="block px-3 py-2 rounded-lg bg-surface-raised hover:bg-surface-overlay border border-transparent hover:border-surface-border transition-colors"
          title="Open AI Models settings"
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <p className="text-fg-muted shrink-0" style={{ fontSize: "calc(0.75rem * var(--font-scale))" }}>
                Paper filter
              </p>
              <p
                className={clsx(
                  "truncate font-mono",
                  activeLlm ? "text-accent" : "text-fg-muted italic",
                )}
                style={{ fontSize: "calc(0.75rem * var(--font-scale))" }}
              >
                {activeLlm || "Not selected"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <p className="text-fg-muted shrink-0" style={{ fontSize: "calc(0.75rem * var(--font-scale))" }}>
                Chat
              </p>
              <p
                className={clsx(
                  "truncate font-mono",
                  chatLlm ? "text-accent" : "text-fg-muted italic",
                )}
                style={{ fontSize: "calc(0.75rem * var(--font-scale))" }}
              >
                {chatLlm || "Not selected"}
              </p>
            </div>
          </div>
        </Link>
      </div>
    </aside>
  );
}
