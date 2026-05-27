import { useState } from "react";
import { Star, Download, Trash2, Check, Cpu, Zap } from "lucide-react";
import clsx from "clsx";
import type { OllamaModel } from "../../api/client";

interface ModelCardProps {
  model: OllamaModel;
  installProgress?: number;
  onInstall?: (name: string) => void;
  onRemove?: (name: string) => void;
  onSetActive?: (name: string, type: "llm" | "embedding") => void;
}

export function ModelCard({
  model,
  installProgress,
  onInstall,
  onRemove,
  onSetActive,
}: ModelCardProps) {
  const [confirmRemove, setConfirmRemove] = useState(false);
  const isInstalling = installProgress !== undefined && installProgress < 100;

  const renderStars = (count: number) =>
    Array.from({ length: 5 }).map((_, i) => (
      <Star
        key={i}
        size={11}
        className={i < count ? "text-yellow-400 fill-yellow-400" : "text-gray-700"}
      />
    ));

  const renderBar = (value: number, color: string) => (
    <div className="progress-bar w-full">
      <div
        className={clsx("progress-fill", color)}
        style={{ width: `${value}%` }}
      />
    </div>
  );

  return (
    <div
      className={clsx(
        "card border relative flex flex-col gap-3 transition-all duration-150",
        model.active
          ? "border-primary-500/50 bg-primary-500/5"
          : model.recommended
          ? "border-accent-500/30"
          : "border-surface-border hover:border-surface-overlay"
      )}
    >
      {/* Badges */}
      <div className="absolute top-3 right-3 flex gap-1.5">
        {model.recommended && (
          <span className="tag bg-accent-500/20 text-accent-500 border border-accent-500/30 text-[10px]">
            Recommended
          </span>
        )}
        {model.active && (
          <span className="tag bg-primary-500/20 text-primary-400 border border-primary-500/30 text-[10px]">
            Active
          </span>
        )}
      </div>

      {/* Header */}
      <div className="pr-24">
        <h3 className="text-sm font-semibold text-gray-100">{model.display_name}</h3>
        <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{model.description}</p>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-3 text-xs text-gray-500">
        <span className="tag bg-surface-overlay border border-surface-border text-gray-400">
          {model.size_gb.toFixed(1)} GB
        </span>
        <span className="text-gray-600">·</span>
        <span>{model.family}</span>
        <span className="text-gray-600">·</span>
        <span>{model.best_for}</span>
      </div>

      {/* Performance bars */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <Cpu size={11} className="text-gray-500" />
            <span className="text-xs text-gray-500">CPU Speed</span>
            <span className="ml-auto text-xs text-gray-400 font-mono">{model.cpu_speed}%</span>
          </div>
          {renderBar(model.cpu_speed, "bg-blue-500")}
        </div>
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <Zap size={11} className="text-gray-500" />
            <span className="text-xs text-gray-500">GPU Speed</span>
            <span className="ml-auto text-xs text-gray-400 font-mono">{model.gpu_speed}%</span>
          </div>
          {renderBar(model.gpu_speed, "bg-purple-500")}
        </div>
      </div>

      {/* Quality stars */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500">Quality</span>
        <div className="flex gap-0.5">{renderStars(model.quality)}</div>
      </div>

      {/* Install progress bar */}
      {isInstalling && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-400">Downloading...</span>
            <span className="text-xs font-mono text-primary-400">{installProgress}%</span>
          </div>
          <div className="progress-bar">
            <div
              className="progress-fill bg-primary-500 transition-all duration-500"
              style={{ width: `${installProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 pt-1">
        {!model.installed ? (
          <button
            onClick={() => onInstall?.(model.name)}
            disabled={isInstalling}
            className="btn-primary flex-1 text-xs py-1.5 justify-center"
          >
            <Download size={13} />
            {isInstalling ? `Installing ${installProgress}%` : "Install"}
          </button>
        ) : (
          <>
            {!model.active && (
              <button
                onClick={() => onSetActive?.(model.name, model.type)}
                className="btn-secondary flex-1 text-xs py-1.5 justify-center"
              >
                <Check size={13} />
                Use this model
              </button>
            )}
            {model.active && (
              <div className="flex-1 flex items-center justify-center gap-1.5 text-xs text-primary-400 py-1.5 bg-primary-500/10 rounded-lg border border-primary-500/20">
                <Check size={13} />
                Currently active
              </div>
            )}
            {confirmRemove ? (
              <div className="flex gap-1">
                <button
                  onClick={() => { onRemove?.(model.name); setConfirmRemove(false); }}
                  className="btn-danger text-xs py-1.5 px-2"
                >
                  Confirm
                </button>
                <button
                  onClick={() => setConfirmRemove(false)}
                  className="btn-secondary text-xs py-1.5 px-2"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmRemove(true)}
                className="btn-ghost text-xs py-1.5 px-2 text-red-500 hover:bg-red-500/10"
              >
                <Trash2 size={13} />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
