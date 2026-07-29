/**
 * `useFileExplorer` — view mode + selection + drag state for the
 * `<FileExplorer />` orchestrator.
 *
 * Wraps `useFileBrowser` (the existing list-fetching hook) and
 * layers on top:
 *   - view mode (list | grid)
 *   - selected item ids (single-select; multi-select deferred to v2)
 *   - drag-drop state (what's being dragged, what target it's over)
 *   - context-menu target (which item the right-click was on)
 *
 * Why a separate hook:
 *   - `<FileExplorer />` is the visible orchestrator, but the
 *     headless state machine is testable in isolation.
 *   - Consumers who want only the data (no UI) can use this hook
 *     and roll their own toolbar + render.
 *
 * Architecture:
 *   - Pure local state via `useReducer`; no globals, no zustand.
 *   - View mode persists across parentId changes (kept in a ref).
 *   - Selection clears when parentId changes (new folder = fresh
 *     selection).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { useFileBrowser } from "./use-file-browser";
import type { FileNode, TenantId } from "file-next";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ViewMode = "list" | "grid";

export interface UseFileExplorerOptions {
  /** List callback (injected). */
  readonly listFiles: Parameters<typeof useFileBrowser>[0]["listFiles"];
  /** Tenant scope. */
  readonly tenantId: TenantId;
  /** Current folder (null = root). */
  readonly parentId: string | null;
  /** Initial view mode. Default: "list". */
  readonly initialView?: ViewMode;
  /** Auto-fetch on mount. Default: true (the explorer expects data). */
  readonly autoFetch?: boolean;
  /** Optional callback fired when the user picks a file/folder via click or keyboard. */
  readonly onActivate?: (file: FileNode) => void;
  readonly onMove?: (input: {
    itemIds: ReadonlyArray<string>;
    destinationFolderId: string;
  }) => Promise<void> | void;
}

export interface UseFileExplorerReturn {
  readonly status: ReturnType<typeof useFileBrowser>["status"];
  readonly files: ReadonlyArray<FileNode>;
  readonly error: ReturnType<typeof useFileBrowser>["error"];
  readonly refetch: () => Promise<void>;

  readonly view: ViewMode;
  readonly setView: (v: ViewMode) => void;

  readonly selectedId: string | null;
  readonly setSelected: (id: string | null) => void;

  // Context menu target — set by the consumer's onContextMenu handler.
  readonly contextTarget: FileNode | null;
  readonly openContextMenu: (file: FileNode | null) => void;

  // Drag-drop state. The consumer wires `onDragStart` to call
  // beginDrag and `onDragOver`/`onDragLeave` on drop targets to
  // call setDropTarget. The orchestrator calls `endDrag` on
  // drop or escape.
  readonly draggingId: string | null;
  readonly dropTargetId: string | null;
  readonly beginDrag: (id: string) => void;
  readonly setDropTarget: (id: string | null) => void;
  readonly commitDrop: (destinationFolderId: string) => void;
  readonly endDrag: () => void;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface State {
  view: ViewMode;
  selectedId: string | null;
  contextTarget: FileNode | null;
  draggingId: string | null;
  dropTargetId: string | null;
}

type Action =
  | { type: "SET_VIEW"; view: ViewMode }
  | { type: "SELECT"; id: string | null }
  | { type: "OPEN_CONTEXT"; file: FileNode | null }
  | { type: "BEGIN_DRAG"; id: string }
  | { type: "SET_DROP_TARGET"; id: string | null }
  | { type: "END_DRAG" };

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case "SET_VIEW":
      return { ...state, view: action.view };
    case "SELECT":
      return { ...state, selectedId: action.id };
    case "OPEN_CONTEXT":
      return { ...state, contextTarget: action.file };
    case "BEGIN_DRAG":
      return { ...state, draggingId: action.id, dropTargetId: null };
    case "SET_DROP_TARGET":
      return { ...state, dropTargetId: action.id };
    case "END_DRAG":
      return { ...state, draggingId: null, dropTargetId: null };
  }
};

const initialState = (initialView: ViewMode): State => ({
  view: initialView,
  selectedId: null,
  contextTarget: null,
  draggingId: null,
  dropTargetId: null,
});

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useFileExplorer(
  options: UseFileExplorerOptions,
): UseFileExplorerReturn {
  const {
    listFiles,
    tenantId,
    parentId,
    initialView = "list",
    autoFetch = true,
    onActivate,
    onMove,
  } = options;

  const [state, dispatch] = useReducer(reducer, initialView, initialState);

  // Reset selection / context target / drag when the folder changes.
  const lastParentId = useRef<string | null>(parentId);
  useEffect(() => {
    if (lastParentId.current !== parentId) {
      lastParentId.current = parentId;
      dispatch({ type: "SELECT", id: null });
      dispatch({ type: "OPEN_CONTEXT", file: null });
      dispatch({ type: "END_DRAG" });
    }
  }, [parentId]);

  const { status, files, error, refetch } = useFileBrowser({
    listFiles,
    tenantId,
    parentId,
    autoFetch,
  });

  const setView = useCallback((view: ViewMode) => {
    dispatch({ type: "SET_VIEW", view });
  }, []);

  const setSelected = useCallback((id: string | null) => {
    dispatch({ type: "SELECT", id });
    if (id && onActivate) {
      const file = files.find((f: FileNode) => f.id === id);
      if (file) onActivate(file);
    }
  }, [files, onActivate]);

  const openContextMenu = useCallback((file: FileNode | null) => {
    dispatch({ type: "OPEN_CONTEXT", file });
  }, []);

  const beginDrag = useCallback((id: string) => {
    dispatch({ type: "BEGIN_DRAG", id });
  }, []);

  const setDropTarget = useCallback((id: string | null) => {
    dispatch({ type: "SET_DROP_TARGET", id });
  }, []);

  const commitDrop = useCallback((destinationFolderId: string) => {
    const destination = files.find((file) => file.id === destinationFolderId);
    if (
      state.draggingId &&
      destination?.kind === "folder" &&
      state.draggingId !== destinationFolderId
    ) {
      void onMove?.({
        itemIds: [state.draggingId],
        destinationFolderId,
      });
    }
    dispatch({ type: "END_DRAG" });
  }, [files, onMove, state.draggingId]);

  const endDrag = useCallback(() => {
    dispatch({ type: "END_DRAG" });
  }, []);

  return useMemo(
    () => ({
      status,
      files,
      error,
      refetch,
      view: state.view,
      setView,
      selectedId: state.selectedId,
      setSelected,
      contextTarget: state.contextTarget,
      openContextMenu,
      draggingId: state.draggingId,
      dropTargetId: state.dropTargetId,
      beginDrag,
      setDropTarget,
      commitDrop,
      endDrag,
    }),
    [
      status,
      files,
      error,
      refetch,
      state.view,
      state.selectedId,
      state.contextTarget,
      state.draggingId,
      state.dropTargetId,
      setView,
      setSelected,
      openContextMenu,
      beginDrag,
      setDropTarget,
      commitDrop,
      endDrag,
    ],
  );
}
