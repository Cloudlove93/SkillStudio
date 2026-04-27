import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router';
import {
  Shield, Bot, FileText, BookOpen, Wrench, ArrowLeft, RefreshCw,
  Users, Database, ChevronRight, Search, Hash, ArrowUpDown,
} from 'lucide-react';
import { useAuthStore } from '../stores/auth';
import { fetchAdminOverview, type AdminUserOverview } from '../api/admin';
import { Button } from '@/components/ui/button';
import { useT } from '../i18n';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TableId = 'users' | 'agents' | 'profiles' | 'skills' | 'tools';
type TableRow = Record<string, unknown>;

function formatDate(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date)) return null;
  return new Date(value).toLocaleDateString();
}

interface Column {
  key: string;
  label: string;
  width?: string;       // Tailwind width class
  mono?: boolean;
  truncate?: boolean;
  render?: (value: unknown, row: TableRow) => React.ReactNode;
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

function StatusCell({ value }: { value: string }) {
  const cfg: Record<string, { dot: string; text: string }> = {
    running:  { dot: 'bg-green-500', text: 'text-green-600 dark:text-green-400' },
    stopped:  { dot: 'bg-gray-400',  text: 'text-gray-500 dark:text-gray-400' },
    starting: { dot: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' },
    error:    { dot: 'bg-red-500',   text: 'text-red-600 dark:text-red-400' },
  };
  const c = cfg[value] ?? cfg.stopped;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${c.text}`}>
      <span className={`size-1.5 rounded-full ${c.dot}`} />
      {value}
    </span>
  );
}

// ---------------------------------------------------------------------------
// DataGrid 鈥?the database-style table
// ---------------------------------------------------------------------------

function DataGrid({ columns, rows, emptyText }: {
  columns: Column[];
  rows: TableRow[];
  emptyText: string;
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    if (!filter) return rows;
    const q = filter.toLowerCase();
    return rows.filter((r) =>
      columns.some((c) => String(r[c.key] ?? '').toLowerCase().includes(q)),
    );
  }, [rows, filter, columns]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    return [...filtered].sort((a, b) => {
      const va = String(a[sortKey] ?? '');
      const vb = String(b[sortKey] ?? '');
      return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
    });
  }, [filtered, sortKey, sortAsc]);

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40 bg-muted/20 shrink-0">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground/60 pointer-events-none" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter..."
            className="w-full pl-7 pr-2 py-1 text-xs bg-background border border-border/50 rounded focus:outline-none focus:ring-1 focus:ring-primary/40"
          />
        </div>
        <span className="text-[11px] text-muted-foreground tabular-nums ml-auto">
          {sorted.length} row{sorted.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full text-[13px] border-collapse">
          {/* Sticky header */}
          <thead className="sticky top-0 z-[1]">
            <tr className="bg-muted/70">
              {/* Row number col */}
              <th className="w-10 min-w-[40px] px-2 py-1.5 text-center text-[11px] font-medium text-muted-foreground/60 border-b border-r border-border/40 bg-muted/50">
                <Hash className="size-3 mx-auto" />
              </th>
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  className={`px-3 py-1.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-r border-border/40 bg-muted/50 cursor-pointer select-none hover:bg-muted/70 transition-colors ${col.width ?? ''}`}
                >
                  <span className="flex items-center gap-1">
                    {col.label}
                    <ArrowUpDown className={`size-3 shrink-0 ${sortKey === col.key ? 'text-primary' : 'text-muted-foreground/30'}`} />
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 1} className="px-3 py-10 text-center text-xs text-muted-foreground/60 italic">
                  {emptyText}
                </td>
              </tr>
            ) : (
              sorted.map((row, i) => (
                <tr
                  key={typeof row._key === 'string' || typeof row._key === 'number' ? row._key : i}
                  className="group border-b border-border/20 hover:bg-primary/[0.03] transition-colors"
                >
                  {/* Row number */}
                  <td className="px-2 py-1.5 text-center text-[11px] tabular-nums text-muted-foreground/40 border-r border-border/30 bg-muted/10">
                    {i + 1}
                  </td>
                  {columns.map((col) => {
                    const val = row[col.key];
                    const rendered = col.render ? col.render(val, row) : (typeof val === 'string' || typeof val === 'number' ? val : null);
                    return (
                      <td
                        key={col.key}
                        className={`px-3 py-1.5 border-r border-border/20 ${col.mono ? 'font-mono text-xs' : ''} ${col.truncate ? 'max-w-0 truncate' : ''} ${col.width ?? ''}`}
                        title={col.truncate && typeof val === 'string' ? val : undefined}
                      >
                        {rendered ?? <span className="text-muted-foreground/30">NULL</span>}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar nav item
// ---------------------------------------------------------------------------

function NavItem({ icon: Icon, label, count, active, onClick }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors ${
        active
          ? 'bg-primary/10 text-primary font-medium'
          : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
      }`}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="flex-1 truncate">{label}</span>
      <span className={`text-[11px] tabular-nums shrink-0 ${active ? 'text-primary/70' : 'text-muted-foreground/50'}`}>
        {count}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AdminPage() {
  const t = useT();
  const navigate = useNavigate();
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [users, setUsers] = useState<AdminUserOverview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTable, setActiveTable] = useState<TableId>('users');
  const [selectedUser, setSelectedUser] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !isAdmin) {
      navigate('/', { replace: true });
      return;
    }
    loadData();
  }, [isAuthenticated, isAdmin, navigate]);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAdminOverview();
      setUsers(data.users);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  // 鈹€鈹€ Flatten all data into table rows 鈹€鈹€

  const allAgents = useMemo(() =>
    users.flatMap((u) => u.agents.map((a) => ({ ...a, _key: a.id, _user: u.username }))),
    [users],
  );
  const allProfiles = useMemo(() =>
    users.flatMap((u) => u.profiles.map((p) => ({ ...p, _key: `${u.id}:${p.fileName}`, _user: u.username }))),
    [users],
  );
  const allSkills = useMemo(() =>
    users.flatMap((u) => u.skills.map((s) => ({ ...s, _key: `${u.id}:${s.dirName}`, _user: u.username }))),
    [users],
  );
  const allTools = useMemo(() =>
    users.flatMap((u) => u.tools.map((tl) => ({ ...tl, _key: `${u.id}:${tl.dirName}`, _user: u.username }))),
    [users],
  );

  // Filter by selected user
  const filterByUser = <T extends { _user: string }>(rows: T[]) =>
    selectedUser ? rows.filter((r) => r._user === selectedUser) : rows;

  // 鈹€鈹€ Column definitions 鈹€鈹€

  const userCols: Column[] = [
    { key: 'username', label: t('admin.colUser'), width: 'w-[140px]' },
    { key: 'createdAt', label: t('admin.colCreated'), width: 'w-[120px]', render: (v) => formatDate(v) },
    { key: '_agents', label: t('admin.agents'), width: 'w-[80px]' },
    { key: '_profiles', label: t('admin.profiles'), width: 'w-[80px]' },
    { key: '_skills', label: t('admin.skills'), width: 'w-[80px]' },
    { key: '_tools', label: t('admin.tools'), width: 'w-[80px]' },
  ];

  const userRows = useMemo(() =>
    users.map((u) => ({
      _key: u.id,
      username: u.username,
      createdAt: u.createdAt,
      _agents: u.agents.length,
      _profiles: u.profiles.length,
      _skills: u.skills.length,
      _tools: u.tools.length,
    })),
    [users],
  );

  const agentCols: Column[] = [
    { key: '_user', label: t('admin.colOwner'), width: 'w-[110px]' },
    { key: 'name', label: t('admin.colName'), width: 'w-[160px]' },
    { key: 'description', label: t('admin.colDescription'), truncate: true },
    { key: 'status', label: t('admin.colStatus'), width: 'w-[90px]', render: (v) => <StatusCell value={String(v ?? '')} /> },
    { key: 'profileFileName', label: t('admin.colProfile'), width: 'w-[160px]', mono: true, truncate: true },
    { key: 'createdAt', label: t('admin.colCreated'), width: 'w-[100px]', render: (v) => formatDate(v) },
  ];

  const profileCols: Column[] = [
    { key: '_user', label: t('admin.colOwner'), width: 'w-[110px]' },
    { key: 'name', label: t('admin.colName'), width: 'w-[180px]' },
    { key: 'description', label: t('admin.colDescription'), truncate: true },
    { key: 'fileName', label: t('admin.colFile'), width: 'w-[180px]', mono: true, truncate: true },
  ];

  const skillCols: Column[] = [
    { key: '_user', label: t('admin.colOwner'), width: 'w-[110px]' },
    { key: 'name', label: t('admin.colName'), width: 'w-[180px]' },
    { key: 'description', label: t('admin.colDescription'), truncate: true },
    { key: 'dirName', label: t('admin.colDir'), width: 'w-[180px]', mono: true, truncate: true },
  ];

  const toolCols: Column[] = [
    { key: '_user', label: t('admin.colOwner'), width: 'w-[110px]' },
    { key: 'name', label: t('admin.colName'), width: 'w-[180px]' },
    { key: 'description', label: t('admin.colDescription'), truncate: true },
    { key: 'dirName', label: t('admin.colDir'), width: 'w-[180px]', mono: true, truncate: true },
  ];

  // 鈹€鈹€ Which data to show 鈹€鈹€

  const tableMap: Record<TableId, { columns: Column[]; rows: TableRow[]; }> = {
    users:    { columns: userCols,    rows: userRows },
    agents:   { columns: agentCols,   rows: filterByUser(allAgents) },
    profiles: { columns: profileCols, rows: filterByUser(allProfiles) },
    skills:   { columns: skillCols,   rows: filterByUser(allSkills) },
    tools:    { columns: toolCols,    rows: filterByUser(allTools) },
  };

  const current = tableMap[activeTable];

  const tables: { id: TableId; icon: React.ComponentType<{ className?: string }>; label: string; count: number }[] = [
    { id: 'users',    icon: Users,    label: t('admin.tblUsers'),    count: users.length },
    { id: 'agents',   icon: Bot,      label: t('admin.tblAgents'),   count: filterByUser(allAgents).length },
    { id: 'profiles', icon: FileText, label: t('admin.tblProfiles'), count: filterByUser(allProfiles).length },
    { id: 'skills',   icon: BookOpen, label: t('admin.tblSkills'),   count: filterByUser(allSkills).length },
    { id: 'tools',    icon: Wrench,   label: t('admin.tblTools'),    count: filterByUser(allTools).length },
  ];

  if (!isAdmin) return null;

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* 鈹€鈹€鈹€ Left sidebar 鈹€鈹€鈹€ */}
      <aside className="flex flex-col w-56 shrink-0 border-r border-border/40 bg-card/60">
        {/* Logo bar */}
        <div className="flex items-center gap-2 px-3 py-3 border-b border-border/40">
          <Button variant="ghost" size="icon-xs" onClick={() => navigate('/')} title={t('admin.backHome')}>
            <ArrowLeft className="size-3.5" />
          </Button>
          <Shield className="size-4 text-primary" />
          <span className="text-sm font-bold truncate">{t('admin.title')}</span>
        </div>

        {/* User filter */}
        <div className="px-2 pt-3 pb-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 px-1 mb-1.5">
            {t('admin.filterUser')}
          </div>
          <select
            value={selectedUser ?? ''}
            onChange={(e) => setSelectedUser(e.target.value || null)}
            className="w-full text-xs bg-background border border-border/50 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary/40"
          >
            <option value="">{t('admin.allUsers')}</option>
            {users.map((u) => (
              <option key={u.id} value={u.username}>{u.username}</option>
            ))}
          </select>
        </div>

        {/* Tables nav */}
        <div className="px-2 pt-3 pb-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 px-1 mb-1.5">
            <Database className="size-3 inline mr-1 -mt-px" />
            {t('admin.tables')}
          </div>
          <nav className="space-y-0.5">
            {tables.map((tbl) => (
              <NavItem
                key={tbl.id}
                icon={tbl.icon}
                label={tbl.label}
                count={tbl.count}
                active={activeTable === tbl.id}
                onClick={() => setActiveTable(tbl.id)}
              />
            ))}
          </nav>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Refresh */}
        <div className="px-2 pb-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={loadData}
            disabled={loading}
            className="w-full justify-start gap-2 text-xs"
          >
            <RefreshCw className={`size-3 ${loading ? 'animate-spin' : ''}`} />
            {t('admin.refresh')}
          </Button>
        </div>
      </aside>

      {/* 鈹€鈹€鈹€ Main content 鈹€鈹€鈹€ */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Table header bar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border/40 bg-card/40 shrink-0">
          <ChevronRight className="size-3.5 text-muted-foreground/40" />
          <span className="text-sm font-semibold">
            {tables.find((t) => t.id === activeTable)?.label}
          </span>
          {selectedUser && (
            <span className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-0.5">
              {selectedUser}
            </span>
          )}
        </div>

        {/* Grid area */}
        <div className="flex-1 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <RefreshCw className="size-5 animate-spin text-muted-foreground/40" />
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full px-6">
              <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-900/50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-400 max-w-md">
                {error}
              </div>
            </div>
          ) : (
            <DataGrid
              columns={current.columns}
              rows={current.rows}
              emptyText={t('admin.noData')}
            />
          )}
        </div>
      </main>
    </div>
  );
}
