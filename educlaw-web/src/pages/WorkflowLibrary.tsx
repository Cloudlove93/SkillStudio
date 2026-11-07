import { useEffect, useState } from 'react';
import { ArrowRight, GitBranch, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { liteApi, type WorkflowListItem } from '../api/lite-api';

type Props = {
  token: string;
  onCreate: () => void;
  onOpen: (packageId: string) => void;
};

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '刚刚更新'
    : date.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function WorkflowLibrary({ token, onCreate, onOpen }: Props) {
  const [items, setItems] = useState<WorkflowListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    try {
      setItems(await liteApi.listWorkflows(token));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法加载工作流库');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [token]);

  return <main className="mx-auto min-h-full max-w-5xl p-5 lg:p-7">
    <header className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border bg-card px-5 py-5">
      <div><div className="flex items-center gap-2"><GitBranch className="size-5 text-primary" /><h1 className="text-lg font-semibold">工作流库</h1></div><p className="mt-2 text-sm text-muted-foreground">这里保存你创建过的工作流草稿和版本，随时可以继续编排。</p></div>
      <div className="flex gap-2"><button type="button" className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm" onClick={() => void load()} disabled={loading}><RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />刷新</button><button type="button" className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground" onClick={onCreate}><Plus className="size-4" />新建工作流</button></div>
    </header>
    {loading ? <div className="mt-4 rounded-2xl border bg-card px-5 py-12 text-center text-sm text-muted-foreground">正在加载工作流…</div> : items.length ? <section className="mt-4 grid gap-3 md:grid-cols-2">{items.map(item => <article key={item.id} className="rounded-2xl border bg-card p-5 transition-shadow hover:shadow-sm"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="truncate text-base font-semibold">{item.name}</h2><p className="mt-1 line-clamp-2 min-h-10 text-sm text-muted-foreground">{item.description || '工作流草稿'}</p></div><span className="shrink-0 rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">v{item.versionNumber}</span></div><div className="mt-4 flex items-center justify-between gap-3 border-t pt-3 text-xs text-muted-foreground"><span>{item.nodeCount} 个节点 · {item.skillNodeCount} 个 Skill 节点</span><span>{formatUpdatedAt(item.updatedAt)}</span></div><button type="button" className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium hover:border-primary hover:text-primary" onClick={() => onOpen(item.id)}>继续编辑<ArrowRight className="size-4" /></button></article>)}</section> : <section className="mt-4 rounded-2xl border border-dashed bg-card px-5 py-14 text-center"><GitBranch className="mx-auto size-8 text-muted-foreground" /><h2 className="mt-3 font-semibold">还没有保存的工作流</h2><p className="mt-2 text-sm text-muted-foreground">新建一个工作流后，它会自动出现在这里。</p><button type="button" className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground" onClick={onCreate}><Plus className="size-4" />新建工作流</button></section>}
  </main>;
}
