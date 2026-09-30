import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { useWorkspaceInspector } from './WorkspaceInspectorProvider';
import type { InspectorOwner } from './workspace-inspector-state';

export function InspectorPortal({
  owner,
  children,
}: {
  owner: InspectorOwner;
  children: ReactNode;
}) {
  const { outlet, state } = useWorkspaceInspector();
  if (!outlet || !state.open || state.descriptor?.owner !== owner) return null;
  return createPortal(children, outlet);
}

