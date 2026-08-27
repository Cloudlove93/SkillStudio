import { describe, expect, it, vi } from 'vitest';
import type { AgentPackageSnapshot } from '@educlaw/shared';
import {
  computeMultimodalArenaSnapshotHash,
  MULTIMODAL_ARENA_CONFIG_VERSION,
  evaluateMultimodalSkillPackDraft,
} from './arena-service.js';

function reorderJsonKeys<T>(value: T): T {
  if (Array.isArray(value)) return value.map(reorderJsonKeys) as T;
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => right.localeCompare(left))
      .map(([key, item]) => [key, reorderJsonKeys(item)]),
  ) as T;
}

const snapshot: AgentPackageSnapshot = {
  name: '课堂讨论 Skill Pack',
  description: '从课堂视频中蒸馏的可复用方法',
  versionLabel: 'v1',
  agentMd: '# Agent\n按证据边界使用技能。',
  rubricMd: '# Rubric\n- 可执行\n- 有边界\n- 不编造',
  skills: [
    {
      id: 'skill-1',
      dirName: 'discussion-transfer',
      name: '讨论迁移法',
      description: '把讨论方法迁移到新场景',
      skillMd: '# 讨论迁移法\n先识别目标，再执行步骤，遇到边界停止。',
    },
  ],
};

describe('multimodal draft Arena', () => {
  it('keeps snapshot hashes stable when JSONB changes object key order', () => {
    expect(computeMultimodalArenaSnapshotHash(reorderJsonKeys(snapshot))).toBe(
      computeMultimodalArenaSnapshotHash(snapshot),
    );
  });

  it('uses fixed cases/models/config and recomputes the deterministic gate', async () => {
    const generateText = vi
      .fn()
      .mockResolvedValueOnce('baseline-1')
      .mockResolvedValueOnce('enhanced-1')
      .mockResolvedValueOnce('baseline-2')
      .mockResolvedValueOnce('enhanced-2')
      .mockResolvedValueOnce('baseline-3')
      .mockResolvedValueOnce('enhanced-3');
    const judges = [
      { baselineScore: 2, enhancedScore: 4, safetyPassed: true, groundedPassed: true, reason: '更可执行' },
      { baselineScore: 3, enhancedScore: 4, safetyPassed: true, groundedPassed: true, reason: '边界清晰' },
      { baselineScore: 4, enhancedScore: 2, safetyPassed: true, groundedPassed: true, reason: '第三项较弱' },
    ];
    const generateJson = vi.fn().mockImplementation(async () => judges.shift());

    const result = await evaluateMultimodalSkillPackDraft(
      {
        snapshot,
        candidateRevisionNo: 17,
        baselineModel: 'baseline-fixed',
        enhancedModel: 'enhanced-fixed',
      },
      { generateText, generateJson },
    );

    expect(result.configVersion).toBe(MULTIMODAL_ARENA_CONFIG_VERSION);
    expect(result.candidateRevisionNo).toBe(17);
    expect(result.models).toEqual({ baseline: 'baseline-fixed', enhanced: 'enhanced-fixed' });
    expect(result.cases).toHaveLength(3);
    expect(result.cases.map((item) => item.caseId)).toEqual([
      'novel-scenario-transfer',
      'boundary-and-stop',
      'evidence-grounding',
    ]);
    expect(result.passed).toBe(true);
    expect(result.passedCaseCount).toBe(2);
    expect(result.snapshotHash).toBe(computeMultimodalArenaSnapshotHash(snapshot));
    expect(result.resultHash).toMatch(/^[a-f0-9]{64}$/);
    expect(generateText).toHaveBeenCalledTimes(6);
    expect(generateJson).toHaveBeenCalledTimes(3);
  });

  it('blocks the gate when any judge reports a safety failure', async () => {
    const generateText = vi.fn().mockResolvedValue('answer');
    const generateJson = vi.fn().mockResolvedValue({
      baselineScore: 2,
      enhancedScore: 5,
      safetyPassed: false,
      groundedPassed: true,
      reason: '存在安全问题',
    });

    const result = await evaluateMultimodalSkillPackDraft(
      { snapshot, candidateRevisionNo: 18, baselineModel: 'b', enhancedModel: 'e' },
      { generateText, generateJson },
    );

    expect(result.passed).toBe(false);
    expect(result.deterministicFailures).toContain('SAFETY_GATE_FAILED');
  });

  it('uses one bounded full-response repair when an Arena judge violates the contract', async () => {
    const generateText = vi.fn().mockResolvedValue('answer');
    const validJudge = {
      baselineScore: 2,
      enhancedScore: 4,
      safetyPassed: true,
      groundedPassed: true,
      reason: '增强回答更可执行',
    };
    const generateJson = vi
      .fn()
      .mockResolvedValueOnce({ ...validJudge, unexpected: true })
      .mockResolvedValueOnce(validJudge)
      .mockResolvedValueOnce(validJudge)
      .mockResolvedValueOnce(validJudge);

    const result = await evaluateMultimodalSkillPackDraft(
      { snapshot, candidateRevisionNo: 19, baselineModel: 'b', enhancedModel: 'e' },
      { generateText, generateJson },
    );

    expect(result.passed).toBe(true);
    expect(generateJson).toHaveBeenCalledTimes(4);
    expect(generateJson.mock.calls[1]?.[0].systemPrompt).toContain(
      'single bounded contract-repair attempt',
    );
    expect(generateJson.mock.calls[1]?.[0].userPrompt).toContain(
      'Arena judge returned unexpected fields',
    );
  });
});
