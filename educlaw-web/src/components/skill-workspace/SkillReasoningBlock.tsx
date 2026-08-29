import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, Copy, LoaderCircle } from 'lucide-react';

type Props = {
  text: string;
  streaming: boolean;
  expandedByDefault?: boolean;
};

export function SkillReasoningBlock({
  text,
  streaming,
  expandedByDefault = false,
}: Props) {
  const contentId = useId();
  const [expanded, setExpanded] = useState(
    streaming || expandedByDefault,
  );
  const [copied, setCopied] = useState(false);
  const changedByUser = useRef(false);
  const previousStreaming = useRef(streaming);

  useEffect(() => {
    if (
      previousStreaming.current !== streaming &&
      !changedByUser.current
    ) {
      setExpanded(streaming || expandedByDefault);
    }
    previousStreaming.current = streaming;
  }, [expandedByDefault, streaming]);

  useEffect(() => {
    setCopied(false);
  }, [text]);

  if (!text) return null;

  const toggle = () => {
    changedByUser.current = true;
    setExpanded((current) => !current);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section
      className={`skill-reasoning-block${streaming ? ' is-streaming' : ''}`}
      aria-label={streaming ? '正在思考' : '思考过程'}
    >
      <div className="skill-reasoning-header">
        <button
          type="button"
          className="skill-reasoning-toggle"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={toggle}
        >
          {streaming ? (
            <LoaderCircle className="skill-reasoning-spinner" size={15} />
          ) : (
            <Check size={15} aria-hidden="true" />
          )}
          <span>{streaming ? '正在思考' : '已完成思考'}</span>
          <ChevronDown
            className="skill-reasoning-chevron"
            size={15}
            aria-hidden="true"
          />
        </button>
        {expanded ? (
          <button
            type="button"
            className="skill-reasoning-copy"
            onClick={() => void copy()}
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? '已复制' : '复制思考'}
          </button>
        ) : null}
      </div>
      {expanded ? (
        <div
          id={contentId}
          className="skill-reasoning-content"
          data-reasoning-content
        >
          {text}
        </div>
      ) : null}
      <span className="sr-only" aria-live="polite">
        {copied ? '已复制思考过程' : ''}
      </span>
    </section>
  );
}
