import { ArrowRight, Layers3, Sparkles, Wand2 } from 'lucide-react';
import type { PresetMatch, StudioPreset, StudioPresetKind } from '../../lib/studio-presets';
import './preset-recommendation.css';

const kindLabels: Record<StudioPresetKind, string> = {
  'lesson-pack': '课例包 Skill',
  'analysis-skill': '分析 Skill',
  'agent-template': 'Agent 模板',
};

type Props = {
  presets: PresetMatch[];
  title?: string;
  onUse: (preset: StudioPreset) => void;
  onRemix: (preset: StudioPreset) => void;
  onDismiss: () => void;
  compact?: boolean;
};

export function PresetRecommendation({
  presets,
  title = '已有相关资源',
  onUse,
  onRemix,
  onDismiss,
  compact = false,
}: Props) {
  if (!presets.length) return null;

  return (
    <section
      className={`preset-recommendation${compact ? ' is-compact' : ''}`}
      role="region"
      aria-label="相关资源推荐"
    >
      <header className="preset-recommendation-head">
        <div>
          <span className="preset-recommendation-eyebrow">
            <Sparkles size={13} aria-hidden="true" />
            {title}
          </span>
          <p>
            我们已有相关的 Agent / Skill / 课例包，要直接用，还是基于它改？
          </p>
        </div>
        <button
          type="button"
          className="preset-recommendation-dismiss"
          onClick={onDismiss}
        >
          先不用
        </button>
      </header>

      <div className="preset-recommendation-list">
        {presets.map((match) => (
          <article
            key={match.preset.id}
            className={`preset-recommendation-item is-${match.preset.kind}`}
          >
            <span className="preset-recommendation-icon" aria-hidden="true">
              {match.preset.kind === 'lesson-pack' ? (
                <Layers3 size={16} />
              ) : match.preset.kind === 'analysis-skill' ? (
                <Wand2 size={16} />
              ) : (
                <Sparkles size={16} />
              )}
            </span>
            <div className="preset-recommendation-copy">
              <span className={`preset-recommendation-kind is-${match.preset.kind}`}>
                {kindLabels[match.preset.kind]}
              </span>
              <strong>{match.preset.name}</strong>
              <small>
                {match.reason}
                {!compact ? ` · ${match.preset.description}` : ''}
              </small>
            </div>
            <div className="preset-recommendation-actions">
              <button
                type="button"
                className="preset-recommendation-use"
                onClick={() => onUse(match.preset)}
              >
                用这个
                <ArrowRight size={13} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="preset-recommendation-remix"
                onClick={() => onRemix(match.preset)}
              >
                基于这个改
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
