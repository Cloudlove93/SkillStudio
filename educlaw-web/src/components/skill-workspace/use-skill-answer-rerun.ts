import { useCallback, useMemo, useRef } from 'react';
import type { AnswerOptimizationSelection } from './answer-optimization-selection';

export function useSkillAnswerRerun(
  token: string,
  skillKey: string | null,
  reload: () => Promise<void>,
  onReady: (
    versionNumber: number,
    selection: AnswerOptimizationSelection,
  ) => void,
) {
  const scope = useMemo(() => ({ token, skillKey }), [token, skillKey]);
  const current = useRef(scope);
  current.current = scope;
  return useCallback(
    async (versionNumber: number, selection: AnswerOptimizationSelection) => {
      if (
        current.current !== scope ||
        !skillKey ||
        Number(skillKey.split(':')[0]) !== selection.packageId
      )
        return;
      await reload();
      if (current.current !== scope) return;
      onReady(versionNumber, selection);
    },
    [scope, skillKey, reload, onReady],
  );
}
