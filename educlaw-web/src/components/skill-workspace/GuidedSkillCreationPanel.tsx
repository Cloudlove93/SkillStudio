import { useMemo, useRef, useState } from 'react';
import type {
  GuidedCreationDocument,
  GuidedCreationSessionDetail,
} from '@educlaw/shared';
import {
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronDown,
  FileText,
  Loader2,
  Paperclip,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react';

type Props = {
  session: GuidedCreationSessionDetail | null;
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

const educationTemplates = [
  ['课堂活动设计', '为教师创建一个课堂活动设计 Skill，根据教学目标、年级、课时和班级情况生成可执行活动。'],
  ['作业反馈', '创建一个作业反馈 Skill，根据学生作答给出具体、鼓励性且可行动的反馈。'],
  ['练习题生成', '创建一个练习题生成 Skill，根据教学材料、知识点和难度生成带答案解析的练习。'],
] as const;

export function GuidedSkillCreationPanel(props: Props) {
  const [input, setInput] = useState('');
  const [showConversation, setShowConversation] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isConfirmation = props.session?.status === 'ready_for_confirmation';
  const documentsLocked = Boolean(props.session);
  const isFinalizing = Boolean(
    props.busy && ['generating', 'validating', 'saving'].includes(props.phase || ''),
  );

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
          <div className="skill-generation-symbol"><Sparkles size={24} /></div>
          <span className="skill-eyebrow">正在创建</span>
          <h1>正在把确认内容生成 Skill</h1>
          <p>生成过程中可以切换到其他草稿，任务会继续在后台完成。</p>
          <div className="skill-phase-list">
            {phaseSteps.map((step, index) => {
              const activeIndex = Math.max(0, phaseSteps.findIndex((item) => item.key === props.phase));
              const done = index < activeIndex;
              const active = index === activeIndex;
              return (
                <div key={step.key} className={`skill-phase ${done ? 'is-done' : ''} ${active ? 'is-active' : ''}`}>
                  <span>{done ? <Check size={13} /> : active ? <Loader2 size={13} className="spin" /> : index + 1}</span>
                  <strong>{step.label}</strong>
                </div>
              );
            })}
          </div>
          {props.previews.length > 0 && (
            <details className="skill-file-preview">
              <summary><FileText size={15} />查看生成文件<ChevronDown size={14} /></summary>
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
          <button className="skill-text-button" onClick={() => setShowConversation(true)}>
            <ArrowLeft size={15} />返回对话补充
          </button>
          <span className="skill-eyebrow">生成前确认</span>
          <h1>确认这个 Skill 的工作方式</h1>
          <p className="skill-page-subtitle">确认后会创建 Skill v1，当前对话和草案都会继续保留。</p>
          <div className="skill-confirm-grid">
            {props.session?.confirmation?.sections.map((section) => (
              <section key={section.key}>
                <span><Check size={13} /></span>
                <div><h3>{section.title}</h3><p>{section.content}</p></div>
              </section>
            ))}
          </div>
          {props.error && <InlineError error={props.error} onRetry={props.onRetry} />}
          <div className="skill-confirm-actions">
            <button className="skill-secondary-button" onClick={() => setShowConversation(true)}>继续修改</button>
            <button className="skill-primary-button" onClick={props.onConfirm} disabled={props.busy}>
              {props.busy ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
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
            <button className="skill-secondary-button" onClick={() => setShowConversation(false)}>查看确认页</button>
          </div>
        )}

        <div className={`skill-message-list ${props.session ? '' : 'is-empty'}`}>
          {!props.session ? (
            <div className="skill-empty-conversation">
              <div className="skill-empty-icon"><Sparkles size={24} /></div>
              <h2>一起创建一个教育 Skill</h2>
              <p>先简单描述目标，我会通过对话帮你逐步补全。</p>
              <div className="skill-starter-section">
                <span>从常用场景开始</span>
                <div className="skill-starter-chips">
                  {educationTemplates.map(([label, prompt]) => (
                    <button key={label} onClick={() => setInput(prompt)}>{label}</button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            props.session.messages.map((message) => (
              <MessageBubble key={message.id} message={message} onOption={(option) => setInput(option)} />
            ))
          )}
          {props.busy && !isFinalizing && (
            <div className="skill-assistant-message is-thinking"><span /><span /><span /></div>
          )}
        </div>

        {props.error && <InlineError error={props.error} onRetry={props.onRetry} />}

        <div className="skill-composer-wrap">
          {props.documents.length > 0 && (
            <div className="skill-document-row">
              {props.documents.map((document, index) => (
                <span key={`${document.name}-${index}`}>
                  <FileText size={13} />{document.name}
                  {!documentsLocked && (
                    <button onClick={() => props.onRemoveDocument(index)}><X size={12} /></button>
                  )}
                </span>
              ))}
            </div>
          )}
          <div className="skill-composer">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              placeholder={props.session ? '补充你的想法，或选择上方建议…' : '描述你想创建的 Skill…'}
              rows={2}
            />
            <div className="skill-composer-actions">
              <input
                ref={fileInputRef}
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
                  onClick={() => fileInputRef.current?.click()}
                  title="添加教学材料"
                  aria-label="添加教学材料"
                >
                  <Paperclip size={16} />
                </button>
              )}
              <span>Enter 发送 · Shift + Enter 换行</span>
              <button className="skill-send-button" onClick={send} disabled={!input.trim() || props.busy}>
                {props.busy ? <Loader2 size={16} className="spin" /> : <ArrowUp size={16} />}
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
  onOption,
}: {
  message: GuidedCreationSessionDetail['messages'][number];
  onOption: (option: string) => void;
}) {
  const options = useMemo(() => {
    const value = message.metadata.suggested_options;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  }, [message.metadata]);
  if (message.role === 'user') return <div className="skill-user-message">{message.content}</div>;
  return (
    <div className="skill-assistant-block">
      <div className="skill-assistant-avatar"><Sparkles size={14} /></div>
      <div>
        <div className="skill-assistant-message">{message.content}</div>
        {options.length > 0 && (
          <div className="skill-option-row">
            {options.map((option) => <button key={option} onClick={() => onOption(option)}>{option}</button>)}
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
      <div><strong>刚才没有完成</strong><span>{error.message}</span></div>
      {error.retryable && <button onClick={onRetry}><RotateCcw size={14} />重试</button>}
      <details><summary>技术信息</summary><code>{error.code}</code></details>
    </div>
  );
}
