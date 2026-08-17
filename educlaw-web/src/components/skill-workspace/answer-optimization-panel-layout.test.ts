import { describe, expect, it } from 'vitest';
import {
  clampStatusPanelHeight,
  collapsePanelLayout,
  createManualPanelLayout,
  resetPanelLayout,
} from './answer-optimization-panel-layout';

describe('answer optimization panel layout', () => {
  it('clamps a dragged status panel while preserving the conversation minimum', () => {
    expect(clampStatusPanelHeight(260, 520, 128, 76)).toBe(260);
    expect(clampStatusPanelHeight(500, 520, 128, 76)).toBe(392);
    expect(clampStatusPanelHeight(20, 520, 128, 76)).toBe(76);
  });

  it('moves between automatic, manual and collapsed modes', () => {
    expect(createManualPanelLayout(220, 500)).toEqual({ mode: 'manual', height: 220 });
    expect(collapsePanelLayout()).toEqual({ mode: 'collapsed', height: null });
    expect(resetPanelLayout()).toEqual({ mode: 'auto', height: null });
  });
});
