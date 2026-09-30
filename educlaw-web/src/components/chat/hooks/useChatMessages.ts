import { useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { useChatStore, convertRuntimeMessage, parseSessionInfo } from '../../../stores/chat';
import { useAgentStore } from '../../../stores/agent';
import { useOptimizeStore } from '../../../stores/optimize';
import { useLibraryStore } from '../../../stores/library';
import type { Message } from '@educlaw/shared';
import { agentRuntimeApi } from '../../../api/runtime';
import type { ImageAttachment, PromptMode, CustomCommand } from '../PromptInput';

function buildChatContext(agentId: string): Array<{ role: 'user' | 'assistant'; content: string }> {
  const messages = useChatStore.getState().tabs.get(agentId)?.messages ?? [];
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => ({
      role: message.role,
      content: message.parts.filter((part) => part.type === 'text').map((part) => part.text ?? '').join('\n').trim(),
    }))
    .filter((message) => message.content.length > 0);
}

export function useChatMessages(
  agentId: string,
  ensureRunning: () => Promise<boolean>,
  invalidatePendingLoads: () => void,
) {
  const sessionId = useChatStore((s) => s.tabs.get(agentId)?.sessionId ?? null);
  const setSessions = useChatStore((s) => s.setSessions);
  const setSessionId = useChatStore((s) => s.setSessionId);
  const setMessages = useChatStore((s) => s.setMessages);
  const setStreaming = useChatStore((s) => s.setStreaming);
  const api = agentRuntimeApi(agentId);
  const [promptMode, setPromptMode] = useState<PromptMode>('normal');
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const startMessageRefresh = useCallback((sid: string) => {
    let attempts = 0;
    let idleTailPolls = 0;
    const maxAttempts = 120;
    const maxIdleTailPolls = 12;

    function tick(delayMs = 2000) {
      if (attempts >= maxAttempts) return;
      attempts++;
      refreshTimer.current = setTimeout(async () => {
        try {
          const tab = useChatStore.getState().tabs.get(agentId);
          if (!tab || tab.sessionId !== sid) return;

          let converted: Message[] = [];
          const raw = await api.listMessages(sid) as unknown;
          if (Array.isArray(raw) && raw.length > 0) {
            converted = raw.map((message) => convertRuntimeMessage(message as Record<string, unknown>));
            setMessages(agentId, converted);
          }

          const session = await api.getSession(sid) as Record<string, unknown> | null;
          const status = session
            ? ((session.status as { type?: string } | undefined)
              ?? ((session.info as { status?: { type?: string } } | undefined)?.status))
            : undefined;

          if (!status) {
            tick();
            return;
          }

          const isBusy = status.type === 'busy' || status.type === 'running';
          useChatStore.getState().setStreaming(agentId, isBusy);

          if (isBusy) {
            idleTailPolls = 0;
            tick();
            return;
          }

          const lastMessage = converted.at(-1);
          const awaitingVisibleResult = converted.length === 0 || lastMessage?.role !== 'assistant';
          if (awaitingVisibleResult && idleTailPolls < maxIdleTailPolls) {
            idleTailPolls++;
            tick(1000);
          }
        } catch {
          tick();
        }
      }, delayMs);
    }

    tick();
  }, [agentId, api, setMessages]);

  async function handleSend(content: string, images?: ImageAttachment[], agentName?: string) {
    const isShell = promptMode === 'shell';
    const userMsg: Message = {
      id: `temp-user-${Date.now()}`,
      role: 'user',
      parts: [{ type: 'text', text: isShell ? `$ ${content}` : content }],
    };

    invalidatePendingLoads();

    const currentMessages = useChatStore.getState().tabs.get(agentId)?.messages ?? [];
    setMessages(agentId, [...currentMessages, userMsg]);
    setStreaming(agentId, true);
    if (isShell) setPromptMode('normal');

    if (!(await ensureRunning())) {
      const latest = useChatStore.getState().tabs.get(agentId)?.messages ?? [];
      setMessages(agentId, latest.filter((m) => m.id !== userMsg.id));
      setStreaming(agentId, false);
      return;
    }
    const latestTab = useChatStore.getState().tabs.get(agentId);
    const preferredAgentName = agentName || latestTab?.sessions.find((s) => s.id === (latestTab?.sessionId || sessionId))?.agentName;
    let targetSessionId = latestTab?.sessionId || sessionId;
    if (!targetSessionId) {
      const rawSession = await api.createSession(preferredAgentName ? { agentName: preferredAgentName } : undefined) as Record<string, unknown>;
      const session = parseSessionInfo(rawSession);
      const currentSessions = useChatStore.getState().tabs.get(agentId)?.sessions ?? [];
      setSessions(agentId, [...currentSessions, session]);
      invalidatePendingLoads();
      setSessionId(agentId, session.id);
      targetSessionId = session.id;
    }

    if (isShell) {
      api.sendShell(targetSessionId!, content, agentName).then((result) => {
        const store = useChatStore.getState();
        const tab = store.tabs.get(agentId);
        if (!tab) return;
        const assistantMsg = convertRuntimeMessage(result);
        if (assistantMsg.id) {
          store.setMessages(agentId, [...tab.messages, assistantMsg]);
        }
        store.setStreaming(agentId, false);
      }).catch(() => {
        useChatStore.getState().setStreaming(agentId, false);
      });
      return;
    }

    api.sendMessage(targetSessionId!, content, images, preferredAgentName).then((result) => {
      const store = useChatStore.getState();
      const tab = store.tabs.get(agentId);
      if (!tab) return;
      const assistantMsg = convertRuntimeMessage(result);
      if (assistantMsg.id) {
        const messages = [...tab.messages];
        const existIdx = messages.findIndex((m) => m.id === assistantMsg.id);

        if (existIdx >= 0) {
          const existing = messages[existIdx];
          const existingTextLen = existing.parts.reduce((n, p) => n + (p.text?.length ?? 0), 0);
          const postTextLen = assistantMsg.parts.reduce((n, p) => n + (p.text?.length ?? 0), 0);
          if (postTextLen > existingTextLen) {
            messages[existIdx] = assistantMsg;
            store.setMessages(agentId, messages);
          }
        } else {
          store.setMessages(agentId, [...tab.messages, assistantMsg]);
        }
      }

      startMessageRefresh(targetSessionId!);
    }).catch(() => {
      useChatStore.getState().setStreaming(agentId, false);
    });
  }

  function handleSendWithCommand(
    content: string,
    customCommands: CustomCommand[],
    images?: ImageAttachment[],
    agentName?: string,
  ) {
    const trimmed = content.trim();
    if (trimmed.startsWith('/')) {
      const [cmdName, ...args] = trimmed.split(/\s+/);
      const commandName = cmdName.slice(1);
      const chatContext = buildChatContext(agentId);

      if (commandName === 'optimize-agent') {
        void useOptimizeStore.getState().createAgentRun(agentId, { chatContext });
        return;
      }

      if (commandName === 'optimize-profile') {
        const agent = useAgentStore.getState().agents.find((item) => item.id === agentId);
        if (!agent?.profileFileName) {
          toast.error('This agent does not have an attached profile');
          return;
        }
        void useOptimizeStore.getState().createProfileRun(agent.profileFileName, { chatContext });
        return;
      }

      if (commandName === 'optimize-skill') {
        const skillQuery = args.join(' ').trim();
        if (!skillQuery) {
          toast.error('Please provide a skill name after /optimize-skill');
          return;
        }

        void (async () => {
          const library = useLibraryStore.getState();
          if (library.skills.length === 0) {
            await library.fetchSkills(true);
          }
          const skills = useLibraryStore.getState().skills;
          const query = skillQuery.toLowerCase();
          const exactMatches = skills.filter((skill) =>
            skill.dirName.toLowerCase() === query || skill.name.toLowerCase() === query,
          );
          const partialMatches = exactMatches.length > 0
            ? exactMatches
            : skills.filter((skill) =>
                skill.dirName.toLowerCase().includes(query) || skill.name.toLowerCase().includes(query),
              );
          const matches = Array.from(new Map(partialMatches.map((skill) => [skill.dirName, skill])).values());

          if (matches.length === 0) {
            toast.error(`No matching skill found: ${skillQuery}`);
            return;
          }
          if (matches.length > 1) {
            toast.error(`Multiple matching skills found. Please be more specific: ${matches.slice(0, 5).map((skill) => skill.dirName).join(', ')}`);
            return;
          }

          void useOptimizeStore.getState().createSkillRun(matches[0].dirName, { chatContext });
        })();
        return;
      }

      const isCustom = customCommands.some((c) => c.name === commandName);
      if (isCustom) {
        void (async () => {
          if (!(await ensureRunning())) return;
          const latestTab = useChatStore.getState().tabs.get(agentId);
          const targetSessionId = latestTab?.sessionId || sessionId;
          if (!targetSessionId) return;

          const userMsg: Message = {
            id: `temp-user-${Date.now()}`,
            role: 'user',
            parts: [{ type: 'text', text: trimmed }],
          };
          const currentMessages = useChatStore.getState().tabs.get(agentId)?.messages ?? [];
          setMessages(agentId, [...currentMessages, userMsg]);
          setStreaming(agentId, true);
          api.sendCommand(targetSessionId, commandName, args.join(' '), agentName).then((result) => {
            const store = useChatStore.getState();
            const tab = store.tabs.get(agentId);
            if (!tab) return;
            const assistantMsg = convertRuntimeMessage(result);
            if (assistantMsg.id) {
              store.setMessages(agentId, [...tab.messages, assistantMsg]);
            }
            store.setStreaming(agentId, false);
          }).catch(() => {
            useChatStore.getState().setStreaming(agentId, false);
          });
        })();
        return;
      }
    }
    handleSend(content, images, agentName);
  }

  async function handleDeleteMessage(messageId: string) {
    if (!sessionId) return;
    await api.deleteMessage(sessionId, messageId);
    const latestTab = useChatStore.getState().tabs.get(agentId);
    const updated = (latestTab?.messages ?? []).filter((m) => m.id !== messageId);
    setMessages(agentId, updated);
  }

  async function handleAbort() {
    if (!sessionId) return;
    clearTimeout(refreshTimer.current);
    try {
      await api.abort(sessionId);
    } finally {
      setStreaming(agentId, false);
    }
  }

  return {
    promptMode,
    setPromptMode,
    handleSend: handleSendWithCommand,
    handleDeleteMessage,
    handleAbort,
  };
}

