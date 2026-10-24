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
    sourceFacts: [
      {
        evidenceId: 'ev-frame',
        quote: '连续 3 次全对才撤架；否则再做 5 道复核题。',
      },
    ],
    evidenceIds: ['ev-frame'],
    relations: [],
    mechanism: '根据{连续成功次数}调整支架。',
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
    expect(body).toContain('- “连续 3 次全对才撤架；否则再做 5 道复核题。”（来源 [ev-frame]）');
    expect(body).toContain('{连续成功次数}');
  });

  it('rejects a source fact whose quote is not verbatim in the bound evidence', () => {
    const mismatched = {
      sourceFacts: [{ evidenceId: 'ev-frame', quote: '连续 9 次全对才撤架。' }],
    };
    expect(() =>
      assembleRiaSkillMarkdown(skill(mismatched), grounded()),
    ).toThrowError(/原文不一致/);
    expect(() =>
      assertRiaSemanticGrounding(skill(mismatched), grounded()),
    ).toThrow(RiaContentError);
  });

  it('allows execution.input to declare parameter values taken from the case', () => {
    const body = assembleRiaSkillMarkdown(
      skill({
        execution: {
          input:
            '1. {连续成功次数}（原案例为 3 次）；2. {复核题数量}（原案例为 5 道）。',
          steps: ['连续{连续成功次数}次全对后撤架。'],
          output: '支架状态',
          completionCriteria: '连续{连续成功次数}次达标。',
          stopCriteria: '参数缺失时停止。',
        },
      }),
      grounded(),
    );
    expect(body).toContain('原案例为 3 次');
    expect(body).toContain('原案例为 5 道');
  });

  it('allows parenthetical illustrations of parameter values', () => {
    const body = assembleRiaSkillMarkdown(
      skill({
        futureApplicability:
          '新任务可调整{连续成功次数}（如从 3 次改为 5 次以提高标准）。',
      }),
      grounded(),
    );
    expect(body).toContain('如从 3 次改为 5 次');
  });

  it('ignores ordered-list markers that reuse a source number', () => {
    const body = assembleRiaSkillMarkdown(
      skill({
        mechanism:
          '1. 判定双维标准。\n2. 追踪连续达标。\n3. 达到{连续成功次数}次后撤架。',
      }),
      grounded(),
    );
    expect(body).toContain('3. 达到{连续成功次数}次后撤架。');
  });

  it('folds line breaks inside a verbatim quote into one list line', () => {
    const body = assembleRiaSkillMarkdown(
      skill({
        sourceFacts: [{ evidenceId: 'ev-frame', quote: '第一行\n第二行' }],
      }),
      [evidence(['第一行\n第二行'])],
    );
    expect(body).toContain('- “第一行 第二行”（来源 [ev-frame]）');
  });

  it('ignores bare counters such as "加 1" even when the case counts 1', () => {
    const body = assembleRiaSkillMarkdown(
      skill({
        sourceFacts: [{ evidenceId: 'ev-frame', quote: '每完成 1 次任务后计数器归零。' }],
        execution: {
          input: '需确认{连续成功次数}与{复核题数量}',
          steps: ['学生完成一题后计数器加 1。'],
          output: '支架状态',
          completionCriteria: '连续{连续成功次数}次达标。',
          stopCriteria: '参数缺失时停止。',
        },
      }),
      [evidence(['每完成 1 次任务后计数器归零。'])],
    );
    expect(body).toContain('计数器加 1');
  });

  it('rejects a large case quantity written bare without a unit', () => {
    expect(() =>
      assembleRiaSkillMarkdown(
        skill({
          sourceFacts: [{ evidenceId: 'ev-frame', quote: '再完成 18 道练习。' }],
          execution: {
            input: '需确认{练习数量}',
            steps: ['学生完成 18 练习题。'],
            output: '支架状态',
            completionCriteria: '连续{连续成功次数}次达标。',
            stopCriteria: '参数缺失时停止。',
          },
        }),
        [evidence(['再完成 18 道练习。'])],
      ),
    ).toThrowError(/来源数字 18/);
  });

  it('rejects a draft without verbatim source facts', () => {
    expect(() =>
      assembleRiaSkillMarkdown(skill({ sourceFacts: [] }), grounded()),
    ).toThrowError(/缺少逐字引用/);
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
