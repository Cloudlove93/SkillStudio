export default function DiffView({ diff }: { diff: string }) {
  const lines = diff.split('\n');

  return (
    <pre className="overflow-x-auto rounded-md bg-zinc-950 p-2 text-xs font-mono leading-relaxed max-w-full">
      {lines.map((line, i) => {
        let cls = 'text-zinc-500';
        if (line.startsWith('+') && !line.startsWith('+++')) {
          cls = 'text-green-400 bg-green-500/10';
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          cls = 'text-red-400 bg-red-500/10';
        } else if (line.startsWith('@@')) {
          cls = 'text-blue-400 bg-blue-500/5';
        }
        return (
          <div key={i} className={`${cls} px-1 -mx-1 rounded-sm`}>
            {line}
          </div>
        );
      })}
    </pre>
  );
}
