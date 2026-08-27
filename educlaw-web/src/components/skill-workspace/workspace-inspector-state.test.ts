import { describe, expect, it } from 'vitest';
import {
  createWorkspaceInspectorState,
  parseInspectorSearch,
  requiresInspectorCloseConfirmation,
  workspaceInspectorReducer,
  writeInspectorSearch,
} from './workspace-inspector-state';

const transcript = {
  owner: 'multimodal' as const,
  view: 'multimodal-transcript' as const,
  title: '完整转录',
};

describe('workspace inspector state', () => {
  it('opens, replaces and closes a lightweight descriptor', () => {
    const opened = workspaceInspectorReducer(createWorkspaceInspectorState(), {
      type: 'open',
      descriptor: transcript,
    });
    const replaced = workspaceInspectorReducer(opened, {
      type: 'open',
      descriptor: {
        ...transcript,
        view: 'multimodal-evidence',
        title: '证据库',
      },
    });
    const closed = workspaceInspectorReducer(replaced, { type: 'close' });

    expect(opened.open).toBe(true);
    expect(replaced.descriptor?.view).toBe('multimodal-evidence');
    expect(closed.open).toBe(false);
    expect(closed.descriptor).toBeNull();
  });

  it('requires confirmation only for a dirty open panel', () => {
    const dirty = workspaceInspectorReducer(
      workspaceInspectorReducer(createWorkspaceInspectorState(), {
        type: 'open',
        descriptor: transcript,
      }),
      { type: 'set-dirty', dirty: true },
    );

    expect(requiresInspectorCloseConfirmation(dirty)).toBe(true);
    expect(
      requiresInspectorCloseConfirmation(createWorkspaceInspectorState()),
    ).toBe(false);
  });

  it('round-trips safe inspector query state and rejects unknown views', () => {
    const search = writeInspectorSearch('?tab=skills', {
      ...transcript,
      itemId: 'segment-9',
    });

    expect(search).toContain('inspector=multimodal%3Amultimodal-transcript');
    expect(search).toContain('tab=skills');
    expect(parseInspectorSearch(search)).toEqual({
      ...transcript,
      itemId: 'segment-9',
    });
    expect(parseInspectorSearch('?inspector=multimodal%3Aunknown')).toBeNull();
  });

  it('clears only the matching owner and preserves unrelated query values', () => {
    const opened = workspaceInspectorReducer(createWorkspaceInspectorState(), {
      type: 'open',
      descriptor: transcript,
    });
    const unchanged = workspaceInspectorReducer(opened, {
      type: 'clear-owner',
      owner: 'skill',
    });
    const cleared = workspaceInspectorReducer(unchanged, {
      type: 'clear-owner',
      owner: 'multimodal',
    });

    expect(unchanged).toBe(opened);
    expect(cleared).toEqual(createWorkspaceInspectorState());
    expect(writeInspectorSearch('?tab=skills&foo=bar', null)).toBe(
      '?tab=skills&foo=bar',
    );
  });

  it('drops a previous owner item when another owner takes over', () => {
    const multimodal = workspaceInspectorReducer(
      createWorkspaceInspectorState(),
      {
        type: 'open',
        descriptor: { ...transcript, itemId: 'segment-9' },
      },
    );
    const repository = workspaceInspectorReducer(multimodal, {
      type: 'open',
      descriptor: {
        owner: 'repository',
        view: 'repository-selection',
        title: '仓库摘要',
      },
    });

    expect(repository.descriptor?.owner).toBe('repository');
    expect(repository.descriptor?.itemId).toBeUndefined();
    expect(
      writeInspectorSearch(
        '?tab=skills&inspectorItem=stale',
        repository.descriptor,
      ),
    ).toBe('?tab=skills&inspector=repository%3Arepository-selection');
  });
});
