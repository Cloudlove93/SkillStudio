import { describe, expect, it } from 'vitest';
import type { MultimodalEvidence, RiaSkillDraft } from '@educlaw/shared';
import {
  assembleRiaSkillMarkdown,
  assertRiaSemanticGrounding,
  RiaContentError,
} from './ria-skill-markdown.js';

type Skill = Parameters<typeof assembleRiaSkillMarkdown>[0];

function evidence(visibleText: string[]): MultimodalEvidence {
  return {
    evidenceId: 'ev-frame',
    kind: 'frame',
    source: { primarySourceId: 'source-1' },
    timeRange: { startMs: 0, endMs: 1 },
    text: visibleText.join('\n'),
    assetRef: null,
    provenance: {
      method: 'vision_soft_ranking',
      processorVersion: 'vision-v1',
      confidence: 0.9,
      editedByUser: false,
    },
    claimType: 'modelInference',
    selectionReason: 'test',
    visualObservation: { visibleText, uncertainties: [] },
  } as MultimodalEvidence;
}

function skill(overrides: Partial<RiaSkillDraft['ria']> = {}): Skill {
  return {
    candidateId: 'c1',
    id: 'skill-1',
    dirName: 'adaptive-scaffold',
    name: '自适应支架',
    description: '根据<连续成功次数>调整支架',
    sourceEvidenceIds: ['ev-frame'],
    evidenceIds: ['ev-frame'],
    relations: [],
    mechanism: '根据{连续成功次数}调整支架。',
    sourceExample: '原案例：连续3次全对才撤架，否则再做5道复核题。',
    futureApplicability: '新任务重新确认参数。',
    execution: {
      input: '需确认{连续成功次数}与{复核题数量}',
      steps: ['连续{连续成功次数}次全对后撤架。'],
      output: '支架状态',
      completionCriteria: '连续{连续成功次数}次达标。',
      stopCriteria: '参数缺失时停止。',
    },
    boundaries: {
      counterexamples: ['不能一次达标就撤架。'],
      failureModes: ['把原案例的 3 次当成通用标准。'],
      limits: ['原案例 5 道仅适用于本案例。'],
      confusions: ['撤架前后条件不同。'],
    },
    ...overrides,
  } as Skill;
}

const grounded = () => [evidence(['连续 3 次全对才撤架；否则再做 5 道复核题。'])];

describe('ria skill markdown assembly', () => {
  it('emits YAML frontmatter with the directory name and a sanitized description', () => {
    const body = assembleRiaSkillMarkdown(skill(), grounded());
    expect(body.startsWith('---\nname: adaptive-scaffold\ndescription: ')).toBe(true);
    expect(body).toContain('\n---\n\n# 自适应支架');
    expect(body.slice(0, body.indexOf('---\n\n'))).not.toContain('<');
  });

  it('accepts parameter placeholders and leaves source numbers in the case section', () => {
    const body = assembleRiaSkillMarkdown(skill(), grounded());
    expect(body).toContain('连续3次全对才撤架');
    expect(body).toContain('{连续成功次数}');
  });

  it('rejects a source example with a quantity absent from the bound evidence', () => {
    expect(() =>
      assembleRiaSkillMarkdown(
        skill({ sourceExample: '原案例：连续9次全对才撤架。' }),
        grounded(),
      ),
    ).toThrowError(/绑定证据中没有的数字/);
    expect(() =>
      assertRiaSemanticGrounding(
        skill({ sourceExample: '原案例：连续9次全对才撤架。' }),
        grounded(),
      ),
    ).toThrow(RiaContentError);
  });

  it('rejects a bare source-case number promoted into an executable field', () => {
    expect(() =>
      assembleRiaSkillMarkdown(
        skill({
          execution: {
            input: '参数待确认',
            steps: ['连续3次全对后撤架。'],
            output: '支架状态',
            completionCriteria: '连续3次达标。',
            stopCriteria: '参数缺失时停止。',
          },
        }),
        grounded(),
      ),
    ).toThrowError(/固定规则/);
  });

  it('keeps the existing binding and uncertainty guards', () => {
    expect(() =>
      assembleRiaSkillMarkdown(
        skill({ sourceEvidenceIds: ['ev-missing'] }),
        grounded(),
      ),
    ).toThrowError(/来源引用未能对应/);
    const uncertain = evidence(['连续 3 次全对才撤架。']);
    uncertain.visualObservation = {
      visibleText: ['连续 3 次全对才撤架。'],
      uncertainties: ['右下角标记不清晰。'],
    };
    expect(() => assembleRiaSkillMarkdown(skill(), [uncertain])).toThrowError(
      /仍有不确定内容/,
    );
  });
});
