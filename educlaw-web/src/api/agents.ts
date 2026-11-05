import type {
  ArenaThread,
  AgentProvisionInput,
  AgentWorkspace,
  AgentWorkspaceInput,
} from '@educlaw/shared';
import { apiFetch } from './client';

export type {
  AgentProvisionInput,
  AgentWorkspace,
  AgentWorkspaceInput,
  AgentSkillBinding,
} from '@educlaw/shared';
export type AgentWorkspaceDetail = AgentWorkspace;

export class AgentWorkspaceApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AgentWorkspaceApiError';
    this.status = status;
  }
}

async function request<T>(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await apiFetch(`/api/agent-workspaces${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new AgentWorkspaceApiError(
      body?.error || `HTTP ${response.status}`,
      response.status,
    );
  }
  if (body === null)
    throw new AgentWorkspaceApiError('Agent 服务返回了无法识别的数据', 502);
  return body as T;
}

const pathFor = (id: string) => `/${encodeURIComponent(id)}`;

export const agentsApi = {
  list: (token: string) => request<AgentWorkspace[]>(token, ''),
  get: (token: string, agentId: string) =>
    request<AgentWorkspaceDetail>(token, pathFor(agentId)),
  create: (token: string, input: AgentWorkspaceInput) =>
    request<AgentWorkspace>(token, '', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  provision: (token: string, input: AgentProvisionInput) =>
    request<AgentWorkspace>(token, '/provision', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (
    token: string,
    agentId: string,
    input: AgentWorkspaceInput & { expectedUpdatedAt: string },
  ) =>
    request<AgentWorkspace>(token, pathFor(agentId), {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  listConversations: (token: string, agentId: string) =>
    request<ArenaThread[]>(token, `${pathFor(agentId)}/conversations`),
  createConversation: (
    token: string,
    agentId: string,
    input: { purpose: 'run' | 'test'; requestId: string },
  ) =>
    request<ArenaThread>(token, `${pathFor(agentId)}/conversations`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};
