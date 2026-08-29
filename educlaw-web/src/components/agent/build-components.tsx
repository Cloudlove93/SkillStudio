import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Loader2, CheckCircle2, XCircle, ChevronRight } from 'lucide-react';
import type { LogEntry, ProfilePreview, SkillPreview } from '../../stores/build';
import type { MessageKey } from '../../i18n';

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function MetadataSummary({ metadata }: { metadata?: Record<string, unknown> }) {
  if (!metadata) return null;

  const chips: string[] = [];
  const pushValue = (label: string, value: unknown) => {
    if (typeof value === 'string' && value.trim()) chips.push(`${label}: ${value.trim()}`);
    if (Array.isArray(value) && value.length > 0) {
      const values = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
      if (values.length > 0) chips.push(`${label}: ${values.slice(0, 3).join(', ')}`);
    }
  };

  pushValue('Domain', metadata.domain);
  pushValue('Audience', metadata.audience);
  pushValue('Triggers', metadata.triggers);
  pushValue('Inputs', metadata.inputs);
  pushValue('Outputs', metadata.outputs);

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <span key={chip} className="inline-flex items-center rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
          {chip}
        </span>
      ))}
    </div>
  );
}

export function ProfilePreviewCard({ preview, t }: { preview: ProfilePreview; t: (key: MessageKey) => string }) {
  return (
    <div className="rounded-lg border border-blue-500/30 bg-background p-4 space-y-3">
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1">{t('build.nameLabel')}</div>
        <div className="text-base font-semibold">{preview.name}</div>
      </div>
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1">{t('build.descLabel')}</div>
        <div className="text-sm text-foreground/80">{preview.description}</div>
      </div>
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1">{t('build.detailsLabel')}</div>
        <div className="prose dark:prose-invert prose-sm max-w-none max-h-64 overflow-y-auto">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{preview.details}</ReactMarkdown>
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1 border-t border-border">
        <Loader2 className="size-3 animate-spin" />
        <span>{t('build.matchingSkills')}</span>
      </div>
    </div>
  );
}

export function SkillPreviewCard({ preview }: { preview: SkillPreview }) {
  return (
    <div className="rounded-lg border border-emerald-500/30 bg-background p-4 space-y-3">
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1">Skill</div>
        <div className="text-base font-semibold">{preview.name}</div>
      </div>
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1">Description</div>
        <div className="text-sm text-foreground/80">{preview.description}</div>
      </div>
      <MetadataSummary metadata={preview.metadata} />
      {preview.skillMarkdown && (
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">SKILL.md Preview</div>
          <div className="prose dark:prose-invert prose-sm max-w-none max-h-64 overflow-y-auto rounded-lg border border-border bg-muted/20 px-3 py-2">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{preview.skillMarkdown}</ReactMarkdown>
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1 border-t border-border">
        <Loader2 className="size-3 animate-spin" />
            <span>Preparing standalone skill</span>
      </div>
    </div>
  );
}

export function LogItem({ entry, t }: { entry: LogEntry; t: (key: MessageKey) => string }) {
  if (entry.type === 'step') {
    return (
      <div className="flex items-start gap-2 text-sm">
        <ChevronRight className="size-4 mt-0.5 text-blue-500 shrink-0" />
        <span className="text-foreground/80">{entry.message}</span>
      </div>
    );
  }

  if (entry.type === 'decision' && entry.decision) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
            Decision
          </span>
          <span className="text-sm font-medium text-foreground">
            {entry.decision.kind === 'skill' ? 'Generate standalone skill' : 'Generate agent'}
          </span>
        </div>
        <div className="text-sm text-foreground/80">{entry.decision.reason}</div>
        {(entry.decision.suggestedName || entry.decision.suggestedDescription) && (
          <div className="text-xs text-muted-foreground space-y-1">
            {entry.decision.suggestedName && <div>Name: {entry.decision.suggestedName}</div>}
            {entry.decision.suggestedDescription && <div>Description: {entry.decision.suggestedDescription}</div>}
          </div>
        )}
      </div>
    );
  }

  if (entry.type === 'profile' && entry.profile) {
    const { name, description, details, skills } = entry.profile;
    return (
      <div className="rounded-lg border border-border bg-background p-4 space-y-3">
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">{t('build.nameLabel')}</div>
          <div className="text-base font-semibold">{name}</div>
        </div>
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">{t('build.descLabel')}</div>
          <div className="text-sm text-foreground/80">{description}</div>
        </div>
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">{t('build.detailsLabel')}</div>
          <div className="prose dark:prose-invert prose-sm max-w-none max-h-64 overflow-y-auto">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{details}</ReactMarkdown>
          </div>
        </div>
        {skills.length > 0 && (
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-1.5">{t('build.loadSkills')}</div>
            <div className="flex flex-wrap gap-1.5">
              {skills.map((s) => (
                <span key={s} className="inline-flex items-center rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300">
                  {s}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (entry.type === 'skill' && entry.skill) {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-background p-4 space-y-3">
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-1">Saved Skill</div>
          <div className="text-base font-semibold">{entry.skill.name}</div>
        </div>
        <div className="text-sm text-foreground/80">{entry.skill.description}</div>
        <MetadataSummary metadata={entry.skill.metadata} />
        {entry.skill.dirName && (
          <div className="text-xs text-muted-foreground">Directory: {entry.skill.dirName}</div>
        )}
      </div>
    );
  }

  if (entry.type === 'done') {
    const label = entry.message === 'skill' ? 'Skill generation complete' : t('build.done');
    return (
      <div className="flex items-center gap-2 text-sm font-medium text-green-600 dark:text-green-400">
        <CheckCircle2 className="size-4 shrink-0" />
        <span>{label}</span>
      </div>
    );
  }

  if (entry.type === 'error') {
    const errorLabels: Record<string, string> = {
      llm_api: t('build.errorLLM'),
      rate_limit: t('build.errorRateLimit'),
      model_not_found: t('build.errorModelNotFound'),
      no_model: t('build.errorNoModel'),
      network: t('build.errorNetwork'),
      empty_response: t('build.errorEmpty'),
      parse_error: t('build.errorParse'),
      workspace: t('build.errorWorkspace'),
      unexpected: t('build.errorUnexpected'),
    };
    const label = entry.errorType ? errorLabels[entry.errorType] || entry.errorType : undefined;
    const isParseError = entry.errorType === 'parse_error';

    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-2">
        <div className="flex items-start gap-2">
          <XCircle className="size-4 mt-0.5 shrink-0 text-destructive" />
          <div className="flex-1 min-w-0">
            {label && (
              <span className="inline-block text-xs font-medium text-destructive bg-destructive/10 rounded px-1.5 py-0.5 mb-1">
                {label}
              </span>
            )}
            <div className="text-sm text-destructive">{entry.message}</div>
          </div>
        </div>
        {entry.detail && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
              {isParseError ? t('build.viewRawOutput') : t('build.viewDetails')}
            </summary>
            <pre className="mt-1.5 p-2 rounded bg-muted text-muted-foreground whitespace-pre-wrap break-words max-h-48 overflow-y-auto font-mono">
              {entry.detail}
            </pre>
          </details>
        )}
      </div>
    );
  }

  return null;
}
