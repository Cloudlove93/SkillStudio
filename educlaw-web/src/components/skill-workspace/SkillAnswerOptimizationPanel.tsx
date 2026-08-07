import { useEffect, useRef, useState } from 'react';
import { Check, GitCompare, Loader2, Play, Sparkles } from 'lucide-react';
import {
  answerSkillOptimizationApi,
  AnswerOptimizationApiError,
  type AnswerSkillOptimizationDetail,
} from '../../api/answer-skill-optimizations';
import type { AnswerOptimizationSelection } from './answer-optimization-selection';

type Props = {
  token: string;
  selection: AnswerOptimizationSelection;
  onSaved: (versionNumber: number) => void;
  onRerun: (versionNumber: number, selection: AnswerOptimizationSelection) => void;
};

const feedbackSuggestions = ['步骤更清楚', '增加安全提醒', '更有启发性'];

function idempotencyKey() {
  return crypto.randomUUID();
}

export function SkillAnswerOptimizationPanel({ token, selection, onSaved, onRerun }: Props) {
  const [feedbackDraft, setFeedbackDraft] = useState(selection.feedback);
  const [detail, setDetail] = useState<AnswerSkillOptimizationDetail | null>(null);
  const [busy, setBusy] = useState<'create' | 'test' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedVersion, setSavedVersion] = useState<number | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    requestRef.current += 1;
    setFeedbackDraft(selection.feedback);
    setBusy(null);
    setError(null);
    setDetail(null);
    setSavedVersion(null);
  }, [selection]);

  const beginOptimization = async () => {
    const feedback = feedbackDraft.trim();
    if (!feedback || busy) return;

    const request = ++requestRef.current;
    setBusy('create');
    setError(null);
    try {
      let next = (await answerSkillOptimizationApi.create(token, {
        packageId: selection.packageId,
        threadId: selection.threadId,
        questionMessageId: selection.questionMessageId,
        enhancedAnswerMessageId: selection.enhancedAnswerMessageId,
        baselineAnswerMessageId: selection.baselineAnswerMessageId,
        answerSide: selection.answerSide,
        answerMessageId: selection.answerMessageId,
        feedback,
      }, idempotencyKey())).data;
      next = (await answerSkillOptimizationApi.rebase(
        token,
        next.optimizationId,
        next.revision,
      )).data;
      if (request === requestRef.current) setDetail(next);
    } catch (cause) {
      if (request === requestRef.current) {
        setError(cause instanceof Error ? cause.message : '暂时无法生成改进建议');
      }
    } finally {
      if (request === requestRef.current) setBusy(null);
    }
  };

  const test = async () => {
    if (!detail || busy) return;
    setBusy('test');
    setError(null);
    try {
      const result = (await answerSkillOptimizationApi.test(
        token,
        detail.optimizationId,
        detail.revision,
        idempotencyKey(),
      )).data;
      setDetail({ ...detail, status: result.status, testResult: result.testResult });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '测试没有完成，请重试');
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!detail || detail.status !== 'test_ready' || busy) return;
    setBusy('save');
    setError(null);
    try {
      const result = (await answerSkillOptimizationApi.confirm(
        token,
        detail.optimizationId,
        { expectedRevision: detail.revision, versionNote: `改进 v${selection.answerVersionNumber} 的回答` },
        idempotencyKey(),
      )).data;
      setSavedVersion(result.skillVersionNumber);
      onSaved(result.skillVersionNumber);
    } catch (cause) {
      if (cause instanceof AnswerOptimizationApiError && cause.statusCode === 409 && detail) {
        try {
          const rebased = (await answerSkillOptimizationApi.rebase(
            token,
            detail.optimizationId,
            detail.revision,
          )).data;
          setDetail(rebased);
          setError('当前版本刚刚发生了变化，改进已重新应用，请再次测试后保存。');
        } catch (rebaseCause) {
          setError(rebaseCause instanceof Error ? rebaseCause.message : '当前版本已变化，请重新检查改进');
        }
      } else {
        setError(cause instanceof Error ? cause.message : '保存失败，请重试');
      }
    } finally {
      setBusy(null);
    }
  };

  const rerunSelection: AnswerOptimizationSelection = {
    ...selection,
    feedback: detail?.feedback || feedbackDraft.trim(),
  };

  return (
    <div className="skill-answer-optimization-panel">
      <div className="skill-answer-optimization-origin">
        <span>正在改进</span>
        <strong>由 v{selection.answerVersionNumber} 生成的回答</strong>
        <p>{selection.answer}</p>
      </div>

      {!detail && busy !== 'create' && (
        <>
          <div className="skill-answer-optimization-intro">
            说说希望这条回答发生什么变化，我会结合原问题和当前 Skill 给出改进方案。
          </div>
          <div className="skill-answer-optimization-suggestions" aria-label="常用改进方向">
            {feedbackSuggestions.map((suggestion) => (
              <button key={suggestion} type="button" onClick={() => setFeedbackDraft(suggestion)}>
                {suggestion}
              </button>
            ))}
          </div>
          <div className="skill-answer-optimization-composer">
            <textarea
              value={feedbackDraft}
              onChange={(event) => setFeedbackDraft(event.target.value)}
              placeholder="例如：不要直接给答案，多用问题引导学生自查…"
              autoFocus
            />
            <div>
              <span>先生成改进方案，再测试效果</span>
              <button
                className="is-primary"
                type="button"
                disabled={!feedbackDraft.trim()}
                onClick={() => void beginOptimization()}
              >
                开始改进
              </button>
            </div>
          </div>
        </>
      )}

      {busy === 'create' && (
        <div className="skill-answer-optimization-loading">
          <Loader2 className="spin" size={17} />
          <span>正在分析这条回答…</span>
        </div>
      )}
      {detail?.baseVersionId !== detail?.evidenceVersionId && (
        <div className="skill-answer-rebase-note">
          <GitCompare size={15} />
          <p>问题来自较早版本，改进已应用到当前版本；已有修改会继续保留。</p>
        </div>
      )}
      {detail?.diagnosis && (
        <section>
          <span>问题判断</span>
          <p>{detail.diagnosis.summary}</p>
        </section>
      )}
      {detail?.diff && (
        <section className="skill-answer-diff">
          <span>修改前后</span>
          <div><small>修改前</small><p>{detail.diff.before || '暂无对应规则'}</p></div>
          <div className="is-after"><small>修改后</small><p>{detail.diff.after}</p></div>
        </section>
      )}
      {detail?.testResult && (
        <section className="skill-answer-test-result">
          <span>测试效果</span>
          <strong>{detail.testResult.qualityGate.passed ? '符合预期' : '仍需调整'}</strong>
          <p>{detail.testResult.qualityGate.overallSummary}</p>
        </section>
      )}
      {savedVersion !== null && (
        <div className="skill-answer-saved-block">
          <div className="skill-answer-saved"><Check size={15} /> 已保存为 v{savedVersion}</div>
          <button className="skill-primary-button" onClick={() => onRerun(savedVersion, rerunSelection)}>
            <Play size={15} />
            用 v{savedVersion} 重新运行原任务
          </button>
        </div>
      )}
      {error && <div className="skill-run-error">{error}</div>}

      {detail && savedVersion === null && (
        <div className="skill-answer-optimization-actions">
          <button onClick={() => void test()} disabled={Boolean(busy) || !detail.draft}>
            {busy === 'test' ? <Loader2 className="spin" size={15} /> : <Play size={15} />}
            测试改进
          </button>
          <button className="is-primary" onClick={() => void save()} disabled={Boolean(busy) || detail.status !== 'test_ready'}>
            {busy === 'save' ? <Loader2 className="spin" size={15} /> : <Sparkles size={15} />}
            保存为新版本
          </button>
        </div>
      )}
    </div>
  );
}
