import { useEffect, useState } from 'react';

export default function CodeBlock({ code, language }: { code: string; language: string }) {
  const [html, setHtml] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    setHtml('');
    async function highlight() {
      try {
        const { codeToHtml } = await import('shiki');
        const result = await codeToHtml(code, {
          lang: language,
          theme: 'github-dark',
        });
        if (!cancelled) {
          setHtml(result);
        }
      } catch {
        // Fallback: use plain text
      }
    }
    highlight();
    return () => { cancelled = true; };
  }, [code, language]);

  if (!html) {
    return (
      <pre className="overflow-x-auto bg-zinc-950 p-3 text-xs max-w-full leading-relaxed">
        <code className="text-zinc-300">{code}</code>
      </pre>
    );
  }

  return (
    <div
      className="overflow-x-auto text-xs [&_pre]:p-3 [&_pre]:leading-relaxed max-w-full"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
