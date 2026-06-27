import type { AgentProfile, AgentConfig } from '@educlaw/shared';
import type { AgentConfigWithOwner } from '../stores/agent';
import { apiFetch, apiFetchJson, apiPost, apiPut, API_BASE } from './client';

// Re-export for backwards compatibility
export { apiFetch } from './client';
import { getToken } from './client';

export function listProfiles(): Promise<AgentProfile[]> {
  return apiFetchJson(`${API_BASE}/profiles`);
}

export function listAgents(): Promise<AgentConfigWithOwner[]> {
  return apiFetchJson(`${API_BASE}/agents`);
}

export function createAgent(profileFileName: string, sharedSkills?: string[]): Promise<AgentConfig> {
  return apiPost(`${API_BASE}/agents`, { profileFileName, sharedSkills });
}

export function removeAgent(id: string): Promise<{ ok: boolean }> {
  return apiPost(`${API_BASE}/agents/${id}/delete`);
}

export function startAgent(id: string): Promise<AgentConfig> {
  return apiPost(`${API_BASE}/agents/${id}/start`);
}

export function stopAgent(id: string): Promise<AgentConfig> {
  return apiPost(`${API_BASE}/agents/${id}/stop`);
}

export function syncDb(agentId: string): Promise<void> {
  return apiPost(`${API_BASE}/agents/${agentId}/sync-db`);
}

export function updateAgentSettings(id: string, settings: { public?: boolean }): Promise<void> {
  return apiPost(`${API_BASE}/agents/${id}/settings`, settings);
}

export interface FileEntry {
  name: string;
  type: 'file' | 'directory';
}

export function listFiles(agentId: string, dirPath = '.'): Promise<FileEntry[]> {
  return apiFetchJson(`${API_BASE}/agents/${agentId}/files?path=${encodeURIComponent(dirPath)}`);
}

export function getFileRawUrl(agentId: string, filePath: string): string {
  const token = getToken();
  return `${API_BASE}/agents/${agentId}/file-raw?path=${encodeURIComponent(filePath)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
}

export async function readFile(agentId: string, filePath: string): Promise<string> {
  const data = await apiFetchJson<{ content: string }>(`${API_BASE}/agents/${agentId}/file-content?path=${encodeURIComponent(filePath)}`);
  return data.content;
}

export function writeFile(agentId: string, filePath: string, content: string): Promise<void> {
  return apiPut(`${API_BASE}/agents/${agentId}/file-content?path=${encodeURIComponent(filePath)}`, { content });
}

export function createFile(agentId: string, filePath: string): Promise<void> {
  return apiPost(`${API_BASE}/agents/${agentId}/fs/create-file`, { path: filePath });
}

export function createDir(agentId: string, dirPath: string): Promise<void> {
  return apiPost(`${API_BASE}/agents/${agentId}/fs/create-dir`, { path: dirPath });
}

export function renamePath(agentId: string, oldPath: string, newPath: string): Promise<void> {
  return apiPost(`${API_BASE}/agents/${agentId}/fs/rename`, { oldPath, newPath });
}

export function deletePath(agentId: string, targetPath: string): Promise<void> {
  return apiPost(`${API_BASE}/agents/${agentId}/fs/delete`, { path: targetPath });
}

export async function uploadFiles(agentId: string, dir: string, files: globalThis.File[]): Promise<void> {
  const formData = new FormData();
  formData.append('dir', dir);
  for (const f of files) {
    formData.append('files', f, f.name);
  }
  const res = await apiFetch(`${API_BASE}/agents/${agentId}/fs/upload`, {
    method: 'POST',
    body: formData,
    // Do NOT set Content-Type 閳?browser sets it with boundary automatically
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
}

/**
 * Upload files with relative paths (preserving folder structure) and progress callback.
 * Uses XMLHttpRequest for upload progress reporting.
 */
export function uploadFilesWithPaths(
  agentId: string,
  dir: string,
  items: { file: globalThis.File; relativePath: string }[],
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('dir', dir);
    for (const { file, relativePath } of items) {
      formData.append('files', file, file.name);
      formData.append('paths', relativePath);
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/agents/${agentId}/fs/upload`);
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    if (onProgress) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) onProgress(e.loaded, e.total);
      });
    }

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        try {
          const body = JSON.parse(xhr.responseText);
          reject(new Error(body.error || `HTTP ${xhr.status}`));
        } catch {
          reject(new Error(`HTTP ${xhr.status}`));
        }
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Upload failed')));
    xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));
    xhr.send(formData);
  });
}

export function listRuntimes(): Promise<string[]> {
  return apiFetchJson(`${API_BASE}/runtimes`);
}

export function listLLMModels(): Promise<{ name: string; modelName: string }[]> {
  return apiFetchJson(`${API_BASE}/llm/models`);
}

export interface SkillDetail {
  dirName: string;
  name: string;
  description: string;
  content: string;
  source?: 'preset' | 'public' | 'user';
}

export interface SkillSummary {
  dirName: string;
  name: string;
  description: string;
  source?: 'preset' | 'public' | 'user';
}

export function listSkillDetails(): Promise<SkillDetail[]> {
  return apiFetchJson(`${API_BASE}/llm/skill-details`);
}

export function listSkillSummaries(): Promise<SkillSummary[]> {
  return apiFetchJson(`${API_BASE}/llm/skill-summaries`);
}

export function getSkillDetail(dirName: string): Promise<SkillDetail> {
  return apiFetchJson(`${API_BASE}/llm/skill-detail/${encodeURIComponent(dirName)}`);
}

export interface ToolSummary {
  dirName: string;
  name: string;
  description: string;
  source?: 'preset' | 'public' | 'user';
}

export function listToolSummaries(): Promise<ToolSummary[]> {
  return apiFetchJson(`${API_BASE}/llm/tool-summaries`);
}

export function deleteUserTool(dirName: string): Promise<void> {
  return apiPost(`${API_BASE}/llm/tools/user/${encodeURIComponent(dirName)}/delete`);
}

/**
 * Upload a folder as a new user tool, preserving relative paths.
 * Uses XMLHttpRequest for upload progress reporting.
 */
export function uploadUserTool(
  dirName: string,
  items: { file: globalThis.File; relativePath: string }[],
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('dirName', dirName);
    for (const { file, relativePath } of items) {
      formData.append('files', file, file.name);
      formData.append('paths', relativePath);
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/llm/tools/user/upload`);
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    if (onProgress) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) onProgress(e.loaded, e.total);
      });
    }

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        try {
          const body = JSON.parse(xhr.responseText);
          reject(new Error(body.error || `HTTP ${xhr.status}`));
        } catch {
          reject(new Error(`HTTP ${xhr.status}`));
        }
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Upload failed')));
    xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));
    xhr.send(formData);
  });
}

export function listToolFiles(source: 'preset' | 'public' | 'user', dirName: string, dirPath = '.'): Promise<FileEntry[]> {
  return apiFetchJson(`${API_BASE}/llm/tools/${source}/${encodeURIComponent(dirName)}/files?path=${encodeURIComponent(dirPath)}`);
}

export async function readToolFile(source: 'preset' | 'public' | 'user', dirName: string, filePath: string): Promise<string> {
  const data = await apiFetchJson<{ content: string }>(`${API_BASE}/llm/tools/${source}/${encodeURIComponent(dirName)}/file-content?path=${encodeURIComponent(filePath)}`);
  return data.content;
}

// 閳光偓閳光偓閳光偓 User profile CRUD 閳光偓閳光偓閳光偓

export function createUserProfile(profile: { name: string; description?: string; details?: string; agent_runtime?: string; agent_template?: string; tools?: string[]; skills?: string[]; subagents?: string[] }): Promise<{ fileName: string }> {
  return apiPost(`${API_BASE}/profiles/user`, profile);
}

export function updateUserProfile(fileName: string, profile: { name?: string; description?: string; details?: string; agent_runtime?: string; agent_template?: string; tools?: string[]; skills?: string[]; subagents?: string[] }): Promise<void> {
  return apiPut(`${API_BASE}/profiles/user/${encodeURIComponent(fileName)}`, profile);
}

export function deleteUserProfile(fileName: string): Promise<void> {
  return apiPost(`${API_BASE}/profiles/user/${encodeURIComponent(fileName)}/delete`);
}

export function copyProfileToUser(sourceFileName: string): Promise<{ fileName: string }> {
  return apiPost(`${API_BASE}/profiles/user/copy`, { sourceFileName });
}

// 閳光偓閳光偓閳光偓 Profile import / export 閳光偓閳光偓閳光偓

export async function exportProfile(fileName: string): Promise<void> {
  const res = await apiFetch(`${API_BASE}/profiles/user/${encodeURIComponent(fileName)}/export`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?(.+?)"?$/);
  const downloadName = match ? decodeURIComponent(match[1]) : `${fileName}.zip`;
  const a = document.createElement('a');
  a.href = url;
  a.download = downloadName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface ImportResult {
  fileName: string;
  profileSkipped: boolean;
  skillsImported: number;
  toolsImported: number;
}

export async function importProfile(file: File): Promise<ImportResult> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await apiFetch(`${API_BASE}/profiles/user/import`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// 閳光偓閳光偓閳光偓 User skill CRUD 閳光偓閳光偓閳光偓

export function createUserSkill(dirName: string, name: string, description: string, content: string): Promise<void> {
  return apiPost(`${API_BASE}/llm/skills/user`, { dirName, name, description, content });
}

export function updateUserSkill(dirName: string, name: string, description: string, content: string): Promise<{ ok: boolean; dirName: string }> {
  return apiPut(`${API_BASE}/llm/skills/user/${encodeURIComponent(dirName)}`, { name, description, content });
}

export function deleteUserSkill(dirName: string): Promise<void> {
  return apiPost(`${API_BASE}/llm/skills/user/${encodeURIComponent(dirName)}/delete`);
}

// 閳光偓閳光偓閳光偓 Publish / Unpublish 閳光偓閳光偓閳光偓

export function publishProfile(fileName: string): Promise<void> {
  return apiPost(`${API_BASE}/profiles/user/${encodeURIComponent(fileName)}/publish`);
}

export function unpublishProfile(fileName: string): Promise<void> {
  return apiPost(`${API_BASE}/profiles/user/${encodeURIComponent(fileName)}/unpublish`);
}

export function publishSkill(dirName: string): Promise<void> {
  return apiPost(`${API_BASE}/llm/skills/user/${encodeURIComponent(dirName)}/publish`);
}

export function unpublishSkill(dirName: string): Promise<void> {
  return apiPost(`${API_BASE}/llm/skills/user/${encodeURIComponent(dirName)}/unpublish`);
}

export function publishTool(dirName: string): Promise<void> {
  return apiPost(`${API_BASE}/llm/tools/user/${encodeURIComponent(dirName)}/publish`);
}

export function unpublishTool(dirName: string): Promise<void> {
  return apiPost(`${API_BASE}/llm/tools/user/${encodeURIComponent(dirName)}/unpublish`);
}

// 閳光偓閳光偓閳光偓 Skill file operations 閳光偓閳光偓閳光偓

export function listSkillFiles(source: 'preset' | 'public' | 'user', dirName: string, dirPath = '.'): Promise<FileEntry[]> {
  return apiFetchJson(`${API_BASE}/llm/skills/${source}/${encodeURIComponent(dirName)}/files?path=${encodeURIComponent(dirPath)}`);
}

export async function readSkillFile(source: 'preset' | 'public' | 'user', dirName: string, filePath: string): Promise<string> {
  const data = await apiFetchJson<{ content: string }>(`${API_BASE}/llm/skills/${source}/${encodeURIComponent(dirName)}/file-content?path=${encodeURIComponent(filePath)}`);
  return data.content;
}

export function writeSkillFile(dirName: string, filePath: string, content: string): Promise<void> {
  return apiPut(`${API_BASE}/llm/skills/user/${encodeURIComponent(dirName)}/file-content?path=${encodeURIComponent(filePath)}`, { content });
}

export async function uploadSkillFiles(dirName: string, dir: string, files: globalThis.File[]): Promise<void> {
  const formData = new FormData();
  formData.append('dir', dir);
  for (const f of files) {
    formData.append('files', f, f.name);
  }
  const res = await apiFetch(`${API_BASE}/llm/skills/user/${encodeURIComponent(dirName)}/fs/upload`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
}

export function createSkillFile(dirName: string, filePath: string): Promise<void> {
  return apiPost(`${API_BASE}/llm/skills/user/${encodeURIComponent(dirName)}/fs/create-file`, { path: filePath });
}

export function createSkillDir(dirName: string, dirPath: string): Promise<void> {
  return apiPost(`${API_BASE}/llm/skills/user/${encodeURIComponent(dirName)}/fs/create-dir`, { path: dirPath });
}

export function deleteSkillPath(dirName: string, targetPath: string): Promise<void> {
  return apiPost(`${API_BASE}/llm/skills/user/${encodeURIComponent(dirName)}/fs/delete`, { path: targetPath });
}

export function renameSkillPath(dirName: string, oldPath: string, newPath: string): Promise<void> {
  return apiPost(`${API_BASE}/llm/skills/user/${encodeURIComponent(dirName)}/fs/rename`, { oldPath, newPath });
}

export interface GenerateProfileEvent {
  event: 'step' | 'delta' | 'llm_waiting' | 'llm_streaming' | 'artifact_decision' | 'profile_preview' | 'skill_preview' | 'profile' | 'skill' | 'done' | 'error';
  data: Record<string, unknown>;
}

/**
 * Stream profile generation from uploaded file via SSE.
 * Calls onEvent for each server-sent event.
 */
export async function generateProfileFromFile(
  file: File,
  model: string | undefined,
  onEvent: (evt: GenerateProfileEvent) => void,
  sharedSkills?: string[],
): Promise<void> {
  const formData = new FormData();
  formData.append('file', file, file.name);
  if (model) formData.append('model', model);
  if (sharedSkills && sharedSkills.length > 0) {
    formData.append('sharedSkills', JSON.stringify(sharedSkills));
  }

  const res = await apiFetch(`${API_BASE}/llm/generate-profile-from-file`, {
    method: 'POST',
    body: formData,
    // Do NOT set Content-Type 閳?browser sets it with boundary automatically
  });

  if (!res.ok) {
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const err = await res.json();
      throw new Error(err.error || 'Unknown error');
    }
    throw new Error(`HTTP ${res.status}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split('\n\n');
    buffer = parts.pop()!;

    for (const part of parts) {
      if (!part.trim()) continue;
      let event = 'message';
      let data = '';
      for (const line of part.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7);
        else if (line.startsWith('data: ')) data = line.slice(6);
      }
      if (data) {
        try {
          onEvent({ event: event as GenerateProfileEvent['event'], data: JSON.parse(data) });
        } catch { /* skip malformed */ }
      }
    }
  }
}

/**
 * Stream profile generation via SSE.
 * Calls onEvent for each server-sent event.
 */
export async function generateProfile(
  instruction: string,
  model: string | undefined,
  onEvent: (evt: GenerateProfileEvent) => void,
  sharedSkills?: string[],
): Promise<void> {
  const res = await apiFetch(`${API_BASE}/llm/generate-profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instruction, model, sharedSkills }),
  });

  if (!res.ok) {
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const err = await res.json();
      throw new Error(err.error || 'Unknown error');
    }
    throw new Error(`HTTP ${res.status}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split('\n\n');
    buffer = parts.pop()!;

    for (const part of parts) {
      if (!part.trim()) continue;
      let event = 'message';
      let data = '';
      for (const line of part.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7);
        else if (line.startsWith('data: ')) data = line.slice(6);
      }
      if (data) {
        try {
          onEvent({ event: event as GenerateProfileEvent['event'], data: JSON.parse(data) });
        } catch { /* skip malformed */ }
      }
    }
  }
}


export interface OptimizationRequestInput {
  instruction?: string;
  chatContext?: Array<{ role: 'user' | 'assistant'; content: string }>;
  model?: string;
}

export type OptimizationTargetKind = 'profile' | 'skill' | 'agent';
export type OptimizationTargetScope = 'user' | 'preset' | 'shared';
export type OptimizationTriggerSource = 'detail' | 'chat';
export type OptimizationRunStatus = 'pending' | 'partial' | 'applied' | 'rejected' | 'failed';
export type OptimizationItemStatus = 'pending' | 'applied' | 'rejected';
export type OptimizationPatchType = 'profile_fields' | 'skill_markdown' | 'agent_settings';

export interface OptimizationRun {
  id: string;
  user_id: string;
  target_kind: OptimizationTargetKind;
  target_ref: string;
  target_label: string;
  target_scope: OptimizationTargetScope;
  trigger_source: OptimizationTriggerSource;
  instruction: string | null;
  model: string | null;
  summary: string;
  status: OptimizationRunStatus;
  created_at: string;
  updated_at: string;
}

export interface OptimizationItem {
  id: string;
  run_id: string;
  user_id: string;
  suggestion_key: string;
  title: string;
  rationale: string;
  risk: 'low' | 'medium' | 'high';
  patch_type: OptimizationPatchType;
  preview: string;
  status: OptimizationItemStatus;
  result_note: string | null;
  created_at: string;
  updated_at: string;
  patch: Record<string, unknown>;
}

export interface OptimizationRunView {
  run: OptimizationRun;
  items: OptimizationItem[];
}

export interface OptimizationSkippedResult {
  created: false;
  target_kind: OptimizationTargetKind;
  target_ref: string;
  target_label: string;
  message: string;
}

export interface OptimizationCreatedResult extends OptimizationRunView {
  created: true;
}

export type OptimizationCreateResult = OptimizationCreatedResult | OptimizationSkippedResult;

export function optimizeProfile(fileName: string, input: OptimizationRequestInput = {}): Promise<OptimizationCreateResult> {
  return apiPost(`${API_BASE}/optimize/profile/${encodeURIComponent(fileName)}`, input);
}

export function optimizeSkill(dirName: string, input: OptimizationRequestInput = {}): Promise<OptimizationCreateResult> {
  return apiPost(`${API_BASE}/optimize/skill/${encodeURIComponent(dirName)}`, input);
}

export function optimizeAgent(id: string, input: OptimizationRequestInput = {}): Promise<OptimizationCreateResult> {
  return apiPost(`${API_BASE}/optimize/agent/${encodeURIComponent(id)}`, input);
}

export function listOptimizationRuns(): Promise<OptimizationRunView[]> {
  return apiFetchJson(`${API_BASE}/optimize/runs`);
}

export function getOptimizationRun(runId: string): Promise<OptimizationRunView> {
  return apiFetchJson(`${API_BASE}/optimize/runs/${encodeURIComponent(runId)}`);
}

export function applyOptimizationRun(runId: string, suggestionKey?: string): Promise<OptimizationRunView> {
  return apiPost(`${API_BASE}/optimize/runs/${encodeURIComponent(runId)}/apply`, suggestionKey ? { suggestionKey } : {});
}

export function rejectOptimizationRun(runId: string, suggestionKey?: string): Promise<OptimizationRunView> {
  return apiPost(`${API_BASE}/optimize/runs/${encodeURIComponent(runId)}/reject`, suggestionKey ? { suggestionKey } : {});
}

export function deleteOptimizationRun(runId: string): Promise<{ ok: boolean }> {
  return apiPost(`${API_BASE}/optimize/runs/${encodeURIComponent(runId)}/delete`);
}


export interface EvaluationDimensionSpec {
  key: string;
  name: string;
  description: string;
  weight: number;
  scale: number;
  passThreshold?: number;
}

export interface EvaluationSpec {
  source: 'document' | 'manual' | 'default' | 'inherited';
  title: string;
  dimensions: EvaluationDimensionSpec[];
}

export interface ArenaDimensionScore {
  key: string;
  name: string;
  score: number;
  maxScore: number;
  weight: number;
  weightedScore: number;
  passed: boolean;
  reason: string;
}

export interface ArenaSideResult {
  output: string;
  totalScore: number;
  summary: string;
  shouldRevise: boolean;
  weaknesses: string[];
  dimensions: ArenaDimensionScore[];
}

export interface ArenaReport {
  baselineTotal: number;
  enhancedTotal: number;
  delta: number;
  winningSide: 'baseline' | 'enhanced' | 'tie';
  strongestDimensions: string[];
  weakestDimensions: string[];
  recommendation: string;
  optimizeInstruction: string;
}

export interface ArenaRun {
  id: string;
  user_id: string;
  target_kind: OptimizationTargetKind;
  target_ref: string;
  target_label: string;
  target_scope: OptimizationTargetScope;
  prompt: string;
  model: string | null;
  should_optimize: boolean;
  status: 'completed' | 'failed';
  created_at: string;
  updated_at: string;
}

export interface ArenaRunView {
  run: ArenaRun;
  evaluation_spec: EvaluationSpec;
  baseline: ArenaSideResult;
  enhanced: ArenaSideResult;
  report: ArenaReport;
}

export interface ArenaRequestInput {
  prompt: string;
  model?: string;
}

export function createArenaProfileRun(fileName: string, input: ArenaRequestInput): Promise<ArenaRunView> {
  return apiPost(API_BASE + '/arena/profile/' + encodeURIComponent(fileName), input);
}

export function createArenaSkillRun(dirName: string, input: ArenaRequestInput): Promise<ArenaRunView> {
  return apiPost(API_BASE + '/arena/skill/' + encodeURIComponent(dirName), input);
}

export function createArenaAgentRun(id: string, input: ArenaRequestInput): Promise<ArenaRunView> {
  return apiPost(API_BASE + '/arena/agent/' + encodeURIComponent(id), input);
}

export function listArenaRuns(): Promise<ArenaRunView[]> {
  return apiFetchJson(API_BASE + '/arena/runs');
}

export function getArenaRun(runId: string): Promise<ArenaRunView> {
  return apiFetchJson(API_BASE + '/arena/runs/' + encodeURIComponent(runId));
}

export function deleteArenaRun(runId: string): Promise<{ ok: boolean }> {
  return apiPost(API_BASE + '/arena/runs/' + encodeURIComponent(runId) + '/delete');
}



export interface ArenaChatSession {
  id: string;
  user_id: string;
  target_kind: OptimizationTargetKind;
  target_ref: string;
  target_label: string;
  target_scope: OptimizationTargetScope;
  model: string | null;
  evaluation_spec: EvaluationSpec;
  workspace_id?: string | null;
  baseline_session_id?: string | null;
  enhanced_session_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArenaChatMessage {
  id: string;
  arena_session_id: string;
  user_id: string;
  side: 'shared' | 'baseline' | 'enhanced';
  role: 'user' | 'assistant';
  content: string;
  turn_index: number;
  created_at: string;
}

export interface ArenaChatSessionView {
  session: ArenaChatSession;
  messages: ArenaChatMessage[];
}

const legacySessionMarker = ['o', 'a', 'h'].join('');
const legacyBaselineSessionKey = ['baseline', legacySessionMarker, 'session', 'id'].join('_');
const legacyEnhancedSessionKey = ['enhanced', legacySessionMarker, 'session', 'id'].join('_');

function normalizeArenaChatSession(payload: Record<string, unknown>): ArenaChatSession {
  return {
    id: String(payload.id ?? ''),
    user_id: String(payload.user_id ?? ''),
    target_kind: payload.target_kind as OptimizationTargetKind,
    target_ref: String(payload.target_ref ?? ''),
    target_label: String(payload.target_label ?? ''),
    target_scope: payload.target_scope as OptimizationTargetScope,
    model: (payload.model as string | null) ?? null,
    evaluation_spec: payload.evaluation_spec as EvaluationSpec,
    workspace_id: (payload.workspace_id as string | null | undefined) ?? null,
    baseline_session_id:
      (payload.baseline_session_id as string | null | undefined)
      ?? (payload[legacyBaselineSessionKey] as string | null | undefined)
      ?? null,
    enhanced_session_id:
      (payload.enhanced_session_id as string | null | undefined)
      ?? (payload[legacyEnhancedSessionKey] as string | null | undefined)
      ?? null,
    created_at: String(payload.created_at ?? ''),
    updated_at: String(payload.updated_at ?? ''),
  };
}

function normalizeArenaChatSessionView(payload: Record<string, unknown>): ArenaChatSessionView {
  return {
    session: normalizeArenaChatSession((payload.session as Record<string, unknown>) ?? {}),
    messages: Array.isArray(payload.messages) ? (payload.messages as ArenaChatMessage[]) : [],
  };
}

export interface ArenaChatSendResult {
  session: ArenaChatSession;
  messages: ArenaChatMessage[];
}

export type ArenaChatStreamEvent =
  | { event: 'user_message'; data: { message: ArenaChatMessage } }
  | { event: 'side_start'; data: { side: 'baseline' | 'enhanced' } }
  | { event: 'delta'; data: { side: 'baseline' | 'enhanced'; delta: string } }
  | { event: 'side_done'; data: { side: 'baseline' | 'enhanced'; content: string; ok: boolean; error?: string } }
  | { event: 'done'; data: { session: ArenaChatSession; messages: ArenaChatMessage[] } }
  | { event: 'error'; data: { error: string } }
  | { event: 'stream_end'; data: { ok: boolean } };

export function createArenaChatProfileSession(fileName: string, input: { model?: string } = {}): Promise<ArenaChatSessionView> {
  return apiPost(API_BASE + '/arena/chat/profile/' + encodeURIComponent(fileName), input).then((payload) =>
    normalizeArenaChatSessionView(payload as Record<string, unknown>));
}

export function createArenaChatSkillSession(dirName: string, input: { model?: string } = {}): Promise<ArenaChatSessionView> {
  return apiPost(API_BASE + '/arena/chat/skill/' + encodeURIComponent(dirName), input).then((payload) =>
    normalizeArenaChatSessionView(payload as Record<string, unknown>));
}

export function createArenaChatAgentSession(id: string, input: { model?: string } = {}): Promise<ArenaChatSessionView> {
  return apiPost(API_BASE + '/arena/chat/agent/' + encodeURIComponent(id), input).then((payload) =>
    normalizeArenaChatSessionView(payload as Record<string, unknown>));
}

export function listArenaChatSessions(): Promise<ArenaChatSession[]> {
  return apiFetchJson(API_BASE + '/arena/chat/sessions').then((payload) =>
    (Array.isArray(payload) ? payload : []).map((item) => normalizeArenaChatSession(item as Record<string, unknown>)));
}

export function getArenaChatSession(sessionId: string): Promise<ArenaChatSessionView> {
  return apiFetchJson(API_BASE + '/arena/chat/sessions/' + encodeURIComponent(sessionId)).then((payload) =>
    normalizeArenaChatSessionView(payload as Record<string, unknown>));
}

export function sendArenaChatMessage(sessionId: string, input: { content: string; model?: string }): Promise<ArenaChatSendResult> {
  return apiPost(API_BASE + '/arena/chat/sessions/' + encodeURIComponent(sessionId) + '/messages', input);
}

export async function sendArenaChatMessageStream(
  sessionId: string,
  input: { content: string; model?: string },
  onEvent: (event: ArenaChatStreamEvent) => void,
): Promise<void> {
  const res = await apiFetch(API_BASE + '/arena/chat/sessions/' + encodeURIComponent(sessionId) + '/messages/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    throw new Error(`HTTP ${res.status}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split('\n\n');
    buffer = parts.pop()!;

    for (const part of parts) {
      if (!part.trim()) continue;
      let event = 'message';
      let data = '';
      for (const line of part.split('\n')) {
        if (line.startsWith('event: ')) event = line.slice(7);
        else if (line.startsWith('data: ')) data = line.slice(6);
      }
      if (!data) continue;
      try {
        onEvent({ event: event as ArenaChatStreamEvent['event'], data: JSON.parse(data) });
      } catch {
        // ignore malformed chunks
      }
    }
  }
}

export function createArenaReportFromSession(sessionId: string, input: { model?: string } = {}): Promise<ArenaRunView> {
  return apiPost(API_BASE + '/arena/chat/sessions/' + encodeURIComponent(sessionId) + '/report', input);
}

export function deleteArenaChatSession(sessionId: string): Promise<{ ok: boolean }> {
  return apiPost(API_BASE + '/arena/chat/sessions/' + encodeURIComponent(sessionId) + '/delete');
}

