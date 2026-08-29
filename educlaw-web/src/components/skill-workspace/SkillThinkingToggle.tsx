import { Brain } from 'lucide-react';

type Props = {
  enabled: boolean;
  disabled: boolean;
  supported: boolean | null;
  onChange(enabled: boolean): void;
};

export function SkillThinkingToggle({
  enabled,
  disabled,
  supported,
  onChange,
}: Props) {
  return (
    <div className="skill-thinking-control">
      <button
        type="button"
        className={`skill-thinking-toggle${enabled ? ' is-active' : ''}`}
        aria-pressed={enabled}
        aria-label={enabled ? '关闭深度思考' : '开启深度思考'}
        disabled={disabled}
        onClick={() => onChange(!enabled)}
      >
        <Brain size={15} aria-hidden="true" />
        <span>深度思考：{enabled ? '开' : '关'}</span>
      </button>
      {enabled && supported === false ? (
        <span className="skill-thinking-capability" role="status">
          当前模型不支持深度思考，将正常生成回答
        </span>
      ) : null}
    </div>
  );
}
