import { useMemo, useRef, useState } from 'react';
import type {
  GuidedCreationDocument,
  GuidedCreationSessionDetail,
  GuidedCreationStep,
  GuidedCreationStage,
} from '@educlaw/shared';
import {
  ArrowLeft,
  ArrowUp,
  BookOpenCheck,
  Check,
  ChevronDown,
  FileText,
  Loader2,
  Layers3,
  Paperclip,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react';
import { educationScenarios } from './education-scenarios';
import {
  shouldDisplayPendingGuidedMessage,
  type PendingGuidedMessage,
} from './guided-optimistic-message';
import { ConversationTurnNavigation } from './ConversationTurnNavigation';
import { collectConversationTurns } from './conversation-turn-navigation';
import { MarkdownContent } from '../lite/lite-rendering';

type Props = {
  session: GuidedCreationSessionDetail | null;
  pendingMessage: PendingGuidedMessage | null;
  documents: GuidedCreationDocument[];
  busy: boolean;
  phase: string | null;
  previews: Array<{ path: string; content: string }>;
  error: { code: string; message: string; retryable: boolean } | null;
  onSend: (content: string) => void;
  onConfirm: () => void;
  onRetry: () => void;
  onFiles: (files: FileList) => void;
  onRemoveDocument: (index: number) => void;
};

const phaseSteps = [
  { key: 'generating', label: '生成 Skill 文件' },
  { key: 'validating', label: '检查结构与内容' },
  { key: 'saving', label: '保存 Skill v1' },
];

const guidedStageLabels: Record<GuidedCreationStage, string> = {
  positioning: '明确对象与目标',
  scenario_input: '还原使用场景',
  expected_result: '说清理想结果',
  working_method: '提炼你的做法',
  evidence_scope: '确定参考依据',
  boundaries_completion: '补充边界与完成标准',
};

const guidedStepLabels: Record<GuidedCreationStep, string> = {
  intent_context: '教育意图',
  teacher_experience: '教师经验',
  strategy_co_creation: '教育策略',
  action_adjustment: '行动调整',
  evidence_review: '效果复核',
};

const guidedInterviewSteps: Array<{ key: GuidedCreationStep; label: string }> =
  [
    { key: 'intent_context', label: '目标与对象' },
    { key: 'teacher_experience', label: '经验与依据' },
    { key: 'strategy_co_creation', label: '教学策略' },
    { key: 'action_adjustment', label: '行动与边界' },
    { key: 'evidence_review', label: '效果与证据' },
  ];

export function GuidedSkillCreationPanel(props: Props) {
  const [input, setInput] = useState('');
  const [showConversation, setShowConversation] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const isConfirmation = props.session?.status === 'ready_for_confirmation';
  const documentsLocked = Boolean(props.session);
  const isFinalizing = Boolean(
    props.busy &&
    ['generating', 'validating', 'saving'].includes(props.phase || ''),
  );
  const showPendingMessage = shouldDisplayPendingGuidedMessage(
    props.pendingMessage,
    props.session?.id ?? null,
    props.session?.messages ?? [],
  );
  const hasConversation = Boolean(props.session || showPendingMessage);
  const conversationTurns = useMemo(
    () =>
      collectConversationTurns([
        ...(props.session?.messages ?? []),
        ...(showPendingMessage && props.pendingMessage
          ? [
              {
                id: props.pendingMessage.clientMessageId,
                role: 'user',
                content: props.pendingMessage.content,
              },
            ]
          : []),
      ]),
    [props.pendingMessage, props.session?.messages, showPendingMessage],
  );
  const guidedStage =
    props.session &&
    props.session.flow_version === 2 &&
    props.session.status === 'collecting'
      ? props.session.next_stage
      : null;
  const guidedStep =
    props.session &&
    props.session.flow_version >= 3 &&
    props.session.status === 'collecting'
      ? props.session.current_step
      : null;
  const guidedProgress =
    guidedStep && props.session
      ? {
          label: guidedStepLabels[guidedStep],
          current: Math.min(
            (props.session.completed_steps?.length ?? 0) + 1,
            5,
          ),
          total: 5,
        }
      : guidedStage && props.session
        ? {
            label: guidedStageLabels[guidedStage],
            current: props.session.confirmed_stages.length + 1,
            total: 6,
          }
        : null;

  const send = () => {
    const value = input.trim();
    if (!value || props.busy) return;
    setInput('');
    props.onSend(value);
  };

  if (isFinalizing) {
    return (
      <main className="skill-center skill-generation-view">
        <div className="skill-generation-card skill-view-enter">
          <div className="skill-generation-symbol">
            <Sparkles size={24} />
          </div>
          <span className="skill-eyebrow">正在创建</span>
          <h1>正在把确认内容生成 Skill</h1>
          <p>生成过程中可以切换到其他草稿，任务会继续在后台完成。</p>
          <div className="skill-phase-list">
            {phaseSteps.map((step, index) => {
              const activeIndex = Math.max(
                0,
                phaseSteps.findIndex((item) => item.key === props.phase),
              );
              const done = index < activeIndex;
              const active = index === activeIndex;
              return (
                <div
                  key={step.key}
                  className={`skill-phase ${done ? 'is-done' : ''} ${active ? 'is-active' : ''}`}
                >
                  <span>
                    {done ? (
                      <Check size={13} />
                    ) : active ? (
                      <Loader2 size={13} className="spin" />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <strong>{step.label}</strong>
                </div>
              );
            })}
          </div>
          {props.previews.length > 0 && (
            <details className="skill-file-preview">
              <summary>
                <FileText size={15} />
                查看生成文件
                <ChevronDown size={14} />
              </summary>
              {props.previews.map((file) => (
                <div key={file.path} className="skill-preview-file">
                  <strong>{file.path}</strong>
                  <pre>{file.content.slice(0, 2200)}</pre>
                </div>
              ))}
            </details>
          )}
        </div>
      </main>
    );
  }

  if (isConfirmation && !showConversation) {
    return (
      <main className="skill-center skill-confirmation-view">
        <div className="skill-confirmation-page skill-view-enter">
          <button
            className="skill-text-button"
            onClick={() => setShowConversation(true)}
          >
            <ArrowLeft size={15} />
            返回对话补充
          </button>
          <span className="skill-eyebrow">生成前确认</span>
          <h1>确认这个 Skill 的工作方式</h1>
          <p className="skill-page-subtitle">
            确认后会创建 Skill v1，当前对话和草案都会继续保留。
          </p>
          <div className="skill-confirm-grid">
            {props.session?.confirmation?.sections.map((section) => (
              <section key={section.key}>
                <span>
                  <Check size={13} />
                </span>
                <div>
                  <h3>{section.title}</h3>
                  <p>{section.content}</p>
                </div>
              </section>
            ))}
          </div>
          {props.error && (
            <InlineError error={props.error} onRetry={props.onRetry} />
          )}
          <div className="skill-confirm-actions">
            <button
              className="skill-secondary-button"
              onClick={() => setShowConversation(true)}
            >
              继续修改
            </button>
            <button
              className="skill-primary-button"
              onClick={props.onConfirm}
              disabled={props.busy}
            >
              {props.busy ? (
                <Loader2 size={16} className="spin" />
              ) : (
                <Sparkles size={16} />
              )}
              确认并生成 Skill
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="skill-center">
      <div
        className="skill-conversation-shell skill-view-enter"
        onDragOver={(event) => {
          if (!documentsLocked) event.preventDefault();
        }}
        onDrop={(event) => {
          if (documentsLocked) return;
          event.preventDefault();
          if (event.dataTransfer.files.length) {
            props.onFiles(event.dataTransfer.files);
          }
        }}
      >
        {isConfirmation && (
          <div className="skill-conversation-status">
            <span>需求已经整理完成</span>
            <button
              className="skill-secondary-button"
              onClick={() => setShowConversation(false)}
            >
              查看确认页
            </button>
          </div>
        )}

        <div className="skill-message-scroll-region">
          <ConversationTurnNavigation
            containerRef={messageListRef}
            turns={conversationTurns}
          />
          <div
            ref={messageListRef}
            className={`skill-message-list ${hasConversation ? '' : 'is-empty'}`}
          >
            {!hasConversation ? (
              <div className="skill-empty-conversation">
                <div className="skill-empty-icon">
                  <Sparkles size={24} aria-hidden="true" />
                </div>
                <h2>从一个教学目标开始</h2>
                <p>描述你的教学目标，我会协助梳理需求并生成可运行的 Skill。</p>
                <div className="skill-starter-section">
                  <span>精选教学场景</span>
                  <div className="skill-starter-chips">
                    {educationScenarios.map((scenario) => {
                      const ScenarioIcon =
                        scenario.tone === 'codex-orange'
                          ? BookOpenCheck
                          : Layers3;
                      return (
                        <button
                          key={scenario.id}
                          className={`skill-starter-card is-${scenario.tone}`}
                          onClick={() => setInput(scenario.prompt)}
                        >
                          <span className="skill-starter-card-icon">
                            <ScenarioIcon size={20} aria-hidden="true" />
                          </span>
                          <span className="skill-starter-card-copy">
                            <strong>{scenario.label}</strong>
                            <small>{scenario.description}</small>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <>
                {props.session?.messages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    turnId={
                      message.role === 'user'
                        ? `guided-turn-${message.id}`
                        : undefined
                    }
                    onOption={(option) => setInput(option)}
                  />
                ))}
                {showPendingMessage && props.pendingMessage && (
                  <div
                    id={`guided-turn-${props.pendingMessage.clientMessageId}`}
                    className="skill-user-message is-pending"
                  >
                    {props.pendingMessage.content}
                  </div>
                )}
              </>
            )}
            {props.busy && !isFinalizing && (
              <div className="skill-assistant-message is-thinking">
                <span />
                <span />
                <span />
              </div>
            )}
          </div>
        </div>

        {props.error && (
          <InlineError error={props.error} onRetry={props.onRetry} />
        )}

        <div className="skill-composer-wrap">
          {guidedProgress && (
            <div className="skill-guided-progress" aria-label="共创进度">
              <span>共创进度</span>
              <strong>{guidedProgress.label}</strong>
              <small>
                {guidedProgress.current} / {guidedProgress.total}
              </small>
            </div>
          )}
          {guidedStep && props.session && (
            <nav className="skill-interview-steps" aria-label="Skill 引导阶段">
              {guidedInterviewSteps.map((step, index) => {
                const completed =
                  props.session?.completed_steps?.includes(step.key) ?? false;
                const active = step.key === guidedStep;
                return (
                  <span
                    key={step.key}
                    className={`skill-interview-step ${completed ? 'is-complete' : ''} ${active ? 'is-active' : ''}`}
                    aria-current={active ? 'step' : undefined}
                  >
                    <i>{completed ? <Check size={11} /> : index + 1}</i>
                    <em>{step.label}</em>
                  </span>
                );
              })}
            </nav>
          )}
          {props.documents.length > 0 && (
            <div className="skill-document-row">
              {props.documents.map((document, index) => (
                <span key={`${document.name}-${index}`}>
                  <FileText size={13} />
                  {document.name}
                  {!documentsLocked && (
                    <button
                      type="button"
                      onClick={() => props.onRemoveDocument(index)}
                      aria-label={`移除 ${document.name}`}
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
          <div className="skill-composer">
            <textarea
              aria-label="共创建议与补充说明"
              name="guided-skill-message"
              autoComplete="off"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              placeholder={
                props.session
                  ? '补充你的想法，或选择上方建议…'
                  : '描述你想创建的 Skill…'
              }
              rows={2}
            />
            <div className="skill-composer-actions">
              <input
                ref={fileInputRef}
                name="guided-skill-materials"
                hidden
                type="file"
                multiple
                accept=".txt,.md,.docx,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={(event) => {
                  if (event.target.files?.length) {
                    props.onFiles(event.target.files);
                  }
                  event.target.value = '';
                }}
              />
              {!documentsLocked && (
                <button
                  className="skill-material-icon-button"
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="添加教学材料"
                  aria-label="添加教学材料"
                >
                  <Paperclip size={16} aria-hidden="true" />
                </button>
              )}
              <span>Enter 发送 · Shift + Enter 换行</span>
              <button
                type="button"
                className="skill-send-button"
                onClick={send}
                disabled={!input.trim() || props.busy}
                aria-label="发送共创消息"
              >
                {props.busy ? (
                  <Loader2 size={16} className="spin" aria-hidden="true" />
                ) : (
                  <ArrowUp size={16} aria-hidden="true" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function MessageBubble({
  message,
  turnId,
  onOption,
}: {
  message: GuidedCreationSessionDetail['messages'][number];
  turnId?: string;
  onOption: (option: string) => void;
}) {
  const options = useMemo(() => {
    const value = message.metadata.suggested_options;
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }, [message.metadata]);
  if (message.role === 'user') {
    return (
      <div id={turnId} className="skill-user-message">
        {message.content}
      </div>
    );
  }
  return (
    <div className="skill-assistant-block">
      <div className="skill-assistant-avatar">
        <Sparkles size={14} />
      </div>
      <div>
        <div className="skill-assistant-message">
          <MarkdownContent content={message.content} />
        </div>
        {options.length > 0 && (
          <div className="skill-option-row">
            {options.map((option) => (
              <button key={option} onClick={() => onOption(option)}>
                {option}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function InlineError({
  error,
  onRetry,
}: {
  error: { code: string; message: string; retryable: boolean };
  onRetry: () => void;
}) {
  return (
    <div className="skill-inline-error">
      <div>
        <strong>刚才没有完成</strong>
        <span>{error.message}</span>
      </div>
      {error.retryable && (
        <button onClick={onRetry}>
          <RotateCcw size={14} />
          重试
        </button>
      )}
      <details>
        <summary>技术信息</summary>
        <code>{error.code}</code>
      </details>
    </div>
  );
}
