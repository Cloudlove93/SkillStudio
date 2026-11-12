import type { ReactNode } from 'react';
import { Bot, BookOpen } from 'lucide-react';
import './asset-center.css';

export function AssetCard({
  kind,
  name,
  description,
  metadata,
  children,
  onOpen,
  detail = false,
}: {
  kind: 'agent' | 'skill';
  name: string;
  description: string;
  metadata?: Array<{ label: string; value: ReactNode }>;
  children?: ReactNode;
  onOpen?: () => void;
  detail?: boolean;
}) {
  const Icon = kind === 'agent' ? Bot : BookOpen;
  const Heading = detail ? 'h1' : 'h2';
  return (
    <article className={`asset-card${detail ? ' asset-card-detail' : ''}`}>
      <div className="asset-card-heading">
        <span className={`asset-symbol asset-symbol-${kind}`}>
          <Icon size={21} aria-hidden="true" />
        </span>
        <div>
          <span className="asset-kind">
            {kind === 'agent' ? 'Agent' : 'Skill'}
          </span>
          <Heading>
            {onOpen ? (
              <button
                type="button"
                className="asset-title-button"
                onClick={onOpen}
              >
                {name}
              </button>
            ) : (
              name
            )}
          </Heading>
        </div>
      </div>
      <p className="asset-description">{description || '暂无描述'}</p>
      {metadata && (
        <dl className="asset-metadata">
          {metadata.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {children && <div className="asset-card-actions">{children}</div>}
    </article>
  );
}
