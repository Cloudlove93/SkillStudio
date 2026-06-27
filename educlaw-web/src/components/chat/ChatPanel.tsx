import { useChatStore } from '../../stores/chat';
import type { TabState, Message } from '../../stores/chat';
import { useAgentStore, isOwnedAgent } from '../../stores/agent';
import { useInteractionQueueStore } from '../../stores/interaction-queue';
import { useTodoStore } from '../../stores/todo';
import { useUIStore } from '../../stores/ui';
import { useDiaryStore } from '../../stores/diary';
import { useChatMessages } from './hooks/useChatMessages';
import { useChatSessions } from './hooks/useChatSessions';
import { useSlashCommands } from './hooks/useSlashCommands';
import MessageList from './MessageList';
import PromptInput from './PromptInput';
import type { ImageAttachment, AgentOption, CustomCommand, PromptMode } from './PromptInput';
import QuestionDock from './QuestionDock';
import TodoDock from './TodoDock';
import FileViewer from '../editor/FileViewer';
import AgentControls from './AgentControls';
import { useT } from '../../i18n';
import { apiPost, API_BASE } from '../../api/client';
import type { Todo } from '../../stores/todo';

const emptyTodos: Todo[] = [];

export default function ChatPanel({ tab }: { tab: TabState }) {
  const { agentId, sessionId, messages, isStreaming } = tab;
  const agent = useAgentStore((s) => s.agents.find((a) => a.id === agentId));
  const startAgent = useAgentStore((s) => s.startAgent);
  const stopAgent = useAgentStore((s) => s.stopAgent);

  const isRunning = agent?.status === 'running';
  const isOwner = agent ? isOwnedAgent(agent) : true;
  const readonly = !isOwner;
  const canLoadData = isRunning || !isOwner;

  const openFilePath = useUIStore((s) => s.openFilePath);
  const setOpenFilePath = useUIStore((s) => s.setOpenFilePath);

  const sessions = useChatSessions(agentId, canLoadData);
  const chatMessages = useChatMessages(agentId, sessions.ensureRunning, sessions.invalidatePendingLoads);
  const slashCommands = useSlashCommands(agentId, isRunning, sessionId);

  async function handleSlashCommand(commandId: string) {
    switch (commandId) {
      case 'new':
        await sessions.handleCreateSession(slashCommands.currentAgent);
        break;
      default:
        break;
    }
  }

  if (!isRunning && !isOwner) {
    return openFilePath ? (
      <FileViewer agentId={agentId} filePath={openFilePath} onClose={() => setOpenFilePath(null)} readonly />
    ) : (
      <ChatArea agentId={agentId} sessionId={sessionId} messages={messages} isStreaming={false} readonly onSend={() => {}} onAbort={() => {}} />
    );
  }

  if (!isRunning) {
    return openFilePath ? (
      <FileViewer agentId={agentId} filePath={openFilePath} onClose={() => setOpenFilePath(null)} readonly={readonly} />
    ) : (
      <div className="flex h-full flex-1 items-center justify-center px-6 py-8">
        <div className="card-premium rounded-[20px] px-8 py-8 text-center">
          <AgentControls status={agent?.status} isStartingForSend={sessions.isStartingForSend} isOwner={isOwner && !!agent} onStart={() => startAgent(agentId)} onStop={() => stopAgent(agentId)} />
        </div>
      </div>
    );
  }

  return openFilePath ? (
    <FileViewer agentId={agentId} filePath={openFilePath} onClose={() => setOpenFilePath(null)} readonly={readonly} />
  ) : (
    <ChatArea
      agentId={agentId}
      sessionId={sessionId}
      messages={messages}
      isStreaming={isStreaming}
      readonly={readonly}
      onSend={(content, images, agent) => chatMessages.handleSend(content, slashCommands.customCommands, images, agent)}
      onAbort={chatMessages.handleAbort}
      onDeleteMessage={chatMessages.handleDeleteMessage}
      onSlashCommand={handleSlashCommand}
      agents={slashCommands.agents}
      currentAgent={slashCommands.currentAgent}
      onAgentChange={slashCommands.setCurrentAgent}
      customCommands={slashCommands.customCommands}
      mode={chatMessages.promptMode}
      onModeChange={chatMessages.setPromptMode}
    />
  );
}

function messagesToPlainList(messages: Message[]): { role: string; content: string }[] {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role,
      content: m.parts.filter((p) => p.type === 'text').map((p) => p.text ?? '').join('\n').trim(),
    }))
    .filter((m) => m.content.length > 0);
}

function ChatArea({
  agentId,
  sessionId,
  messages,
  isStreaming,
  readonly,
  onSend,
  onAbort,
  onDeleteMessage,
  onSlashCommand,
  agents,
  currentAgent,
  onAgentChange,
  customCommands,
  mode,
  onModeChange,
}: {
  agentId: string;
  sessionId: string | null;
  messages: Message[];
  isStreaming: boolean;
  readonly?: boolean;
  onSend: (content: string, images?: ImageAttachment[], agent?: string) => void;
  onAbort: () => void;
  onDeleteMessage?: (messageId: string) => void;
  onSlashCommand?: (command: string) => void;
  agents?: AgentOption[];
  currentAgent?: string;
  onAgentChange?: (name: string) => void;
  customCommands?: CustomCommand[];
  mode?: PromptMode;
  onModeChange?: (mode: PromptMode) => void;
}) {
  const t = useT();
  const questionRequest = useInteractionQueueStore((s) => s.pendingQuestions.find((q) => q.agentId === agentId && (!sessionId || q.sessionID === sessionId)));
  const todos = useTodoStore((s) => s.todos.get(agentId)?.get(sessionId ?? '') ?? emptyTodos);
  const diaryStatus = useChatStore((s) => s.tabs.get(agentId)?.diaryStatus.get(sessionId ?? '') ?? 'idle');
  const setDiaryStatus = useChatStore((s) => s.setDiaryStatus);

  async function handleSaveToDiary() {
    if (!sessionId || diaryStatus === 'loading' || messages.length === 0) return;
    const plainMessages = messagesToPlainList(messages);
    if (plainMessages.length === 0) return;
    setDiaryStatus(agentId, sessionId, 'loading');
    try {
      const res = await apiPost<{ ok: boolean; date: string }>(`${API_BASE}/api/chat/summarize-to-diary`, { messages: plainMessages, sessionId });
      const diaryStore = useDiaryStore.getState();
      if (diaryStore.selectedDate !== res.date) useDiaryStore.setState({ selectedDate: res.date, autoSaveStatus: 'idle' });
      diaryStore.loadDiary(res.date);
      setDiaryStatus(agentId, sessionId, 'success');
    } catch {
      setDiaryStatus(agentId, sessionId, 'error');
      setTimeout(() => setDiaryStatus(agentId, sessionId, 'idle'), 3000);
    }
  }

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {todos.length > 0 && (
        <div className="absolute bottom-20 left-4 z-20 max-h-[50%] w-72 overflow-y-auto animate-fade-in">
          <TodoDock todos={todos} />
        </div>
      )}

      <MessageList messages={messages} isStreaming={isStreaming} onDeleteMessage={readonly ? undefined : onDeleteMessage} />

      {!readonly && questionRequest && (
        <div className="absolute bottom-20 right-4 z-20 max-h-[60%] w-80 overflow-y-auto animate-fade-in">
          <QuestionDock request={questionRequest} />
        </div>
      )}

      {readonly ? (
        <div className="shrink-0 border-t border-border bg-muted px-4 py-3 text-center text-xs text-muted-foreground">
          {t('chat.readonlyBanner')}
        </div>
      ) : (
        <PromptInput
          onSend={onSend}
          onAbort={onAbort}
          onSlashCommand={onSlashCommand}
          isStreaming={isStreaming}
          disabled={false}
          agents={agents}
          currentAgent={currentAgent}
          onAgentChange={onAgentChange}
          customCommands={customCommands}
          mode={mode}
          onModeChange={onModeChange}
          diaryStatus={messages.length > 0 ? diaryStatus : undefined}
          onSaveToDiary={messages.length > 0 ? handleSaveToDiary : undefined}
        />
      )}
    </div>
  );
}
