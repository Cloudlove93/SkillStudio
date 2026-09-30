export type SkillStreamDeltas = {
  reasoning: string;
  content: string;
};

export function createSkillStreamBuffer(
  flush: (deltas: SkillStreamDeltas) => void,
  schedule: (callback: () => void) => number,
  cancel: (handle: number) => void,
) {
  let reasoning = '';
  let content = '';
  let handle: number | null = null;
  let disposed = false;

  const flushPending = () => {
    handle = null;
    if (disposed || (!reasoning && !content)) return;
    const deltas = { reasoning, content };
    reasoning = '';
    content = '';
    flush(deltas);
  };

  return {
    append(type: 'reasoning' | 'content', delta: string) {
      if (disposed || !delta) return;
      if (type === 'reasoning') reasoning += delta;
      else content += delta;
      if (handle === null) handle = schedule(flushPending);
    },
    flushNow() {
      if (handle !== null) cancel(handle);
      flushPending();
    },
    dispose() {
      disposed = true;
      if (handle !== null) cancel(handle);
      handle = null;
      reasoning = '';
      content = '';
    },
  };
}
