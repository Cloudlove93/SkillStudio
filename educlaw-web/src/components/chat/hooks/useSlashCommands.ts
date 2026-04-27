import { useEffect, useMemo, useState } from 'react';
import { useChatStore } from '../../../stores/chat';
import { agentApi } from '../../../api/oah';
import type { OahAgent, CustomCommand } from '../PromptInput';

export function useSlashCommands(
  agentId: string,
  isRunning: boolean,
  sessionId: string | null,
) {
  const api = useMemo(() => agentApi(agentId), [agentId]);

  const [oahAgents, setOahAgents] = useState<OahAgent[]>([]);
  const [currentOahAgent, setCurrentOahAgent] = useState<string | undefined>();
  const [customCommands, setCustomCommands] = useState<CustomCommand[]>([]);

  // Load OAH agents and custom commands when running
  useEffect(() => {
    if (!isRunning) return;
    api.listAgents().then((data: unknown) => {
      const arr = Array.isArray(data) ? data : [];
      setOahAgents(arr);
      if (!currentOahAgent && arr.length > 0) {
        const sessionAgentName = sessionId
          ? useChatStore.getState().tabs.get(agentId)?.sessions.find((session) => session.id === sessionId)?.agentName
          : undefined;
        const primary = arr.find((a: Record<string, unknown>) => a.mode === 'primary' || a.mode === 'all');
        setCurrentOahAgent(sessionAgentName ?? (primary as Record<string, string>)?.name ?? arr[0]?.name);
      }
    }).catch(() => {});
    api.listCommands().then((data: unknown) => {
      setCustomCommands(Array.isArray(data) ? data : []);
    }).catch(() => {});
  }, [isRunning, agentId, sessionId, currentOahAgent, api]);

  return {
    oahAgents,
    currentOahAgent,
    setCurrentOahAgent,
    customCommands,
  };
}
