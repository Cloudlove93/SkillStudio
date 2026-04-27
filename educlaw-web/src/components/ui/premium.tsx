import type { ComponentPropsWithoutRef, ReactNode, ElementType } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type Accent = 'blue' | 'emerald' | 'amber' | 'violet' | 'rose' | 'slate';

const accentStyles: Record<Accent, {
  iconWrap: string;
  iconColor: string;
  pill: string;
}> = {
  blue: {
    iconWrap: 'bg-[rgba(55,130,255,0.10)]',
    iconColor: 'text-[color:var(--info)]',
    pill: 'border-[rgba(55,130,255,0.12)] bg-[rgba(55,130,255,0.10)] text-[color:var(--info)]',
  },
  emerald: {
    iconWrap: 'bg-[rgba(30,180,120,0.10)]',
    iconColor: 'text-[color:var(--success)]',
    pill: 'border-[rgba(30,180,120,0.12)] bg-[rgba(30,180,120,0.10)] text-[color:var(--success)]',
  },
  amber: {
    iconWrap: 'bg-[rgba(255,180,0,0.12)]',
    iconColor: 'text-[color:var(--warning)]',
    pill: 'border-[rgba(255,180,0,0.14)] bg-[rgba(255,180,0,0.12)] text-[color:var(--warning)]',
  },
  violet: {
    iconWrap: 'bg-[rgba(140,85,255,0.10)]',
    iconColor: 'text-[#8c55ff]',
    pill: 'border-[rgba(140,85,255,0.14)] bg-[rgba(140,85,255,0.10)] text-[#8c55ff]',
  },
  rose: {
    iconWrap: 'bg-[rgba(240,45,45,0.10)]',
    iconColor: 'text-destructive',
    pill: 'border-[rgba(240,45,45,0.14)] bg-[rgba(240,45,45,0.10)] text-destructive',
  },
  slate: {
    iconWrap: 'bg-muted',
    iconColor: 'text-foreground',
    pill: 'border-border bg-muted text-foreground',
  },
};

export function DetailSurface({
  className,
  ...props
}: ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[16px] border border-border bg-card shadow-[var(--shadow-sm)]',
        className,
      )}
      {...props}
    />
  );
}

export function PremiumPill({
  className,
  accent = 'slate',
  icon: Icon,
  children,
  ...props
}: ComponentPropsWithoutRef<'div'> & {
  accent?: Accent;
  icon?: ElementType;
  children: ReactNode;
}) {
  const tone = accentStyles[accent];

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium',
        tone.pill,
        className,
      )}
      {...props}
    >
      {Icon && <Icon className="size-3" />}
      <span>{children}</span>
    </div>
  );
}

export function PremiumHeader({
  className,
  accent = 'blue',
  eyebrow,
  title,
  description,
  icon: Icon,
  actions,
}: {
  className?: string;
  accent?: Accent;
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  icon: LucideIcon;
  actions?: ReactNode;
}) {
  const tone = accentStyles[accent];

  return (
    <DetailSurface className={cn('px-4 py-4 sm:px-5', className)}>
      <div className="relative flex items-start gap-3">
        <div className={cn('flex size-11 shrink-0 items-center justify-center rounded-[12px] border border-border', tone.iconWrap)}>
          <Icon className={cn('size-5', tone.iconColor)} />
        </div>
        <div className="min-w-0 flex-1">
          {eyebrow ? (
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
              {eyebrow}
            </div>
          ) : null}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold tracking-[-0.02em] text-foreground sm:text-lg">
                {title}
              </h2>
              {description ? (
                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                  {description}
                </p>
              ) : null}
            </div>
            {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
          </div>
        </div>
      </div>
    </DetailSurface>
  );
}
