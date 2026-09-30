import { useEffect, useMemo, useState } from 'react';
import { useChatStore } from '../../../stores/chat';
import { agentRuntimeApi } from '../../../api/runtime';
import type { AgentOption, CustomCommand } from '../PromptInput';

export function useSlashCommands(
  agentId: string,
  isRunning: boolean,
  sessionId: string | null,
) {
  const api = useMemo(() => agentRuntimeApi(agentId), [agentId]);

  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [currentAgent, setCurrentAgent] = useState<string | undefined>();
  const [customCommands, setCustomCommands] = useState<CustomCommand[]>([]);

  // Load available agents and custom commands when running.
  useEffect(() => {
    if (!isRunning) return;
    api.listAgents().then((data: unknown) => {
      const arr = Array.isArray(data) ? data : [];
      setAgents(arr);
      if (!currentAgent && arr.length > 0) {
        const sessionAgentName = sessionId
          ? useChatStore.getState().tabs.get(agentId)?.sessions.find((session) => session.id === sessionId)?.agentName
          : undefined;
        const primary = arr.find((a: Record<string, unknown>) => a.mode === 'primary' || a.mode === 'all');
        setCurrentAgent(sessionAgentName ?? (primary as Record<string, string>)?.name ?? arr[0]?.name);
      }
    }).catch(() => {});
    api.listCommands().then((data: unknown) => {
      setCustomCommands(Array.isArray(data) ? data : []);
    }).catch(() => {});
  }, [isRunning, agentId, sessionId, currentAgent, api]);

  return {
    agents,
    currentAgent,
    setCurrentAgent,
    customCommands,
  };
}
