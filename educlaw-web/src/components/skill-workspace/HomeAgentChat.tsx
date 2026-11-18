import { Link } from 'react-router';
import type { AgentWorkspace, ArenaThread } from '@educlaw/shared';
import { MessageSquarePlus, Settings2 } from 'lucide-react';
import { AgentConversation } from '../agent-workspace/AgentConversation';
import { routes } from '../../lib/routes';
import '../agent-workspace/agent-workspace.css';
import './home-agent-chat.css';

/** 主页里的 Agent 对话：只保留名称、动作和消息本身。 */
export function HomeAgentChat({
  token,
  agent,
  thread,
  loading,
  creating,
  error,
  onNewConversation,
  onRetry,
}: {
  token: string;
  agent: AgentWorkspace | null;
  thread: ArenaThread | null;
  loading: boolean;
  creating: boolean;
  error: string;
  onNewConversation: () => void;
  onRetry: () => void;
}) {
  return (
    <section className="home-agent-chat" aria-label="Agent 对话">
      <header className="home-agent-chat-head">
        <div className="home-agent-chat-identity">
          <span className="home-agent-chat-avatar" aria-hidden="true">
            {(agent?.name.trim().slice(0, 1) || 'A').toUpperCase()}
          </span>
          <div>
            <h1>{agent?.name ?? '正在打开 Agent…'}</h1>
            {agent?.description ? <p>{agent.description}</p> : null}
          </div>
        </div>
        <div className="home-agent-chat-actions">
          <button
            type="button"
            onClick={onNewConversation}
            disabled={!agent || creating || loading}
          >
            <MessageSquarePlus size={15} />
            新对话
          </button>
          {agent ? (
            <Link to={routes.agent(agent.id)} title="打开装配台">
              <Settings2 size={15} />
              装配
            </Link>
          ) : null}
        </div>
      </header>
      {error ? (
        <div className="home-agent-chat-state" role="alert">
          <strong>对话暂时打不开</strong>
          <p>{error}</p>
          <button type="button" onClick={onRetry}>
            重新加载
          </button>
        </div>
      ) : !thread ? (
        <div className="home-agent-chat-state" role="status" aria-live="polite">
          <span className="home-agent-chat-spinner" aria-hidden="true" />
          <p>{creating ? '正在创建新对话…' : '正在准备对话…'}</p>
        </div>
      ) : (
        <AgentConversation
          key={`${agent?.id ?? 'agent'}:${thread.id}`}
          token={token}
          thread={thread}
        />
      )}
    </section>
  );
}
