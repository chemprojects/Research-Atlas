import { useState } from "react";
import {
  AlertTriangle,
  Trash2,
  Check,
  Download,
  Loader2,
  Power,
} from "lucide-react";
import {
  purgeAllResearchAtlasData,
  backupResearchAtlasData,
} from "../../lib/models";
import { removeApplicationAfterQuit } from "../../lib/quitApp";

export default function Uninstall() {
  const [showRemoveAllModal, setShowRemoveAllModal] = useState(false);
  const [removeAllConfirm, setRemoveAllConfirm] = useState("");
  const [uninstalling, setUninstalling] = useState(false);
  const [uninstalled, setUninstalled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backupPath, setBackupPath] = useState<string | null>(null);
  const [backingUp, setBackingUp] = useState(false);

  const canRemoveAll = removeAllConfirm === "REMOVE ALL";

  const handleRemoveAll = async () => {
    setUninstalling(true);
    setError(null);
    try {
      await purgeAllResearchAtlasData();
      setUninstalled(true);
      setShowRemoveAllModal(false);
      setRemoveAllConfirm("");
    } catch {
      setError("Could not remove all data. Make sure Research Atlas is online.");
    }
    setUninstalling(false);
  };

  const handleBackup = async () => {
    setBackingUp(true);
    setError(null);
    setBackupPath(null);
    try {
      const result = await backupResearchAtlasData();
      setBackupPath(result.path);
    } catch {
      setError("Backup failed. Make sure Research Atlas is online.");
    }
    setBackingUp(false);
  };

  const handleRemoveApp = async () => {
    const result = await removeApplicationAfterQuit();
    if (!result.ok) {
      setError(result.message);
    }
  };

  const openRemoveAllModal = () => {
    setRemoveAllConfirm("");
    setShowRemoveAllModal(true);
  };

  if (uninstalled) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-6 text-center px-6">
        <div className="w-16 h-16 rounded-full bg-green-500/20 border border-green-500/30 flex items-center justify-center">
          <Check size={28} className="text-green-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-100 mb-2">Removal complete</h2>
          <p className="text-gray-400 text-sm">Research Atlas data has been removed from this computer.</p>
          <p className="text-gray-500 text-xs mt-2">
            Use &quot;Remove application&quot; below to move Research Atlas to the Trash, or delete it
            from Applications yourself.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 justify-center">
          <button type="button" onClick={() => setUninstalled(false)} className="btn-secondary text-sm">
            Back
          </button>
          <button type="button" onClick={handleRemoveApp} className="btn-danger text-sm">
            <Power size={14} /> Remove application
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-red-500/20 bg-red-500/5 px-6 py-4 uninstall-banner">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-red-500/20 flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={18} className="text-red-400 uninstall-accent" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-red-300 uninstall-heading">Uninstall Research Atlas</h1>
            <p className="text-xs text-red-400/70 uninstall-subheading">
              Back up or remove all data, then delete the application. To remove a single folder, use
              Settings → Components.
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl space-y-6">
          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">
              {error}
            </div>
          )}

          {backupPath && (
            <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30 text-xs text-green-300">
              Backup saved to: <span className="font-mono break-all">{backupPath}</span>
            </div>
          )}

          <div className="card border border-surface-border">
            <h2 className="text-sm font-semibold text-gray-100 mb-2">Quick actions</h2>
            <p className="text-xs text-gray-400 mb-4">
              These actions affect your entire Research Atlas installation. Individual folders and
              models are managed under{" "}
              <span className="text-gray-300 font-medium">Settings → Components</span>.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleBackup}
                disabled={backingUp}
                className="btn-secondary text-sm"
              >
                {backingUp ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Download size={14} />
                )}
                Back up data
              </button>
              <button type="button" onClick={openRemoveAllModal} className="btn-danger text-sm">
                <Trash2 size={14} />
                Remove all Research Atlas data…
              </button>
              <button type="button" onClick={handleRemoveApp} className="btn-secondary text-sm">
                <Power size={14} />
                Remove application
              </button>
            </div>
          </div>
        </div>
      </div>

      {showRemoveAllModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md bg-surface-raised border border-red-500/30 rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-surface-border">
              <h2 className="text-sm font-semibold text-red-300">Remove everything</h2>
            </div>
            <div className="p-5 space-y-4">
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-gray-300 space-y-2">
                <p>This will delete:</p>
                <ul className="list-disc list-inside text-gray-400 space-y-1">
                  <li>All Research Atlas data in ~/.research_atlas</li>
                  <li>Isolated Python environment</li>
                  <li>Ollama application (if installed via the app)</li>
                  <li>All files in ~/.ollama (may affect other apps using Ollama)</li>
                </ul>
              </div>
              <p className="text-xs text-gray-400">
                Type <span className="font-mono font-bold text-red-400">REMOVE ALL</span> to confirm:
              </p>
              <input
                type="text"
                className="input border-red-500/30 focus:ring-red-500"
                value={removeAllConfirm}
                onChange={(e) => setRemoveAllConfirm(e.target.value)}
                placeholder="REMOVE ALL"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowRemoveAllModal(false)}
                  className="btn-secondary flex-1 justify-center"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleRemoveAll}
                  disabled={!canRemoveAll || uninstalling}
                  className="btn-danger flex-1 justify-center"
                >
                  {uninstalling ? <Loader2 size={14} className="animate-spin" /> : "Remove all"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
