import {
  useState,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import {
  Maximize2,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';
import { DiscardInspectorChangesDialog } from './DiscardInspectorChangesDialog';
import type { InspectorDescriptor } from './workspace-inspector-state';
import {
  SkillFunctionLauncher,
  type SkillNavigation,
} from './SkillFunctionLauncher';
import { useWorkspaceInspector } from './WorkspaceInspectorProvider';

type ResizeGesture = { pointerId: number; startX: number; startWidth: number };

export function WorkspaceInspector({
  defaultDescriptor,
  skillNavigation,
}: {
  defaultDescriptor: InspectorDescriptor;
  skillNavigation?: SkillNavigation;
}) {
  const {
    state,
    width,
    setWidth,
    setOutlet,
    openInspector,
    closeInspector,
    toggleInspectorFullscreen,
  } = useWorkspaceInspector();
  const resizeGesture = useRef<ResizeGesture | null>(null);
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

  const requestClose = () => {
    if (closeInspector()) return;
    setConfirmCloseOpen(true);
  };

  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    resizeGesture.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: width,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const continueResize = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = resizeGesture.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    setWidth(gesture.startWidth + gesture.startX - event.clientX);
  };

  const stopResize = (event: PointerEvent<HTMLDivElement>) => {
    if (resizeGesture.current?.pointerId !== event.pointerId) return;
    resizeGesture.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    setWidth(width + (event.key === 'ArrowLeft' ? 16 : -16));
  };

  const inspectorStyle = {
    '--workspace-inspector-width': `${width}px`,
  } as CSSProperties;

  return (
    <>
    <aside
      className={`skill-context workspace-inspector ${state.open ? 'is-open' : 'is-collapsed'} ${state.fullscreen ? 'is-fullscreen' : ''}`}
      style={inspectorStyle}
      aria-label={
        state.open ? state.descriptor?.title || '详细信息' : '右侧工具栏'
      }
    >
      <div className="workspace-inspector-rail" aria-hidden={state.open}>
        {!state.open && skillNavigation ? (
          <SkillFunctionLauncher navigation={skillNavigation} />
        ) : null}
        <button
          className="skill-icon-button"
          type="button"
          onClick={() => openInspector(defaultDescriptor)}
          aria-label="展开右侧栏"
          title="展开右侧栏"
          tabIndex={state.open ? -1 : 0}
        >
          <PanelRightOpen size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="workspace-inspector-panel" aria-hidden={!state.open}>
        {state.open && !state.fullscreen && (
          <div
            className="workspace-inspector-resize"
            role="separator"
            aria-label="调整右侧栏宽度"
            aria-orientation="vertical"
            aria-valuemin={320}
            aria-valuemax={520}
            aria-valuenow={width}
            tabIndex={0}
            onKeyDown={resizeWithKeyboard}
            onPointerDown={startResize}
            onPointerMove={continueResize}
            onPointerUp={stopResize}
            onPointerCancel={stopResize}
          />
        )}
        <header className="workspace-inspector-header">
          <div>
            <span className="skill-eyebrow">详细信息</span>
            <h2>{state.descriptor?.title || '当前任务'}</h2>
            {state.descriptor?.description && (
              <p>{state.descriptor.description}</p>
            )}
          </div>
          <div className="workspace-inspector-actions">
            <button
              className="skill-icon-button"
              type="button"
              onClick={toggleInspectorFullscreen}
              aria-label={state.fullscreen ? '退出全屏' : '全屏查看右侧栏'}
              title={state.fullscreen ? '退出全屏' : '全屏查看右侧栏'}
            >
              {state.fullscreen ? (
                <Minimize2 size={16} aria-hidden="true" />
              ) : (
                <Maximize2 size={16} aria-hidden="true" />
              )}
            </button>
            <button
              className="skill-icon-button"
              type="button"
              onClick={requestClose}
              aria-label="收起右侧栏"
              title="收起右侧栏"
            >
              <PanelRightClose size={17} aria-hidden="true" />
            </button>
          </div>
        </header>
        <div
          ref={setOutlet}
          className="workspace-inspector-outlet"
          data-workspace-inspector-outlet
        />
      </div>
    </aside>
    {confirmCloseOpen ? (
      <DiscardInspectorChangesDialog
        onCancel={() => setConfirmCloseOpen(false)}
        onConfirm={() => {
          setConfirmCloseOpen(false);
          closeInspector({ force: true });
        }}
      />
    ) : null}
    </>
  );
}
