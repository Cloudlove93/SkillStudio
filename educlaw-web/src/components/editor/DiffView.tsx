type DiffRow =
  | { kind: 'hunk'; text: string }
  | { kind: 'added'; text: string }
  | { kind: 'removed'; text: string }
  | { kind: 'same'; text: string }
  | { kind: 'meta'; text: string };

function parseUnifiedDiff(diff: string): DiffRow[] {
  const lines = diff.split('\n');
  const rows: DiffRow[] = [];
  let inHunk = false;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      inHunk = true;
      rows.push({ kind: 'hunk', text: line });
    } else if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('Index:') || line.startsWith('===')) {
      rows.push({ kind: 'meta', text: line });
    } else if (line.startsWith('+')) {
      rows.push({ kind: 'added', text: line.slice(1) });
    } else if (line.startsWith('-')) {
      rows.push({ kind: 'removed', text: line.slice(1) });
    } else if (line.startsWith(' ')) {
      rows.push({ kind: 'same', text: line.slice(1) });
    } else if (inHunk || line === '') {
      rows.push({ kind: 'same', text: line });
    } else {
      rows.push({ kind: 'meta', text: line });
    }
  }
  return rows;
}

export default function DiffView({ diff }: { diff: string }) {
  const rows = parseUnifiedDiff(diff);

  return (
    <div className="rounded-xl border border-border/80 bg-card overflow-hidden">
      {rows.map((row, i) => {
        if (row.kind === 'meta') return null;

        if (row.kind === 'hunk') {
          return (
            <div
              key={i}
              className="flex items-center gap-2 px-3 py-1.5 border-y border-border/40 bg-muted/20"
            >
              <span className="text-[11px] font-medium text-primary/70 select-none">
                {row.text}
              </span>
            </div>
          );
        }

        if (row.kind === 'removed') {
          return (
            <div
              key={i}
              className="border-l-2 border-l-rose-300/60 dark:border-l-rose-700/40 bg-rose-50/50 dark:bg-rose-950/10 px-3 py-1"
            >
              <span className="whitespace-pre-wrap break-all text-[13px] leading-[1.65] text-foreground/55">
                {row.text || ' '}
              </span>
            </div>
          );
        }

        if (row.kind === 'added') {
          return (
            <div
              key={i}
              className="border-l-2 border-l-emerald-300/60 dark:border-l-emerald-700/40 bg-emerald-50/50 dark:bg-emerald-950/10 px-3 py-1"
            >
              <span className="whitespace-pre-wrap break-all text-[13px] leading-[1.65] text-foreground">
                {row.text || ' '}
              </span>
            </div>
          );
        }

        return (
          <div
            key={i}
            className="px-3 py-1"
          >
            <span className="whitespace-pre-wrap break-all text-[13px] leading-[1.65] text-muted-foreground/60">
              {row.text || ' '}
            </span>
          </div>
        );
      })}
    </div>
  );
}
