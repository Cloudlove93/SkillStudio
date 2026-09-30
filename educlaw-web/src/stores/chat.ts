import { create } from 'zustand';
import type { Message, MessagePart, SessionInfo } from '@educlaw/shared';
import { deduplicateById } from '../lib/utils';
import {
  convertRuntimeMessage,
  convertRuntimePart,
} from '../lib/message-converter';
import { useAgentStore, isOwnedAgent } from './agent';

export type { Message, MessagePart, SessionInfo };
export { convertRuntimeMessage, convertRuntimePart };

export type DiaryStatus = 'idle' | 'loading' | 'success' | 'error';

export interface TabState {
  agentId: string;
  agentName: string;
  sessionId: string | null;
  sessions: SessionInfo[];
  messages: Message[];
  isStreaming: boolean;
  diaryStatus: Map<string, DiaryStatus>;
}

interface ChatStore {
  tabs: Map<string, TabState>;
  activeTabId: string | null;

  openTab: (agentId: string, agentName: string) => void;
  closeTab: (agentId: string) => void;
  setActiveTab: (agentId: string | null) => void;
  setSessionId: (agentId: string, sessionId: string) => void;
  setSessions: (agentId: string, sessions: SessionInfo[]) => void;
  markSessionDeleted: (agentId: string, sessionId: string) => void;
  setMessages: (agentId: string, messages: Message[]) => void;
  setStreaming: (agentId: string, streaming: boolean) => void;
  setDiaryStatus: (
    agentId: string,
    sessionId: string,
    status: DiaryStatus,
  ) => void;
  reconcileAgents: (agents: Array<{ id: string; name: string }>) => void;

  handleMessageUpdate: (agentId: string, data: unknown) => void;
  handleMessageRemoved: (agentId: string, data: unknown) => void;
  handleMessagePartUpdate: (agentId: string, data: unknown) => void;
  handleMessagePartRemoved: (agentId: string, data: unknown) => void;
  handleMessagePartDelta: (agentId: string, data: unknown) => void;
  handleSessionUpdate: (agentId: string, data: unknown) => void;
  handleSessionStatus: (agentId: string, data: unknown) => void;
}

/** Parse a session response that may be wrapped as { info: { ... } } or flat. */
export function parseSessionInfo(raw: unknown): SessionInfo {
  const obj = raw as Record<string, unknown>;
  const info = (obj.info ?? obj) as Record<string, unknown>;
  const time = info.time as Record<string, unknown> | undefined;
  const created = time?.created;
  const updated = time?.updated;
  return {
    id: info.id as string,
    title: info.title as string | undefined,
    agentName:
      (info.agentName as string | undefined) ??
      (info.activeAgentName as string | undefined),
    share: info.share as { url: string } | undefined,
    revert: info.revert,
    archived: time?.archived as number | undefined,
    createdAt:
      typeof created === 'number'
        ? new Date(created).toISOString()
        : (created as string | undefined),
    updatedAt:
      typeof updated === 'number'
        ? new Date(updated).toISOString()
        : (updated as string | undefined),
  };
}

function messageTextLength(message: Message): number {
  return message.parts.reduce(
    (total, part) => total + (part.text?.length ?? 0),
    0,
  );
}

function mergeMessagesConservatively(
  current: Message[],
  incoming: Message[],
): Message[] {
  const byId = new Map(
    current.map((message) => [message.id, message] as const),
  );
  const merged = incoming.map((message) => {
    const existing = byId.get(message.id);
    if (!existing) {
      return message;
    }
    return messageTextLength(existing) > messageTextLength(message)
      ? existing
      : message;
  });

  for (const message of current) {
    if (
      message.role === 'assistant' &&
      messageTextLength(message) > 0 &&
      !merged.some((candidate) => candidate.id === message.id)
    ) {
      merged.push(message);
    }
    if (
      message.id.startsWith('temp-user-') &&
      !merged.some((candidate) => candidate.role === 'user')
    ) {
      merged.unshift(message);
    }
  }

  return merged;
}

// Track deleted session IDs per agent so SSE events don't re-add them
const deletedSessionIds = new Map<string, Set<string>>();

/** Helper: immutably update a single tab in the Map */
function updateTab(
  tabs: Map<string, TabState>,
  agentId: string,
  updater: (tab: TabState) => TabState,
): Map<string, TabState> | null {
  const tab = tabs.get(agentId);
  if (!tab) return null;
  const newTabs = new Map(tabs);
  newTabs.set(agentId, updater(tab));
  return newTabs;
}

// Safety timeout: auto-reset isStreaming if stuck for too long (2 minutes)
const STREAMING_TIMEOUT_MS = 2 * 60 * 1000;
const streamingTimers = new Map<string, ReturnType<typeof setTimeout>>();

// --- Delta batching: accumulate high-frequency deltas and flush at ~60fps ---
const DELTA_FLUSH_MS = 16; // ~60fps
interface DeltaEntry {
  partID: string;
  messageID: string;
  sessionID?: string;
  field?: string;
  delta: string;
}
const pendingDeltas = new Map<string, DeltaEntry[]>();
const deltaTimers = new Map<string, ReturnType<typeof setTimeout>>();
const CHAT_DEBUG_PREFIX = '[chat-debug]';

function startStreamingTimer(
  agentId: string,
  set: (partial: Partial<{ tabs: Map<string, TabState> }>) => void,
  get: () => { tabs: Map<string, TabState> },
) {
  clearStreamingTimer(agentId);
  streamingTimers.set(
    agentId,
    setTimeout(() => {
      streamingTimers.delete(agentId);
      const tab = get().tabs.get(agentId);
      if (tab?.isStreaming) {
        const newTabs = updateTab(get().tabs, agentId, (t) => ({
          ...t,
          isStreaming: false,
        }));

        if (newTabs) set({ tabs: newTabs });
      }
    }, STREAMING_TIMEOUT_MS),
  );
}

function clearStreamingTimer(agentId: string) {
  const timer = streamingTimers.get(agentId);
  if (timer) {
    clearTimeout(timer);
    streamingTimers.delete(agentId);
  }
}

function ensureAgentTab(
  tabs: Map<string, TabState>,
  agentId: string,
  sessionId?: string,
): { tabs: Map<string, TabState>; created: boolean } {
  if (tabs.has(agentId)) {
    return { tabs, created: false };
  }

  const agent = useAgentStore
    .getState()
    .agents.find((candidate) => candidate.id === agentId);
  const nextTabs = new Map(tabs);
  nextTabs.set(agentId, {
    agentId,
    agentName: agent?.name ?? 'Agent',
    sessionId: sessionId ?? null,
    sessions: [],
    messages: [],
    isStreaming: false,
    diaryStatus: new Map(),
  });
  return { tabs: nextTabs, created: true };
}

const createChatStore = () =>
  create<ChatStore>((set, get) => ({
    tabs: new Map(),
    activeTabId: null,

    openTab(agentId, agentName) {
      const { tabs } = get();
      if (tabs.has(agentId)) {
        set({ activeTabId: agentId });
        return;
      }
      const newTabs = new Map(tabs);
      newTabs.set(agentId, {
        agentId,
        agentName,
        sessionId: null,
        sessions: [],
        messages: [],
        isStreaming: false,
        diaryStatus: new Map(),
      });
      set({ tabs: newTabs, activeTabId: agentId });
    },

    closeTab(agentId) {
      const { tabs, activeTabId } = get();
      console.warn(
        `${CHAT_DEBUG_PREFIX} closeTab agent=${agentId} activeTab=${activeTabId} tabCount=${tabs.size}`,
      );
      const newTabs = new Map(tabs);
      newTabs.delete(agentId);
      const keys = Array.from(newTabs.keys());
      set({
        tabs: newTabs,
        activeTabId:
          activeTabId === agentId
            ? (keys[keys.length - 1] ?? null)
            : activeTabId,
      });
      // Stop the agent process when the user closes the chat tab (only if owned)
      const agent = useAgentStore
        .getState()
        .agents.find((a) => a.id === agentId);
      if (agent && isOwnedAgent(agent)) {
        useAgentStore
          .getState()
          .stopAgent(agentId)
          .catch(() => {});
      }
    },

    setActiveTab(agentId) {
      set({ activeTabId: agentId });
    },

    setSessionId(agentId, sessionId) {
      const current = get().tabs.get(agentId);
      console.warn(
        `${CHAT_DEBUG_PREFIX} setSessionId agent=${agentId} from=${current?.sessionId ?? 'null'} to=${sessionId}`,
      );
      if (current?.sessionId === sessionId) {
        return;
      }

      clearStreamingTimer(agentId);
      const deltaTimer = deltaTimers.get(agentId);
      if (deltaTimer) {
        clearTimeout(deltaTimer);
        deltaTimers.delete(agentId);
      }
      pendingDeltas.delete(agentId);

      const newTabs = updateTab(get().tabs, agentId, (tab) => ({
        ...tab,
        sessionId,
        messages: [],
        isStreaming: false,
      }));
      if (newTabs) set({ tabs: newTabs });
    },

    setSessions(agentId, sessions: SessionInfo[]) {
      const newTabs = updateTab(get().tabs, agentId, (tab) => ({
        ...tab,
        sessions: deduplicateById(sessions),
      }));
      if (newTabs) set({ tabs: newTabs });
    },

    markSessionDeleted(agentId, sessionId) {
      if (!deletedSessionIds.has(agentId)) {
        deletedSessionIds.set(agentId, new Set());
      }
      deletedSessionIds.get(agentId)!.add(sessionId);
    },

    setMessages(agentId, messages) {
      const current = get().tabs.get(agentId);
      const nextMessages = current
        ? mergeMessagesConservatively(current.messages, messages)
        : messages;
      console.warn(
        `${CHAT_DEBUG_PREFIX} setMessages agent=${agentId} session=${current?.sessionId ?? 'null'} incoming=${messages.length} final=${nextMessages.length} ids=${nextMessages.map((m) => m.id).join(',')}`,
      );
      const newTabs = updateTab(get().tabs, agentId, (tab) => ({
        ...tab,
        messages: nextMessages,
      }));
      if (newTabs) set({ tabs: newTabs });
    },

    setStreaming(agentId, isStreaming) {
      const newTabs = updateTab(get().tabs, agentId, (tab) => ({
        ...tab,
        isStreaming,
      }));
      if (newTabs) set({ tabs: newTabs });
      if (isStreaming) {
        startStreamingTimer(agentId, set, get);
      } else {
        clearStreamingTimer(agentId);
      }
    },

    setDiaryStatus(agentId, sessionId, status) {
      const newTabs = updateTab(get().tabs, agentId, (tab) => {
        const diaryStatus = new Map(tab.diaryStatus);
        diaryStatus.set(sessionId, status);
        return { ...tab, diaryStatus };
      });
      if (newTabs) set({ tabs: newTabs });
    },

    reconcileAgents(agents) {
      const { tabs, activeTabId } = get();
      const nextTabs = new Map();
      const agentNames = new Map(agents.map((agent) => [agent.id, agent.name]));

      for (const [agentId, tab] of tabs) {
        const nextName = agentNames.get(agentId);
        if (!nextName) {
          clearStreamingTimer(agentId);
          const deltaTimer = deltaTimers.get(agentId);
          if (deltaTimer) {
            clearTimeout(deltaTimer);
            deltaTimers.delete(agentId);
          }
          pendingDeltas.delete(agentId);
          deletedSessionIds.delete(agentId);
          continue;
        }

        nextTabs.set(
          agentId,
          tab.agentName === nextName ? tab : { ...tab, agentName: nextName },
        );
      }

      const nextActiveTabId =
        activeTabId && nextTabs.has(activeTabId) ? activeTabId : null;
      if (nextActiveTabId !== activeTabId || nextTabs.size !== tabs.size) {
        set({ tabs: nextTabs, activeTabId: nextActiveTabId });
      }
    },

    handleMessageUpdate(agentId, data) {
      const { tabs, activeTabId } = get();
      const rawData = data as Record<string, unknown>;
      const info = (rawData.info ?? rawData) as Record<string, unknown>;
      const ensured = ensureAgentTab(
        tabs,
        agentId,
        info.sessionID as string | undefined,
      );
      const tab = ensured.tabs.get(agentId);
      if (!tab) {
        return;
      }
      const tabsForUpdate = ensured.created ? ensured.tabs : tabs;
      if (ensured.created) {
        set({ tabs: tabsForUpdate, activeTabId: activeTabId ?? agentId });
      }

      if (info.sessionID && tab.sessionId && info.sessionID !== tab.sessionId) {
        return; // subagent session - silently ignore
      }

      const msg = convertRuntimeMessage(data);
      console.warn(
        `${CHAT_DEBUG_PREFIX} handleMessageUpdate agent=${agentId} session=${String(info.sessionID ?? 'null')} msg=${msg.id} role=${msg.role} parts=${msg.parts.length} existingMessages=${tab.messages.length}`,
      );

      const messages = [...tab.messages];

      // If this is a user message, replace the optimistic temp message
      if (msg.role === 'user') {
        const tempIdx = messages.findIndex((m) =>
          m.id.startsWith('temp-user-'),
        );
        if (tempIdx >= 0) {
          messages[tempIdx] = msg;
          const newTabs = updateTab(tabsForUpdate, agentId, (t) => ({
            ...t,
            messages,
          }));
          if (newTabs) set({ tabs: newTabs });
          return;
        }
      }

      const existing = messages.findIndex((m) => m.id === msg.id);
      if (existing >= 0) {
        if (msg.parts.length === 0) {
          messages[existing] = {
            ...messages[existing],
            ...msg,
            parts: messages[existing].parts,
          };
        } else {
          messages[existing] = msg;
        }
      } else {
        messages.push(msg);
      }
      const newTabs = updateTab(tabsForUpdate, agentId, (t) => ({
        ...t,
        messages,
      }));
      if (newTabs) set({ tabs: newTabs });
    },

    handleMessageRemoved(agentId, data) {
      const { tabs } = get();
      const tab = tabs.get(agentId);
      if (!tab) return;

      const rawData = data as Record<string, unknown>;
      const info = (rawData.info ?? rawData) as Record<string, unknown>;
      const messageId = (info.id ?? info.messageID) as string | undefined;
      if (!messageId) return;
      if (info.sessionID && tab.sessionId && info.sessionID !== tab.sessionId)
        return;

      const newTabs = updateTab(tabs, agentId, (t) => ({
        ...t,
        messages: t.messages.filter((m) => m.id !== messageId),
      }));
      if (newTabs) set({ tabs: newTabs });
    },

    handleMessagePartUpdate(agentId, data) {
      const { tabs, activeTabId } = get();
      const rawData = data as Record<string, unknown>;
      const part = (rawData.part ?? rawData) as Record<string, unknown>;
      const ensured = ensureAgentTab(
        tabs,
        agentId,
        part.sessionID as string | undefined,
      );
      const tab = ensured.tabs.get(agentId);
      if (!tab) {
        return;
      }
      const tabsForUpdate = ensured.created ? ensured.tabs : tabs;
      if (ensured.created) {
        set({ tabs: tabsForUpdate, activeTabId: activeTabId ?? agentId });
      }

      if (part.sessionID && tab.sessionId && part.sessionID !== tab.sessionId) {
        return; // subagent session - silently ignore
      }

      const converted = convertRuntimePart(part);
      const messages = [...tab.messages];

      let msgIdx = messages.findIndex((m) => m.id === part.messageID);
      if (msgIdx < 0) {
        messages.push({
          id: part.messageID as string,
          role: 'assistant',
          parts: [],
        });
        msgIdx = messages.length - 1;
      }

      const msg = { ...messages[msgIdx], parts: [...messages[msgIdx].parts] };
      const partIdx = msg.parts.findIndex((p) => p.id === part.id);
      if (partIdx >= 0) {
        msg.parts[partIdx] = converted;
      } else {
        msg.parts.push(converted);
      }
      messages[msgIdx] = msg;
      const newTabs = updateTab(tabsForUpdate, agentId, (t) => ({
        ...t,
        messages,
      }));
      if (newTabs) set({ tabs: newTabs });
    },

    handleMessagePartRemoved(agentId, data) {
      const { tabs } = get();
      const tab = tabs.get(agentId);
      if (!tab) return;

      const rawData = data as Record<string, unknown>;
      const part = (rawData.part ?? rawData) as Record<string, unknown>;
      if (part.sessionID && tab.sessionId && part.sessionID !== tab.sessionId)
        return;

      const msgIdx = tab.messages.findIndex((m) => m.id === part.messageID);
      if (msgIdx < 0) return;

      const messages = [...tab.messages];
      const msg = {
        ...messages[msgIdx],
        parts: messages[msgIdx].parts.filter((p) => p.id !== part.id),
      };
      messages[msgIdx] = msg;
      const newTabs = updateTab(tabs, agentId, (t) => ({ ...t, messages }));
      if (newTabs) set({ tabs: newTabs });
    },

    handleMessagePartDelta(agentId, data) {
      const { tabs, activeTabId } = get();
      const d = data as Record<string, unknown>;
      const ensured = ensureAgentTab(
        tabs,
        agentId,
        d.sessionID as string | undefined,
      );
      const tab = ensured.tabs.get(agentId);
      if (!tab) {
        return;
      }
      const tabsForUpdate = ensured.created ? ensured.tabs : tabs;
      if (ensured.created) {
        set({ tabs: tabsForUpdate, activeTabId: activeTabId ?? agentId });
      }

      if (d.sessionID && tab.sessionId && d.sessionID !== tab.sessionId) {
        return; // subagent session - silently ignore
      }

      // Accumulate deltas and flush in batches to avoid per-chunk re-renders
      const entry: DeltaEntry = {
        partID: d.partID as string,
        messageID: d.messageID as string,
        sessionID: d.sessionID as string | undefined,
        field: d.field as string | undefined,
        delta: (d.delta as string) ?? '',
      };
      let batch = pendingDeltas.get(agentId);
      if (!batch) {
        batch = [];
        pendingDeltas.set(agentId, batch);
      }
      batch.push(entry);

      if (!deltaTimers.has(agentId)) {
        deltaTimers.set(
          agentId,
          setTimeout(() => {
            deltaTimers.delete(agentId);
            const deltas = pendingDeltas.get(agentId);
            pendingDeltas.delete(agentId);
            if (!deltas || deltas.length === 0) return;

            const { tabs: latestTabs } = get();
            const latestTab = latestTabs.get(agentId);
            if (!latestTab) return;

            const activeSessionId = latestTab.sessionId;
            const messages = [...latestTab.messages];

            for (const delta of deltas) {
              if (
                delta.sessionID &&
                activeSessionId &&
                delta.sessionID !== activeSessionId
              ) {
                continue;
              }
              let msgIdx = messages.findIndex((m) => m.id === delta.messageID);
              if (msgIdx < 0) {
                messages.push({
                  id: delta.messageID,
                  role: 'assistant',
                  parts: [],
                });
                msgIdx = messages.length - 1;
              }
              // Mutate the cloned message to avoid repeated cloning inside the loop
              if (messages[msgIdx] === latestTab.messages[msgIdx]) {
                messages[msgIdx] = {
                  ...messages[msgIdx],
                  parts: [...messages[msgIdx].parts],
                };
              }
              const msg = messages[msgIdx];
              const partIdx = msg.parts.findIndex((p) => p.id === delta.partID);
              if (partIdx >= 0) {
                if (
                  msg.parts[partIdx] ===
                  latestTab.messages[msgIdx]?.parts?.[partIdx]
                ) {
                  msg.parts[partIdx] = { ...msg.parts[partIdx] };
                }
                const field = delta.field || 'text';
                if (field === 'text') {
                  msg.parts[partIdx].text =
                    (msg.parts[partIdx].text ?? '') + delta.delta;
                }
              } else {
                msg.parts.push({
                  type: 'text',
                  text: delta.delta,
                  id: delta.partID,
                  messageID: delta.messageID,
                });
              }
            }

            const newTabs = updateTab(latestTabs, agentId, (t) => ({
              ...t,
              messages,
            }));
            if (newTabs) set({ tabs: newTabs });
          }, DELTA_FLUSH_MS),
        );
      }
    },

    handleSessionUpdate(agentId, data) {
      const { tabs, activeTabId } = get();
      const updated = parseSessionInfo(data);
      console.warn(
        `${CHAT_DEBUG_PREFIX} handleSessionUpdate agent=${agentId} updatedSession=${updated.id} title=${updated.title ?? ''}`,
      );
      const ensured = ensureAgentTab(tabs, agentId, updated.id);
      const tab = ensured.tabs.get(agentId);
      if (!tab) return;
      const tabsForUpdate = ensured.created ? ensured.tabs : tabs;
      if (ensured.created) {
        set({ tabs: tabsForUpdate, activeTabId: activeTabId ?? agentId });
      }

      if (!updated.id) return;

      if (deletedSessionIds.get(agentId)?.has(updated.id)) return;

      const existingIdx = tab.sessions.findIndex((s) => s.id === updated.id);
      const sessions = [...tab.sessions];
      if (existingIdx >= 0) {
        sessions[existingIdx] = {
          ...sessions[existingIdx],
          ...updated,
          title: updated.title ?? sessions[existingIdx].title,
        };
      } else {
        sessions.push(updated);
      }

      const newTabs = updateTab(tabsForUpdate, agentId, (t) => ({
        ...t,
        sessions: deduplicateById(sessions),
      }));
      if (newTabs) set({ tabs: newTabs });
    },

    handleSessionStatus(agentId, data) {
      const { tabs, activeTabId } = get();
      const d = data as Record<string, unknown>;
      const ensured = ensureAgentTab(
        tabs,
        agentId,
        d.sessionID as string | undefined,
      );
      const tab = ensured.tabs.get(agentId);
      if (!tab) return;
      const tabsForUpdate = ensured.created ? ensured.tabs : tabs;
      if (ensured.created) {
        set({ tabs: tabsForUpdate, activeTabId: activeTabId ?? agentId });
      }

      if (d.sessionID && tab.sessionId && d.sessionID !== tab.sessionId) return;

      const status = d.status as Record<string, string> | undefined;
      const isBusy = status?.type === 'busy';
      console.warn(
        `${CHAT_DEBUG_PREFIX} handleSessionStatus agent=${agentId} session=${String(d.sessionID ?? 'null')} status=${status?.type ?? 'unknown'} currentTabSession=${tab.sessionId ?? 'null'}`,
      );
      const newTabs = updateTab(tabsForUpdate, agentId, (t) => ({
        ...t,
        isStreaming: isBusy,
      }));
      if (newTabs) set({ tabs: newTabs });

      if (isBusy) {
        startStreamingTimer(agentId, set, get);
      } else {
        clearStreamingTimer(agentId);
      }
    },
  }));
type ChatStoreHook = ReturnType<typeof createChatStore>;
export const useChatStore: ChatStoreHook = createChatStore();
