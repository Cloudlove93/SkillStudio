import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  createWorkspaceInspectorState,
  parseInspectorSearch,
  requiresInspectorCloseConfirmation,
  workspaceInspectorReducer,
  writeInspectorSearch,
  type InspectorDescriptor,
  type InspectorOwner,
  type WorkspaceInspectorState,
} from './workspace-inspector-state';

const INSPECTOR_WIDTH_KEY = 'eduskill:workspace-inspector:v1';
const MIN_INSPECTOR_WIDTH = 320;
const MAX_INSPECTOR_WIDTH = 520;
const DEFAULT_INSPECTOR_WIDTH = 384;

type CloseInspectorOptions = { force?: boolean };

type WorkspaceInspectorController = {
  state: WorkspaceInspectorState;
  outlet: HTMLElement | null;
  width: number;
  setOutlet: (outlet: HTMLElement | null) => void;
  setWidth: (width: number) => void;
  openInspector: (descriptor: InspectorDescriptor) => void;
  closeInspector: (options?: CloseInspectorOptions) => boolean;
  setInspectorDirty: (dirty: boolean) => void;
  toggleInspectorFullscreen: () => void;
  clearInspectorOwner: (owner: InspectorOwner) => void;
};

const WorkspaceInspectorContext =
  createContext<WorkspaceInspectorController | null>(null);

function clampWidth(width: number) {
  return Math.min(
    MAX_INSPECTOR_WIDTH,
    Math.max(MIN_INSPECTOR_WIDTH, Math.round(width)),
  );
}

function readStoredWidth() {
  if (typeof localStorage === 'undefined') return DEFAULT_INSPECTOR_WIDTH;
  const storedWidth = localStorage.getItem(INSPECTOR_WIDTH_KEY);
  if (storedWidth === null) return DEFAULT_INSPECTOR_WIDTH;
  const parsed = Number(storedWidth);
  return Number.isFinite(parsed) ? clampWidth(parsed) : DEFAULT_INSPECTOR_WIDTH;
}

export function WorkspaceInspectorProvider({
  children,
}: {
  children: ReactNode;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [state, dispatch] = useReducer(
    workspaceInspectorReducer,
    undefined,
    () => {
      const initial = createWorkspaceInspectorState();
      const descriptor = parseInspectorSearch(location.search);
      return descriptor
        ? workspaceInspectorReducer(initial, { type: 'open', descriptor })
        : initial;
    },
  );
  const [outlet, setOutlet] = useState<HTMLElement | null>(null);
  const [width, setWidthState] = useState(readStoredWidth);
  const locationRef = useRef(location);
  const stateRef = useRef(state);

  useEffect(() => {
    locationRef.current = location;
  }, [location]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const replaceInspectorSearch = useCallback(
    (descriptor: InspectorDescriptor | null) => {
      const currentLocation = locationRef.current;
      navigate(
        {
          pathname: currentLocation.pathname,
          search: writeInspectorSearch(currentLocation.search, descriptor),
          hash: currentLocation.hash,
        },
        { replace: true },
      );
    },
    [navigate],
  );

  useEffect(() => {
    const descriptor = parseInspectorSearch(location.search);
    dispatch(descriptor ? { type: 'open', descriptor } : { type: 'close' });
  }, [location.search]);

  const setWidth = useCallback((nextWidth: number) => {
    const clamped = clampWidth(nextWidth);
    setWidthState(clamped);
    try {
      localStorage.setItem(INSPECTOR_WIDTH_KEY, String(clamped));
    } catch {
      // The visual preference is optional; private browsing may reject storage.
    }
  }, []);

  const openInspector = useCallback(
    (descriptor: InspectorDescriptor) => {
      if (descriptor.preferredWidth) setWidth(descriptor.preferredWidth);
      dispatch({ type: 'open', descriptor });
      replaceInspectorSearch(descriptor);
    },
    [replaceInspectorSearch, setWidth],
  );

  const closeInspector = useCallback(
    (options?: CloseInspectorOptions) => {
      if (
        !options?.force &&
        requiresInspectorCloseConfirmation(stateRef.current)
      )
        return false;
      dispatch({ type: 'close' });
      replaceInspectorSearch(null);
      return true;
    },
    [replaceInspectorSearch],
  );

  const setInspectorDirty = useCallback((dirty: boolean) => {
    dispatch({ type: 'set-dirty', dirty });
  }, []);

  const toggleInspectorFullscreen = useCallback(() => {
    dispatch({ type: 'toggle-fullscreen' });
  }, []);

  const clearInspectorOwner = useCallback(
    (owner: InspectorOwner) => {
      if (stateRef.current.descriptor?.owner !== owner) return;
      dispatch({ type: 'clear-owner', owner });
      replaceInspectorSearch(null);
    },
    [replaceInspectorSearch],
  );

  const value = useMemo<WorkspaceInspectorController>(
    () => ({
      state,
      outlet,
      width,
      setOutlet,
      setWidth,
      openInspector,
      closeInspector,
      setInspectorDirty,
      toggleInspectorFullscreen,
      clearInspectorOwner,
    }),
    [
      clearInspectorOwner,
      closeInspector,
      openInspector,
      outlet,
      setInspectorDirty,
      setWidth,
      state,
      toggleInspectorFullscreen,
      width,
    ],
  );

  return (
    <WorkspaceInspectorContext.Provider value={value}>
      {children}
    </WorkspaceInspectorContext.Provider>
  );
}

export function useWorkspaceInspector() {
  const value = useContext(WorkspaceInspectorContext);
  if (!value) {
    throw new Error(
      'useWorkspaceInspector must be used inside WorkspaceInspectorProvider',
    );
  }
  return value;
}
