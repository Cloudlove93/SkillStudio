import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8');

describe('application font loading', () => {
  it('uses the native Chinese UI stack without shipping every Noto CJK slice', () => {
    const entry = read('./main.tsx');
    const css = read('./index.css');

    expect(entry).not.toContain('@fontsource-variable/noto-sans-sc');
    expect(css).toContain('"PingFang SC"');
    expect(css).toContain('"Microsoft YaHei UI"');
  });

  it('applies the saved theme before React loads to avoid a light-mode flash', () => {
    const html = read('../index.html');

    expect(html).toContain("localStorage.getItem('educlaw-theme')");
    expect(html).toContain("classList.toggle('dark'");
    expect(html.indexOf("localStorage.getItem('educlaw-theme')")).toBeLessThan(
      html.indexOf('/src/main.tsx'),
    );
  });
});
