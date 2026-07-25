import type {
  AgentPackageDetail,
  AgentPackageSummary,
  ArenaMessage,
  ArenaReport,
  ArenaThread,
  ArenaThreadDetail,
  OptimizationResult,
  PackageSkillRecord,
  PackageVersion,
  RollbackSkillVersionPayload,
  SkillAction,
  SkillVersionDetail,
  SkillVersionListResult,
  UserSummary,
} from '@educlaw/shared';
import { ARENA_ROUTES, PACKAGE_ROUTES } from '@educlaw/shared';
import { apiFetch } from './client';

export interface DiagnosisIssue {
  id: string;
  target: 'agent' | 'rubric' | 'skill';
  targetId?: string;
  targetName?: string;
  title: string;
  reason: string;
  suggestion: string;
}

export interface DiagnosisResult {
  welcomeMessage: string;
  issues: DiagnosisIssue[];
}

export interface AdoptedChange {
  id: string;
  target: 'agent' | 'rubric' | 'skill';
  targetId?: string;
  targetName?: string;
  original: string;
  modified: string;
  reason: string;
}

export interface ChatOptimizeResult {
  reply: string;
  newAdoptions: AdoptedChange[];
  newRejections: string[];
  isDone: boolean;
  session?: InteractiveOptimizationSession;
}

export interface InteractiveOptimizationMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface InteractiveOptimizationSession {
  id: string;
  packageId: string;
  threadId: string;
  status: string;
  messages: InteractiveOptimizationMessage[];
  issues: DiagnosisIssue[];
  adoptedChanges: AdoptedChange[];
  summary: string;
  versionId?: string;
  versionNumber?: number;
  createdAt: string;
  updatedAt: string;
}

export interface LineDiff {
  type: 'same' | 'removed' | 'added';
  text: string;
}

export function computeLineDiff(oldText: string, newText: string): LineDiff[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const result: LineDiff[] = [];
  let i = 0,
    j = 0;
  while (i < oldLines.length || j < newLines.length) {
    const oldLine = i < oldLines.length ? oldLines[i] : undefined;
    const newLine = j < newLines.length ? newLines[j] : undefined;
    if (oldLine === newLine) {
      result.push({ type: 'same', text: oldLine || '' });
      i++;
      j++;
    } else if (oldLine !== undefined && newLine !== undefined) {
      const newIndexAhead = newLines.slice(j + 1).indexOf(oldLine);
      const oldIndexAhead = oldLines.slice(i + 1).indexOf(newLine);
      if (
        newIndexAhead !== -1 &&
        (oldIndexAhead === -1 || newIndexAhead <= oldIndexAhead)
      ) {
        result.push({ type: 'removed', text: oldLine });
        i++;
      } else if (
        oldIndexAhead !== -1 &&
        (newIndexAhead === -1 || oldIndexAhead < newIndexAhead)
      ) {
        result.push({ type: 'added', text: newLine });
        j++;
      } else {
        result.push({ type: 'removed', text: oldLine });
        result.push({ type: 'added', text: newLine });
        i++;
        j++;
      }
    } else if (oldLine !== undefined) {
      result.push({ type: 'removed', text: oldLine });
      i++;
    } else if (newLine !== undefined) {
      result.push({ type: 'added', text: newLine });
      j++;
    }
  }
  return result;
}

export interface SkillDiff {
  dirName: string;
  name: string;
  diff: LineDiff[];
}

export interface VersionCompareResult {
  baseVersion: {
    id: string;
    versionNumber: number;
    source: string;
    createdAt: string;
  };
  targetVersion: {
    id: string;
    versionNumber: number;
    source: string;
    createdAt: string;
  };
  diffs: {
    agentMd: LineDiff[];
    rubricMd: LineDiff[];
    skills: SkillDiff[];
  };
  summary: string;
}

export type PackageGeneratePreview = {
  type: string;
  name: string;
  content: string;
};
export type PackageGeneratePreviewDelta = {
  type: string;
  name: string;
  delta: string;
};
export type PackageGenerateStreamEvent =
  | { event: 'phase'; data: { label: string } }
  | { event: 'preview'; data: PackageGeneratePreview }
  | { event: 'preview_delta'; data: PackageGeneratePreviewDelta }
  | { event: 'ping'; data: Record<string, never> }
  | { event: 'done'; data: AgentPackageDetail }
  | { event: 'error'; data: { error: string } }
  | { event: 'stream_end'; data: { ok: boolean } };

export type ArenaMessageStreamEvent =
  | { event: 'phase'; data: { label: string } }
  | { event: 'shared'; data: { message: ArenaMessage } }
  | { event: 'side_start'; data: { side: 'baseline' | 'enhanced' } }
  | { event: 'delta'; data: { side: 'baseline' | 'enhanced'; delta: string } }
  | {
      event: 'side_done';
      data: {
        side: 'baseline' | 'enhanced';
        content: string;
        ok: boolean;
        error?: string;
      };
    }
  | { event: 'done'; data: { thread: ArenaThread; messages: ArenaMessage[] } }
  | { event: 'error'; data: { error: string } }
  | { event: 'stream_end'; data: { ok: boolean } };

export type ArenaMode = 'compare' | 'agent' | 'baseline';

export interface SkillArenaSelectionPayload {
  skillId: string;
  skillVersionId: string;
}

export type ReportStreamEvent =
  | { event: 'phase'; data: { label: string } }
  | { event: 'ping'; data: Record<string, never> }
  | { event: 'done'; data: ArenaReport }
  | { event: 'error'; data: { error: string } }
  | { event: 'stream_end'; data: { ok: boolean } };

export type OptimizeStreamEvent =
  | { event: 'phase'; data: { label: string } }
  | { event: 'ping'; data: Record<string, never> }
  | { event: 'done'; data: OptimizationResult }
  | { event: 'error'; data: { error: string } }
  | { event: 'stream_end'; data: { ok: boolean } };

async function request<T>(
  path: string,
  init: RequestInit = {},
  token?: string,
): Promise<T> {
  const response = await apiFetch(`/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({ error: `HTTP ${response.status}` }));
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

class LiteApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly status?: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

async function actionRequest<T>(
  token: string,
  action: SkillAction,
  pkgId: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const response = await apiFetch('/api', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ action, pkgId, payload }),
  });
  const body = await response
    .json()
    .catch(() => ({ message: `HTTP ${response.status}` }));
  if (!response.ok) {
    const message =
      body && typeof body.message === 'string' && body.message.trim()
        ? body.message
        : `HTTP ${response.status}`;
    throw new LiteApiError(
      message,
      typeof body?.code === 'string' ? body.code : undefined,
      response.status,
      body && typeof body === 'object' ? body : undefined,
    );
  }
  return body.data as T;
}

async function streamRequest<TEvent>(
  path: string,
  init: RequestInit,
  token: string,
  onEvent: (event: TEvent) => void,
): Promise<void> {
  const response = await apiFetch(`/api${path}`, {
    ...init,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({ error: `HTTP ${response.status}` }));
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Stream not available');
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';
    for (const part of parts) {
      if (!part.trim()) continue;
      let eventName = 'message',
        data = '';
      for (const line of part.split('\n')) {
        if (line.startsWith('event: ')) eventName = line.slice(7);
        if (line.startsWith('data: ')) data = line.slice(6);
      }
      if (!data) continue;
      onEvent({ event: eventName, data: JSON.parse(data) } as TEvent);
    }
  }
}

export const liteApi = {
  me: (token: string) => request<UserSummary>('/auth/me', {}, token),
  listPackages: (token: string) =>
    request<AgentPackageSummary[]>(PACKAGE_ROUTES.LIST, {}, token),
  getPackage: (token: string, packageId: string) =>
    request<AgentPackageDetail>(
      `${PACKAGE_ROUTES.DETAIL}?packageId=${encodeURIComponent(packageId)}`,
      {},
      token,
    ),
  renamePackage: (token: string, packageId: string, name: string) =>
    request<AgentPackageDetail>(
      `/packages/${packageId}`,
      { method: 'PATCH', body: JSON.stringify({ name }) },
      token,
    ),
  saveManualMarkdownEdit: (
    token: string,
    packageId: string,
    data: {
      target: 'agent' | 'rubric' | 'skill';
      content: string;
      skillId?: string;
      note?: string;
    },
  ) =>
    request<AgentPackageDetail>(
      `/packages/${packageId}/manual-edit`,
      { method: 'POST', body: JSON.stringify(data) },
      token,
    ),
  repairRubric: (token: string, packageId: string, model?: string) =>
    request<AgentPackageDetail>(
      `/packages/${packageId}/rubric/repair`,
      { method: 'POST', body: JSON.stringify({ model }) },
      token,
    ),
  optimizeRubric: (token: string, packageId: string, model?: string) =>
    request<AgentPackageDetail>(
      `/packages/${packageId}/rubric/optimize`,
      { method: 'POST', body: JSON.stringify({ model }) },
      token,
    ),
  listVersions: (token: string, packageId: string) =>
    request<PackageVersion[]>(`/packages/${packageId}/versions`, {}, token),
  listPackageSkills: (
    token: string,
    packageId: string,
    includeRemoved = true,
  ) =>
    actionRequest<PackageSkillRecord[]>(token, 'skill.list', packageId, {
      includeRemoved,
    }),
  listSkillVersions: (
    token: string,
    packageId: string,
    skillId: string,
    options?: {
      includeDiscarded?: boolean;
      cursor?: string;
      limit?: number;
    },
  ) =>
    actionRequest<SkillVersionListResult>(
      token,
      'skill.version.list',
      packageId,
      {
        skillId,
        includeDiscarded: options?.includeDiscarded,
        cursor: options?.cursor,
        limit: options?.limit,
      },
    ),
  getSkillVersionDetail: (token: string, packageId: string, versionId: string) =>
    actionRequest<SkillVersionDetail>(
      token,
      'skill.version.detail',
      packageId,
      { versionId },
    ),
  rollbackSkillVersion: (
    token: string,
    packageId: string,
    payload: RollbackSkillVersionPayload,
  ) =>
    actionRequest<{
      packageId: string;
      packageVersionId: string;
      versionNumber: number;
      rolledBackSkillVersionId: string;
    }>(token, 'skill.version.rollback', packageId, payload),
  discardSkillVersion: (
    token: string,
    packageId: string,
    versionId: string,
    reason: string,
  ) =>
    actionRequest<SkillVersionDetail>(
      token,
      'skill.version.discard',
      packageId,
      { versionId, reason },
    ),
  undiscardSkillVersion: (token: string, packageId: string, versionId: string) =>
    actionRequest<SkillVersionDetail>(
      token,
      'skill.version.undiscard',
      packageId,
      { versionId },
    ),
  generatePackageStream: (
    token: string,
    instruction: string,
    model: string | undefined,
    documents: Array<{ name: string; content: string }>,
    onEvent: (event: PackageGenerateStreamEvent) => void,
  ) =>
    streamRequest<PackageGenerateStreamEvent>(
      '/packages/generate/stream',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction, model, documents }),
      },
      token,
      onEvent,
    ),
  deletePackage: (token: string, packageId: string) =>
    request<{ ok: boolean }>(
      `/packages/${packageId}`,
      { method: 'DELETE' },
      token,
    ),
  listThreads: (token: string, packageId: string) =>
    request<ArenaThread[]>(
      `${ARENA_ROUTES.THREADS}?packageId=${encodeURIComponent(packageId)}`,
      {},
      token,
    ),
  createThread: (token: string, packageId: string, model?: string) =>
    request<ArenaThread>(
      ARENA_ROUTES.CREATE_THREAD,
      { method: 'POST', body: JSON.stringify({ packageId, model }) },
      token,
    ),
  createArenaThread: (
    token: string,
    packageId: string,
    payload: {
      idempotencyKey: string;
      basePackageVersionId: string;
      left: SkillArenaSelectionPayload;
      right: SkillArenaSelectionPayload;
      model?: string;
    },
  ) =>
    actionRequest<ArenaThread>(token, 'arena.thread.create', packageId, {
      arenaKind: 'skill_arena',
      idempotencyKey: payload.idempotencyKey,
      basePackageVersionId: payload.basePackageVersionId,
      left: payload.left,
      right: payload.right,
      model: payload.model,
    }),
  getThread: (token: string, threadId: string) =>
    request<ArenaThreadDetail>(
      `${ARENA_ROUTES.THREAD_DETAIL}?threadId=${encodeURIComponent(threadId)}`,
      {},
      token,
    ),
  getArenaThreadDetail: (token: string, packageId: string, threadId: string) =>
    actionRequest<ArenaThreadDetail>(token, 'arena.thread.detail', packageId, {
      threadId,
    }),
  sendMessageStream: (
    token: string,
    threadId: string,
    content: string,
    model: string | undefined,
    mode: ArenaMode,
    onEvent: (event: ArenaMessageStreamEvent) => void,
  ) =>
    streamRequest<ArenaMessageStreamEvent>(
      `${ARENA_ROUTES.MESSAGE_STREAM}?threadId=${encodeURIComponent(threadId)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, model, mode }),
      },
      token,
      onEvent,
    ),
  generateReportStream: (
    token: string,
    threadId: string,
    model: string | undefined,
    onEvent: (event: ReportStreamEvent) => void,
  ) =>
    streamRequest<ReportStreamEvent>(
      `/arena/threads/${threadId}/report/stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      },
      token,
      onEvent,
    ),
  optimizePackageStream: (
    token: string,
    packageId: string,
    threadId: string,
    model: string | undefined,
    onEvent: (event: OptimizeStreamEvent) => void,
  ) =>
    streamRequest<OptimizeStreamEvent>(
      `/packages/${packageId}/optimize/stream`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threadId, model }),
      },
      token,
      onEvent,
    ),
  async importPackage(token: string, file: File): Promise<AgentPackageDetail> {
    const formData = new FormData();
    formData.append('file', file, file.name);
    const response = await apiFetch(`/api/packages/import`, {
      method: 'POST',
      body: formData,
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!response.ok) {
      const body = await response
        .json()
        .catch(() => ({ error: `HTTP ${response.status}` }));
      throw new Error(body.error || `HTTP ${response.status}`);
    }
    return response.json();
  },
  diagnosePackage: (
    token: string,
    packageId: string,
    threadId: string,
    model?: string,
  ) =>
    request<DiagnosisResult & { session?: InteractiveOptimizationSession }>(
      `/packages/${packageId}/optimize/diagnose`,
      { method: 'POST', body: JSON.stringify({ threadId, model }) },
      token,
    ),
  listInteractiveSessions: (token: string, packageId: string) =>
    request<InteractiveOptimizationSession[]>(
      `/packages/${packageId}/optimize/sessions`,
      {},
      token,
    ),
  chatOptimize: (
    token: string,
    packageId: string,
    sessionId: string | undefined,
    messages: Array<{ role: string; content: string }>,
    adoptedChanges: AdoptedChange[],
    model?: string,
  ) =>
    request<ChatOptimizeResult>(
      `/packages/${packageId}/optimize/chat`,
      {
        method: 'POST',
        body: JSON.stringify({ sessionId, messages, adoptedChanges, model }),
      },
      token,
    ),
  applyInteractiveChanges: (
    token: string,
    packageId: string,
    sessionId: string | undefined,
    changes: AdoptedChange[],
    note?: string,
  ) =>
    request<{ versionId: string; versionNumber: number }>(
      `/packages/${packageId}/optimize/apply`,
      { method: 'POST', body: JSON.stringify({ sessionId, changes, note }) },
      token,
    ),
  compareVersions: (
    token: string,
    packageId: string,
    baseVersionId: string,
    targetVersionId: string,
    model?: string,
  ) =>
    request<VersionCompareResult>(
      `/packages/${packageId}/versions/compare`,
      {
        method: 'POST',
        body: JSON.stringify({ baseVersionId, targetVersionId, model }),
      },
      token,
    ),
  updateVersionNote: (
    token: string,
    packageId: string,
    versionId: string,
    note: string,
  ) =>
    request<PackageVersion>(
      `/packages/${packageId}/versions/${versionId}/note`,
      { method: 'POST', body: JSON.stringify({ note }) },
      token,
    ),
  async exportPackage(token: string, packageId: string): Promise<void> {
    const response = await apiFetch(`/api/packages/${packageId}/export`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!response.ok) {
      const body = await response
        .json()
        .catch(() => ({ error: `HTTP ${response.status}` }));
      throw new Error(body.error || `HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${packageId}.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  },
};

export { LiteApiError };
