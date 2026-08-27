import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ArenaThread, SkillVersionDetail } from '@educlaw/shared';
import { ArrowUp, Check, Loader2, Save, Sparkles } from 'lucide-react';
import { liteApi } from '../../api/lite-api';
import { MarkdownContent } from '../lite/lite-rendering';
import {
  createSkillOptimizeState,
  skillOptimizeReducer,
} from './skill-optimize-state';
import { ConversationTurnNavigation } from './ConversationTurnNavigation';
import { collectConversationTurns } from './conversation-turn-navigation';
import { getConversationTitle } from './skill-conversation-list';

type Props = {
  token: string;
  packageId: string;
  version: SkillVersionDetail | undefined;
  onSaved: (versionNumber: number) => void;
  onThreadCreated?: (thread: ArenaThread) => void;
};

function requestId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID)
    return crypto.randomUUID();
  return `skill-optimize-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function SkillOptimizeWorkspace({
  token,
  packageId,
  version,
  onSaved,
  onThreadCreated,
}: Props) {
  const [state, dispatch] = useReducer(
    skillOptimizeReducer,
    undefined,
    createSkillOptimizeState,
  );
  const [initializing, setInitializing] = useState(true);
  const sessionIdRef = useRef<string | undefined>(undefined);
  const threadIdRef = useRef<string | null>(null);
  const renamedRef = useRef(false);
  const onThreadCreatedRef = useRef(onThreadCreated);
  const messageListRef = useRef<HTMLDivElement>(null);
  const conversationTurns = useMemo(
    () =>
      collectConversationTurns(
        state.messages.map((message, index) => ({
          id: `optimize-${index}`,
          role: message.role,
          content: message.content,
        })),
      ),
    [state.messages],
  );

  useEffect(() => {
    onThreadCreatedRef.current = onThreadCreated;
  }, [onThreadCreated]);

  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      if (!version) {
        setInitializing(false);
        return;
      }
      try {
        const thread = await liteApi.createArenaThread(token, packageId, {
          idempotencyKey: requestId(),
          basePackageVersionId: version.createdInPackageVersionId,
          left: { skillId: version.skillId, skillVersionId: version.id },
          right: { skillId: version.skillId, skillVersionId: version.id },
          surface: 'optimize',
        });
        threadIdRef.current = String(thread.id);
        onThreadCreatedRef.current?.(thread);
        const diagnosis = await liteApi.diagnosePackage(
          token,
          packageId,
          String(thread.id),
          undefined,
          version.skill.dirName,
        );
        if (cancelled) return;
        sessionIdRef.current = diagnosis.session?.id
          ? String(diagnosis.session.id)
          : undefined;
        const skillIssues = diagnosis.issues.filter(
          (issue) => issue.target === 'skill',
        );
        const issueSummary = skillIssues.length
          ? `\n\n我先发现了 ${skillIssues.length} 个 Skill 层面的改进点：\n${skillIssues.map((issue, index) => `${index + 1}. ${issue.title}：${issue.suggestion}`).join('\n')}`
          : '';
        dispatch({
          type: 'initialize',
          content: `我已读取当前 v${version.versionNumber}。告诉我你希望改进的具体效果，我只会调整这个 Skill，不改动其他配置。${issueSummary}`,
        });
      } catch (error) {
        if (!cancelled) {
          dispatch({
            type: 'error',
            message: error instanceof Error ? error.message : 'Skill 分析失败',
          });
        }
      } finally {
        if (!cancelled) setInitializing(false);
      }
    }
    void initialize();
    return () => {
      cancelled = true;
    };
  }, [packageId, token, version]);

  const send = async () => {
    const content = state.draft.trim();
    if (!content || state.busy || initializing) return;
    const requestMessages = [
      ...state.messages,
      {
        role: 'user' as const,
        content: `只优化当前 Skill，不要修改 agent 或 rubric。用户要求：${content}`,
      },
    ];
    dispatch({ type: 'submit', content });
    if (threadIdRef.current && !renamedRef.current) {
      renamedRef.current = true;
      try {
        const renamed = await liteApi.renameArenaThread(
          token,
          packageId,
          threadIdRef.current,
          getConversationTitle(content),
        );
        onThreadCreated?.(renamed);
      } catch {
        // 标题为便捷元数据，重命名失败不应阻塞优化流程
      }
    }
    try {
      const result = await liteApi.chatOptimize(
        token,
        packageId,
        sessionIdRef.current,
        requestMessages,
        state.changes,
        undefined,
        version?.skill.dirName,
      );
      if (result.session?.id) sessionIdRef.current = String(result.session.id);
      dispatch({
        type: 'reply',
        content: result.reply,
        adoptions: result.newAdoptions.filter(
          (change) => change.target === 'skill',
        ),
      });
    } catch (error) {
      dispatch({
        type: 'error',
        message: error instanceof Error ? error.message : '优化对话失败',
      });
    }
  };

  const save = async () => {
    if (!state.changes.length || state.saving) return;
    dispatch({ type: 'saving' });
    try {
      const result = await liteApi.applyInteractiveChanges(
        token,
        packageId,
        sessionIdRef.current,
        state.changes,
        '通过 Skill 工作台交互式优化生成',
        version?.skill.dirName,
      );
      dispatch({ type: 'saved', versionNumber: result.versionNumber });
      onSaved(result.versionNumber);
    } catch (error) {
      dispatch({
        type: 'error',
        message: error instanceof Error ? error.message : '保存优化版本失败',
      });
    }
  };

  return (
    <div className="skill-flat-conversation skill-optimize-workspace skill-view-enter">
      <div className="skill-message-scroll-region">
        <ConversationTurnNavigation
          containerRef={messageListRef}
          turns={conversationTurns}
        />
        <div ref={messageListRef} className="skill-flat-messages">
          {initializing ? (
            <div className="skill-flat-empty">
              <Loader2 size={23} className="spin" />
              <h2>正在分析这个 Skill</h2>
              <p>马上为你整理值得改进的地方。</p>
            </div>
          ) : (
            state.messages.map((message, index) =>
              message.role === 'user' ? (
                <div
                  id={`guided-turn-optimize-${index}`}
                  className="skill-user-message"
                  key={`${message.role}-${index}`}
                >
                  {message.content}
                </div>
              ) : (
                <div
                  className="skill-assistant-block"
                  key={`${message.role}-${index}`}
                >
                  <div className="skill-assistant-avatar">
                    <Sparkles size={14} />
                  </div>
                  <div className="skill-assistant-message">
                    <MarkdownContent content={message.content} />
                  </div>
                </div>
              ),
            )
          )}
          {state.busy && (
            <div className="skill-assistant-message is-thinking">
              <span />
              <span />
              <span />
            </div>
          )}
          {state.error && <div className="skill-run-error">{state.error}</div>}
          {state.savedVersionNumber && (
            <div className="skill-optimize-saved">
              <Check size={14} />
              已生成 v{state.savedVersionNumber}
            </div>
          )}
        </div>
      </div>

      {state.changes.length > 0 && (
        <div className="skill-optimize-savebar">
          <span>{state.changes.length} 项修改待保存</span>
          <button onClick={() => void save()} disabled={state.saving}>
            {state.saving ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <Save size={14} />
            )}
            保存为新版本
          </button>
        </div>
      )}

      <div className="skill-test-composer">
        <textarea
          value={state.draft}
          onChange={(event) =>
            dispatch({ type: 'draft', value: event.target.value })
          }
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          placeholder="说说希望改进的效果，或回复“采纳”…"
        />
        <button
          onClick={() => void send()}
          disabled={!state.draft.trim() || state.busy || initializing}
        >
          {state.busy ? (
            <Loader2 size={15} className="spin" />
          ) : (
            <ArrowUp size={15} />
          )}
        </button>
      </div>
    </div>
  );
}
