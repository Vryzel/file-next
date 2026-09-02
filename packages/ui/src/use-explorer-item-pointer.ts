"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FileNode } from "./types";

const LONG_PRESS_MS = 450;
const MOVE_CANCEL_PX = 10;

export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(pointer: coarse)");
    const sync = () => setCoarse(mql.matches);
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, []);

  return coarse;
}

export function useExplorerItemPointer(opts: {
  file: FileNode;
  coarse: boolean;
  onSelect: (file: FileNode, event: { shiftKey: boolean }) => void;
  onActivate: (file: FileNode) => void;
}): {
  onPointerDown: (event: React.PointerEvent) => void;
  onClick: (event: React.MouseEvent) => void;
  onDoubleClick: () => void;
} {
  const timer = useRef(0);
  const start = useRef({ x: 0, y: 0 });
  const didLongPress = useRef(false);
  const detach = useRef<(() => void) | null>(null);
  const { file, coarse, onSelect, onActivate } = opts;

  const clear = useCallback(() => {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = 0;
    }
    detach.current?.();
    detach.current = null;
  }, []);

  useEffect(() => () => clear(), [clear]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (!coarse || event.pointerType !== "touch") return;
      didLongPress.current = false;
      start.current = { x: event.clientX, y: event.clientY };
      clear();
      timer.current = window.setTimeout(() => {
        didLongPress.current = true;
        onSelect(file, { shiftKey: false });
      }, LONG_PRESS_MS);

      const onMove = (move: PointerEvent) => {
        const dx = move.clientX - start.current.x;
        const dy = move.clientY - start.current.y;
        if (dx * dx + dy * dy > MOVE_CANCEL_PX * MOVE_CANCEL_PX) clear();
      };
      const onEnd = () => clear();
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onEnd);
      window.addEventListener("pointercancel", onEnd);
      detach.current = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onEnd);
        window.removeEventListener("pointercancel", onEnd);
      };
    },
    [clear, coarse, file, onSelect],
  );

  const onClick = useCallback(
    (event: React.MouseEvent) => {
      if (event.detail > 1) return;
      event.stopPropagation();
      if (didLongPress.current) {
        didLongPress.current = false;
        return;
      }
      if (coarse) {
        onActivate(file);
        return;
      }
      onSelect(file, event);
    },
    [coarse, file, onActivate, onSelect],
  );

  const onDoubleClick = useCallback(() => {
    if (!coarse) onActivate(file);
  }, [coarse, file, onActivate]);

  return { onPointerDown, onClick, onDoubleClick };
}
