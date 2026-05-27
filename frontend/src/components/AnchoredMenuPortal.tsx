import { useLayoutEffect, useState, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";

type Align = "end" | "start";

interface AnchoredMenuPortalProps {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
  /** Pixel width, or match the anchor element width */
  width?: number | "anchor";
  align?: Align;
  className?: string;
}

export function AnchoredMenuPortal({
  open,
  anchorRef,
  onClose,
  children,
  width = 224,
  align = "end",
  className,
}: AnchoredMenuPortalProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({
    position: "fixed",
    visibility: "hidden",
  });

  useLayoutEffect(() => {
    if (!open) return;

    const place = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;

      const rect = anchor.getBoundingClientRect();
      const margin = 8;
      const menuHeight = menuRef.current?.offsetHeight ?? 240;
      const menuWidth = width === "anchor" ? rect.width : width;

      let left = align === "end" ? rect.right - menuWidth : rect.left;
      left = Math.max(margin, Math.min(left, window.innerWidth - menuWidth - margin));

      let top = rect.bottom + 4;
      if (top + menuHeight > window.innerHeight - margin) {
        top = Math.max(margin, rect.top - menuHeight - 4);
      }

      setStyle({
        position: "fixed",
        top,
        left,
        width: menuWidth,
        zIndex: 10_000,
        visibility: "visible",
      });
    };

    place();
    const raf = requestAnimationFrame(place);

    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);

    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(place) : null;
    if (ro && menuRef.current) ro.observe(menuRef.current);
    if (ro && anchorRef.current) ro.observe(anchorRef.current);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      ro?.disconnect();
    };
  }, [open, width, align, anchorRef]);

  if (!open) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[9999]" aria-hidden onClick={onClose} />
      <div
        ref={menuRef}
        role="menu"
        style={style}
        className={clsx(
          "rounded-xl border border-surface-border bg-surface-raised shadow-xl py-1",
          className,
        )}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
