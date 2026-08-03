import { useEffect, useReducer, useRef } from 'react';
import type { SkillVersionDetail } from '@educlaw/shared';
import { ArrowUp, Loader2, Play, Sparkles } from 'lucide-react';
import { liteApi } from '../../api/lite-api';
import { createSkillRunState, skillRunReducer } from './skill-run-state';

type Props = {
  token: string;
  packageId: string;
  version: SkillVersionDetail | undefined;
  purpose?: 'run' | 'test';
  onCompleted: () => void;
};

function requestId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `skill-run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function SkillRunWorkspace({ token, packageId, version, purpose = 'run', onCompleted }: Props) {
  const [state, dispatch] = useReducer(skillRunReducer, undefined, createSkillRunState);
  const threadIdRef = useRef<string | null>(null);

  useEffect(() => {
    threadIdRef.current = null;
    dispatch({ type: 'reset' });
  }, [version?.id]);

  const send = async () => {
    const content = state.draft.trim();
    if (!content || state.busy || !version) return;
    dispatch({ type: 'submit', content });
    try {
      if (!threadIdRef.current) {
        const thread = await liteApi.createArenaThread(token, packageId, {
          idempotencyKey: requestId(),
          basePackageVersionId: version.createdInPackageVersionId,
          left: { skillId: version.skillId, skillVersionId: version.id },
          right: { skillId: version.skillId, skillVersionId: version.id },
        });
        threadIdRef.current = String(thread.id);
      }
      let finished = false;
      await liteApi.sendMessageStream(
        token,
        threadIdRef.current,
        content,
        undefined,
        'agent',
        (event) => {
          if (event.event === 'delta') {
            dispatch({ type: 'delta', side: event.data.side, delta: event.data.delta });
          }
          if (event.event === 'side_done' && event.data.side === 'enhanced') {
            finished = true;
            if (event.data.ok) {
              dispatch({ type: 'done', content: event.data.content });
              onCompleted();
            } else {
              dispatch({ type: 'error', message: event.data.error || 'Skill 执行失败' });
            }
          }
          if (event.event === 'error') {
            finished = true;
            dispatch({ type: 'error', message: event.data.error });
          }
          if (event.event === 'stream_end' && !event.data.ok && !finished) {
            dispatch({ type: 'error', message: 'Skill 执行中断，请重试' });
          }
        },
      );
    } catch (error) {
      dispatch({
        type: 'error',
        message: error instanceof Error ? error.message : 'Skill 执行失败',
      });
    }
  };

  return (
    <div className="skill-flat-conversation skill-run-workspace skill-view-enter">
      <div className="skill-flat-messages">
        {state.messages.length === 0 && !state.streaming ? (
          <div className="skill-flat-empty">
            <Play size={24} />
            <h2>{purpose === 'test' ? '测试当前 Skill' : '运行当前 Skill'}</h2>
            <p>输入一个真实任务，系统会固定使用 v{version?.versionNumber ?? '-'} 执行并保存记录。</p>
          </div>
        ) : (
          state.messages.map((message, index) =>
            message.role === 'user' ? (
              <div className="skill-user-message" key={`${message.role}-${index}`}>
                {message.content}
              </div>
            ) : (
              <div className="skill-assistant-block" key={`${message.role}-${index}`}>
                <div className="skill-assistant-avatar"><Sparkles size={14} /></div>
                <div className="skill-assistant-message">{message.content}</div>
              </div>
            ),
          )
        )}
        {state.streaming && (
          <div className="skill-assistant-block">
            <div className="skill-assistant-avatar"><Sparkles size={14} /></div>
            <div className="skill-assistant-message">{state.streaming}</div>
          </div>
        )}
        {state.error && <div className="skill-run-error">{state.error}</div>}
      </div>
      <div className="skill-test-composer">
        <textarea
          value={state.draft}
          onChange={(event) => dispatch({ type: 'draft', value: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          placeholder={purpose === 'test' ? '输入测试任务…' : '输入任务，立即使用这个 Skill…'}
        />
        <button onClick={() => void send()} disabled={!state.draft.trim() || state.busy || !version}>
          {state.busy ? <Loader2 size={15} className="spin" /> : <ArrowUp size={15} />}
        </button>
      </div>
    </div>
  );
}
