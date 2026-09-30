import type { AgentConfig } from '@educlaw/shared';
import type { AgentConfigWithOwner } from '../stores/agent';
import * as api from '../api/manager';

/**
 * Poll until the agent reaches a terminal status (not 'starting').
 * Returns the latest agent config, or undefined if not found.
 */
export async function pollAgentStatus(
  agentId: string,
  maxAttempts = 30,
  intervalMs = 1000,
): Promise<AgentConfig | undefined> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const agents: AgentConfigWithOwner[] = await api.listAgents();
    const latest = agents.find((a) => a.id === agentId);
    if (!latest || latest.status !== 'starting') return latest;
  }
  return undefined;
}
