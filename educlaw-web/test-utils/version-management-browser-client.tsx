import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ArenaThread } from '@educlaw/shared';
import { SkillDetailWorkspace } from '../src/components/skill-workspace/SkillDetailWorkspace';
import { useSkillVersions } from '../src/components/skill-workspace/use-skill-versions';
import { useSkillAnswerRerun } from '../src/components/skill-workspace/use-skill-answer-rerun';
import type {
  AnswerOptimizationSelection,
  AnswerOptimizationRerunRequest,
} from '../src/components/skill-workspace/answer-optimization-selection';
import '../src/index.css';
function App() {
  const params = new URLSearchParams(location.search);
  const [skillId, setSkillId] = useState(params.get('skill') ?? '11');
  const [threadId, setThreadId] = useState<string | null>(
    params.get('conversation') ?? '91',
  );
  const [view, setView] = useState<'run' | 'test' | 'versions'>('run');
  const [threads, setThreads] = useState<ArenaThread[]>([]);
  const [selection, setSelection] =
    useState<AnswerOptimizationSelection | null>(null);
  const [rerun, setRerun] = useState<AnswerOptimizationRerunRequest | null>(
    null,
  );
  const [notice, setNotice] = useState('');
  const data = useSkillVersions('fixture-only-token', '7', skillId);
  useEffect(() => {
    void fetch('/__acceptance/state')
      .then((r) => r.json())
      .then((state) => setThreads(state.threads));
  }, []);
  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.set('skill', skillId);
    if (threadId) url.searchParams.set('conversation', threadId);
    else url.searchParams.delete('conversation');
    history.replaceState(null, '', url);
  }, [skillId, threadId]);
  const onRerun = useSkillAnswerRerun(
    'fixture-only-token',
    `7:${skillId}`,
    data.reload,
    (versionNumber, s) => {
      setThreadId(null);
      setView(s.origin === 'test' ? 'test' : 'run');
      setRerun({ requestId: crypto.randomUUID(), versionNumber, selection: s });
    },
  );
  return (
    <>
      <aside style={{ padding: 12, borderBottom: '1px solid #ccc' }}>
        <strong>隔离 UI 验收 · 模拟 API · 无数据库/模型</strong>
        {['11', '12'].map((id) => (
          <button
            key={id}
            style={{ margin: 8 }}
            onClick={() => {
              setSkillId(id);
              setThreadId(null);
              setRerun(null);
            }}
          >
            Skill {id === '11' ? 'A' : 'B'}
          </button>
        ))}
        {(['run', 'test', 'versions'] as const).map((v) => (
          <button key={v} style={{ margin: 8 }} onClick={() => setView(v)}>
            {v}
          </button>
        ))}
        <button
          onClick={() => {
            setSkillId('11');
            setThreadId('91');
            setView('run');
          }}
        >
          旧对话 91
        </button>
        {notice && <output>{notice}</output>}
        {selection && (
          <>
            <output>改进包 head：{selection.currentPackageVersionId}</output>
            <button
              onClick={() => {
                void fetch('/__acceptance/optimize', { method: 'POST' })
                  .then((r) => r.json())
                  .then((result) => onRerun(result.versionNumber, selection));
              }}
            >
              模拟优化保存并重跑
            </button>
          </>
        )}
      </aside>
      <SkillDetailWorkspace
        key={skillId}
        token="fixture-only-token"
        skill={{
          packageId: '7',
          skillId,
          name: `Skill ${skillId}`,
          description: 'isolated',
        }}
        view={view}
        versions={data.versions}
        currentVersionId={data.currentVersionId}
        currentPackageVersionId={data.currentPackageVersionId}
        versionsLoading={data.loading}
        versionsHasMore={data.hasMore}
        versionsLoadingMore={data.loadingMore}
        onLoadMoreVersions={data.loadMore}
        onReloadVersions={data.reload}
        onNewConversation={() => setThreadId(null)}
        onPublishUpdate={(update) => setNotice(update.message)}
        onNavigate={(v) => {
          if (v === 'run' || v === 'test' || v === 'versions') setView(v);
        }}
        onOptimizeAnswer={setSelection}
        conversations={threads}
        selectedConversationId={threadId}
        onConversationCreated={(t) => {
          setThreads((old) => [t, ...old]);
          setThreadId(String(t.id));
        }}
        onConversationUpdated={(t) =>
          setThreads((old) => old.map((x) => (x.id === t.id ? t : x)))
        }
        answerRerunRequest={rerun}
        onRerunHandled={() => setRerun(null)}
      />
    </>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
