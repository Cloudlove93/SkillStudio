import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { SkillVersionDetail } from '@educlaw/shared';
import { ArrowUp, Columns3, Loader2 } from 'lucide-react';
import { liteApi } from '../../api/lite-api';
import { createSkillArenaState, skillArenaReducer } from './skill-arena-state';

type Props = {
  token: string;
  packageId: string;
  versions: SkillVersionDetail[];
  currentVersionId: string | null;
  onCompleted: () => void;
};

function requestId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `skill-arena-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function SkillArenaWorkspace({
  token,
  packageId,
  versions,
  currentVersionId,
  onCompleted,
}: Props) {
  const available = useMemo(
    () => versions.filter((version) => version.status !== 'discarded'),
    [versions],
  );
  const fallbackLeft = available.find((version) => version.id !== currentVersionId)?.id || currentVersionId || '';
  const fallbackRight = currentVersionId || available[0]?.id || '';
  const [leftVersionId, setLeftVersionId] = useState(fallbackLeft);
  const [rightVersionId, setRightVersionId] = useState(fallbackRight);
  const [state, dispatch] = useReducer(skillArenaReducer, undefined, createSkillArenaState);
  const threadIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!leftVersionId && fallbackLeft) setLeftVersionId(fallbackLeft);
    if (!rightVersionId && fallbackRight) setRightVersionId(fallbackRight);
  }, [fallbackLeft, fallbackRight, leftVersionId, rightVersionId]);

  useEffect(() => {
    threadIdRef.current = null;
    dispatch({ type: 'reset' });
  }, [leftVersionId, rightVersionId]);

  const leftVersion = available.find((version) => version.id === leftVersionId);
  const rightVersion = available.find((version) => version.id === rightVersionId);

  const send = async () => {
    const content = state.draft.trim();
    if (!content || state.busy || !leftVersion || !rightVersion) return;
    dispatch({ type: 'submit', content });
    try {
      if (!threadIdRef.current) {
        const thread = await liteApi.createArenaThread(token, packageId, {
          idempotencyKey: requestId(),
          basePackageVersionId: rightVersion.createdInPackageVersionId,
          left: { skillId: leftVersion.skillId, skillVersionId: leftVersion.id },
          right: { skillId: rightVersion.skillId, skillVersionId: rightVersion.id },
        });
        threadIdRef.current = String(thread.id);
      }
      await liteApi.sendMessageStream(
        token,
        threadIdRef.current,
        content,
        undefined,
        'compare',
        (event) => {
          if (event.event === 'delta') {
            dispatch({ type: 'delta', side: event.data.side, delta: event.data.delta });
          }
          if (event.event === 'side_done') {
            if (event.data.ok) {
              dispatch({ type: 'side_done', side: event.data.side, content: event.data.content });
              if (event.data.side === 'enhanced') onCompleted();
            } else {
              dispatch({ type: 'error', message: event.data.error || '版本对比失败' });
            }
          }
          if (event.event === 'error') dispatch({ type: 'error', message: event.data.error });
        },
      );
    } catch (error) {
      dispatch({
        type: 'error',
        message: error instanceof Error ? error.message : '版本对比失败',
      });
    }
  };

  return (
    <div className="skill-arena-workspace skill-view-enter">
      <div className="skill-arena-selectors">
        <label>
          <span>左侧版本</span>
          <select value={leftVersionId} onChange={(event) => setLeftVersionId(event.target.value)}>
            {available.map((version) => <option key={version.id} value={version.id}>v{version.versionNumber}</option>)}
          </select>
        </label>
        <Columns3 size={16} />
        <label>
          <span>右侧版本</span>
          <select value={rightVersionId} onChange={(event) => setRightVersionId(event.target.value)}>
            {available.map((version) => <option key={version.id} value={version.id}>v{version.versionNumber}</option>)}
          </select>
        </label>
      </div>

      <div className="skill-arena-results">
        {!state.question ? (
          <div className="skill-flat-empty">
            <Columns3 size={24} />
            <h2>用同一个任务对比两个版本</h2>
            <p>两侧都会固定使用上方选择的 Skill 版本，结果自动保存在服务端。</p>
          </div>
        ) : (
          <>
            <div className="skill-user-message">{state.question}</div>
            <div className="skill-arena-grid">
              <section>
                <strong>v{leftVersion?.versionNumber ?? '-'}</strong>
                <div>{state.baseline || (state.busy ? '正在生成…' : '暂无结果')}</div>
              </section>
              <section>
                <strong>v{rightVersion?.versionNumber ?? '-'}</strong>
                <div>{state.enhanced || (state.busy ? '正在生成…' : '暂无结果')}</div>
              </section>
            </div>
          </>
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
          placeholder="输入用于对比的真实任务…"
        />
        <button onClick={() => void send()} disabled={!state.draft.trim() || state.busy || !leftVersion || !rightVersion}>
          {state.busy ? <Loader2 size={15} className="spin" /> : <ArrowUp size={15} />}
        </button>
      </div>
    </div>
  );
}
