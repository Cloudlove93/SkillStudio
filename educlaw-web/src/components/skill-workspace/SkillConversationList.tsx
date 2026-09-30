import { useState } from 'react';
import type { ArenaThread } from '@educlaw/shared';
import { Loader2, MoreHorizontal, PencilLine, Plus, Trash2 } from 'lucide-react';
import { getConversationSurface, getConversationTitle, getSurfaceLabel } from './skill-conversation-list';
import { SkillContextMenu } from './SkillContextMenu';

const DEFAULT_TITLE_PREFIXES = ['Skill Arena:', 'Skill 使用：', 'Skill 测试：', 'Skill 优化：'];

type Props = {
  conversations: ArenaThread[];
  selectedConversationId: string | null;
  runningConversationId?: string | null;
  completedConversationIds?: ReadonlySet<string>;
  loading?: boolean;
  onConversationSelect: (id: string) => void;
  onNewConversation: () => void;
  onRename: (thread: ArenaThread, title: string) => Promise<void> | void;
  onDelete: (thread: ArenaThread) => Promise<void> | void;
};

export function SkillConversationList({
  conversations,
  selectedConversationId,
  runningConversationId = null,
  completedConversationIds,
  loading = false,
  onConversationSelect,
  onNewConversation,
  onRename,
  onDelete,
}: Props) {
  const [menu, setMenu] = useState<{ thread: ArenaThread; x: number; y: number } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  const beginRename = (thread: ArenaThread) => {
    setMenu(null);
    setEditingId(String(thread.id));
    const isDefaultTitle = DEFAULT_TITLE_PREFIXES.some((prefix) => thread.title.startsWith(prefix));
    setEditingTitle(isDefaultTitle ? '' : thread.title);
  };

  const submitRename = async (thread: ArenaThread) => {
    await onRename(thread, getConversationTitle(editingTitle));
    setEditingId(null);
  };

  return (
    <section className="skill-conversation-list" aria-label="Skill 对话">
      {loading ? <div className="skill-conversation-empty">正在加载…</div> : null}
      {!loading && conversations.length === 0 ? (
        <div className="skill-conversation-empty">还没有对话</div>
      ) : null}
      <div className="skill-conversation-items">
        {conversations.map((thread) => {
          const id = String(thread.id);
          const selected = id === selectedConversationId;
          const editing = editingId === id;
          const isRunning = id === runningConversationId;
          const isComplete = completedConversationIds?.has(id) ?? false;
          const status = isRunning ? 'running' : isComplete ? 'complete' : null;
          const surface = getConversationSurface(thread);
          const surfaceLabel = getSurfaceLabel(surface);
          return (
            <div
              className={`skill-conversation-item ${selected ? 'is-selected' : ''}`}
              key={id}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ thread, x: event.clientX, y: event.clientY });
              }}
            >
              {editing ? (
                <input
                  autoFocus
                  value={editingTitle}
                  maxLength={32}
                  onChange={(event) => setEditingTitle(event.target.value)}
                  onBlur={() => void submitRename(thread)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') { event.preventDefault(); void submitRename(thread); }
                    if (event.key === 'Escape') setEditingId(null);
                  }}
                />
              ) : (
                <>
                  <button type="button" className="skill-conversation-item-main" onClick={() => onConversationSelect(id)}>
                    <span className="skill-conversation-item-head">
                      {surfaceLabel ? (
                        <span className={`skill-conversation-badge is-${surface}`} title={`${surfaceLabel}会话`}>{surfaceLabel}</span>
                      ) : null}
                      <span className="skill-conversation-item-name">
                        {thread.title === 'New Arena Conversation' ? '新建对话' : thread.title}
                      </span>
                    </span>
                  </button>
                  <span
                    className={`skill-conversation-status-slot ${status ? 'has-status' : ''}`}
                    aria-label={status === 'running' ? '运行中' : status === 'complete' ? '运行完成' : undefined}
                    aria-hidden={status ? undefined : true}
                  >
                    {status === 'running' ? (
                      <span className="skill-conversation-status-icon is-running">
                        <Loader2 size={12} aria-hidden="true" />
                      </span>
                    ) : status === 'complete' ? (
                      <span className="skill-conversation-status-icon is-complete">
                        <span aria-hidden="true" />
                      </span>
                    ) : null}
                  </span>
                </>
              )}
              <button
                type="button"
                className="skill-conversation-more"
                title="更多操作"
                aria-label="更多操作"
                onClick={(event) => {
                  event.stopPropagation();
                  setMenu({ thread, x: event.clientX, y: event.clientY });
                }}
              >
                <MoreHorizontal size={14} />
              </button>
            </div>
          );
        })}
      </div>
      <button type="button" className="skill-conversation-new-row" onClick={onNewConversation}>
        <Plus size={13} />
        <span>新建对话</span>
      </button>
      {menu ? (
        <SkillContextMenu
          x={menu.x}
          y={menu.y}
          items={[
            { id: 'rename', label: '重命名', icon: PencilLine },
            { id: 'delete', label: '删除', icon: Trash2, destructive: true, separatorBefore: true },
          ]}
          onClose={() => setMenu(null)}
          onSelect={(action) => {
            const thread = menu.thread;
            setMenu(null);
            if (action === 'rename') beginRename(thread);
            if (action === 'delete') void onDelete(thread);
          }}
        />
      ) : null}
    </section>
  );
}
