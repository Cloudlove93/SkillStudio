import { describe, expect, it } from 'vitest';
import {
  buildAnswerSkillAlternativeRegenerationPrompt,
  buildAnswerSkillOptimizationLocalizationPrompt,
  buildAnswerSkillOptimizationPrompt,
  buildAnswerSkillRepairPrompt,
  buildAnswerSkillRefinementPrompt,
} from './answer-skill-optimization.js';

describe('answer Skill optimization prompts', () => {
  it('contains only the required answer, feedback, rubric, and Skill context', () => {
    const prompt = buildAnswerSkillOptimizationPrompt({
      question: 'What should the teacher do first?',
      enhancedAnswer: 'The teacher should investigate and communicate.',
      baselineAnswer: 'Keep the student safe.',
      feedback: 'Add ordered steps and usable wording.',
      rubricMd: '## Dimensions\n- Actionability',
      usedSkillIds: ['skill-1'],
      skills: [
        {
          id: 'skill-1',
          dirName: 'teacher-response',
          name: 'Teacher Response',
          description: 'Use when a teacher needs an incident response.',
          skillMd: '## Workflow\nInvestigate and communicate.',
        },
      ],
    });

    expect(prompt.userPrompt).toContain('What should the teacher do first?');
    expect(prompt.userPrompt).toContain('ordered steps and usable wording');
    expect(prompt.userPrompt).toContain('Actionability');
    expect(prompt.userPrompt).toContain('skill-1');
    expect(prompt.userPrompt).not.toContain('Idempotency-Key');
    expect(prompt.userPrompt).not.toContain('requestHash');
    expect(prompt.userPrompt).not.toContain('userId');
    expect(prompt.systemPrompt).toContain('one EduSkill answer');
    expect(prompt.systemPrompt).toContain('Do not modify Agent');
    expect(prompt.systemPrompt).toContain('Simplified Chinese');
    expect(prompt.systemPrompt).toContain(
      'Keep JSON keys, enum values, Skill IDs, section values, and operation values',
    );
    expect(prompt.systemPrompt).toContain(
      'diagnosis.summary, diagnosis.riskNotes, candidateSkills.reason, and patch.reason',
    );
    expect(prompt.systemPrompt).toContain(
      'Only structured enum fields may contain the English enum tokens',
    );
    expect(prompt.systemPrompt).toContain(
      'refer to sections and operations with Simplified Chinese labels',
    );
    expect(prompt.systemPrompt).toContain(
      'When the target Skill is mainly Chinese',
    );
    expect(prompt.systemPrompt).toContain(
      'Preserve the original question and answer',
    );
    expect(prompt.systemPrompt).toContain(
      'Keep diagnosis.summary conversational and concise',
    );
    expect(prompt.systemPrompt).toContain(
      'Do not use report headings, horizontal separators, or a generic opening',
    );
    expect(prompt.systemPrompt).toContain(
      'Do not ask for confirmation unless a material ambiguity prevents a safe patch',
    );
    expect(prompt.systemPrompt).toContain('reusable');
    expect(prompt.systemPrompt).toContain('Instructions');
    expect(prompt.systemPrompt).toContain('append');
  });

  it('restricts repair to proposedContent', () => {
    const prompt = buildAnswerSkillRepairPrompt({
      originalSkillMd:
        '---\nname: skill-one\ndescription: Use when needed.\n---',
      patch: {
        section: 'Workflow',
        operation: 'replace',
        reason: 'Improve steps.',
        proposedContent: 'Too short.',
      },
      validationErrors: ['SKILL.md body is too short'],
    });

    expect(prompt.systemPrompt).toContain('exactly one field: proposedContent');
    expect(prompt.systemPrompt).toContain('Do not change the target Skill');
    expect(prompt.systemPrompt).toContain(
      "Preserve the target Skill's primary language",
    );
    expect(prompt.systemPrompt).toContain(
      'when the Skill is mainly Chinese, use Simplified Chinese',
    );
    expect(prompt.systemPrompt).toContain(
      'Do not translate JSON keys or any section or operation value',
    );
    expect(prompt.userPrompt).toContain('SKILL.md body is too short');
  });

  it('restricts localization to user-facing text and preserves internal values', () => {
    const prompt = buildAnswerSkillOptimizationLocalizationPrompt({
      output: {
        diagnosis: {
          summary: 'The answer lacks ordered steps.',
          reusability: 'reusable',
          riskNotes: [],
        },
        targetSkillId: 'skill-1',
        candidateSkills: [],
        patch: {
          section: 'Workflow',
          operation: 'append',
          reason: 'Add practical steps.',
          proposedContent: '3. Contact the family.',
        },
      },
      translateProposedContent: true,
    });

    expect(prompt.systemPrompt).toContain('Translate only diagnosis.summary');
    expect(prompt.systemPrompt).toContain(
      'also translate patch.proposedContent into Simplified Chinese',
    );
    expect(prompt.systemPrompt).toContain(
      'Do not change reusability, targetSkillId, candidate Skill IDs',
    );
    expect(prompt.systemPrompt).toContain(
      'Preserve the concise conversational style of user-facing summaries',
    );
    expect(prompt.systemPrompt).toContain(
      'Keep JSON keys and every enum value in English',
    );
    expect(prompt.userPrompt).toContain('"targetSkillId":"skill-1"');
    expect(prompt.userPrompt).toContain('"section":"Workflow"');
    expect(prompt.userPrompt).toContain('"operation":"append"');
  });

  it('builds a draft-review refinement from the current draft and prior accepted turns', () => {
    const prompt = buildAnswerSkillRefinementPrompt({
      source: 'draft_review',
      question: '班主任当天应该怎么处理？',
      enhancedAnswer: '先了解情况。',
      initialFeedback: '请给出按顺序的处理步骤。',
      previousSuccessfulTurns: [
        {
          id: 'turn-1',
          source: 'draft_review',
          fromRevision: 1,
          toRevision: 2,
          userMessage: '保留五步结构。',
          status: 'succeeded',
          createdAt: '2026-07-27T08:00:00.000Z',
          completedAt: '2026-07-27T08:00:01.000Z',
          assistantSummary: '已保留五步结构。',
          qualityEvidence: null,
          outcome: {
            kind: 'applied',
            assistantSummary: '已保留五步结构。',
          },
        },
      ],
      additionalFeedback: '把家长沟通写得更中性。',
      diagnosis: {
        summary: '原回答缺少稳定的执行步骤。',
        reusability: 'reusable',
        riskNotes: [],
      },
      targetSkill: {
        skillId: 'skill-one',
        name: '事件处理',
        selectionSource: 'recorded',
      },
      currentPatch: {
        section: 'Workflow',
        operation: 'replace',
        reason: '增加执行步骤。',
        proposedContent: '1. 确认安全。\n2. 核实事实。',
      },
      currentDraftSkillMd: '## Workflow\n1. 确认安全。\n2. 核实事实。',
      currentDiff: {
        before: '先了解情况。',
        after: '1. 确认安全。\n2. 核实事实。',
      },
      baseSkill: {
        id: 'skill-one',
        dirName: 'skill-one',
        name: '事件处理',
        description: '用于处理学生事件。',
        skillMd: '## Workflow\n先了解情况。',
      },
      rubricMd: '## 评估\n- 安全',
      qualityEvidence: null,
      failedSamples: [],
    });

    expect(prompt.systemPrompt).toContain('Work from the current draft');
    expect(prompt.systemPrompt).toContain('keep accepted content');
    expect(prompt.systemPrompt).toContain(
      'Do not repeat the initial reusable/single-turn/unclear classification',
    );
    expect(prompt.systemPrompt).toContain('short contextual requests');
    expect(prompt.systemPrompt).toContain('consolidated patch');
    expect(prompt.systemPrompt).toContain(
      'Keep assistantSummary conversational and concise',
    );
    expect(prompt.systemPrompt).toContain(
      'Put detailed changes in the patch instead of repeating them in assistantSummary',
    );
    expect(prompt.systemPrompt).toContain(
      'Do not use report headings, horizontal separators, or a generic opening',
    );
    expect(prompt.systemPrompt).toContain(
      'Do not ask for confirmation when the requested edit has already been applied safely',
    );
    expect(prompt.userPrompt).toContain('保留五步结构');
    expect(prompt.userPrompt).toContain('把家长沟通写得更中性');
    expect(prompt.userPrompt).toContain('currentDraftSkillMd');
  });

  it('builds a quality-failure refinement with only failed sample answers', () => {
    const prompt = buildAnswerSkillRefinementPrompt({
      source: 'test_failure',
      question: '班主任当天应该怎么处理？',
      enhancedAnswer: '先了解情况。',
      initialFeedback: '请给出按顺序的处理步骤。',
      previousSuccessfulTurns: [],
      additionalFeedback: '明确不能让学生承担监控职责。',
      diagnosis: {
        summary: '原回答缺少稳定的执行步骤。',
        reusability: 'reusable',
        riskNotes: [],
      },
      targetSkill: {
        skillId: 'skill-one',
        name: '事件处理',
        selectionSource: 'recorded',
      },
      currentPatch: {
        section: 'Workflow',
        operation: 'replace',
        reason: '增加执行步骤。',
        proposedContent: '1. 确认安全。\n2. 核实事实。',
      },
      currentDraftSkillMd: '## Workflow\n1. 确认安全。\n2. 核实事实。',
      currentDiff: {
        before: '先了解情况。',
        after: '1. 确认安全。\n2. 核实事实。',
      },
      baseSkill: {
        id: 'skill-one',
        dirName: 'skill-one',
        name: '事件处理',
        description: '用于处理学生事件。',
        skillMd: '## Workflow\n先了解情况。',
      },
      rubricMd: '## 评估\n- 安全',
      qualityEvidence: {
        testedRevision: 2,
        overallSummary: '两个样本仍把责任交给学生。',
        failedSamples: [
          {
            sampleIndex: 1,
            unmetRequirements: ['不能让学生监控同学'],
            riskNotes: ['可能增加学生压力'],
            criticalRisk: true,
          },
        ],
        runtimeSelectionPassed: true,
      },
      failedSamples: [
        {
          sampleIndex: 1,
          answer: '请学生继续观察并汇报。',
          unmetRequirements: ['不能让学生监控同学'],
          riskNotes: ['可能增加学生压力'],
          criticalRisk: true,
        },
      ],
    });

    expect(prompt.systemPrompt).toContain(
      'three-sample draft preview that found improvement opportunities',
    );
    expect(prompt.systemPrompt).toContain(
      'patch.proposedContent must contain only the target section body',
    );
    expect(prompt.systemPrompt).toContain(
      'Resolve every repeated unmet requirement',
    );
    expect(prompt.userPrompt).toContain('两个样本仍把责任交给学生');
    expect(prompt.userPrompt).toContain('请学生继续观察并汇报');
    expect(prompt.userPrompt).toContain('明确不能让学生承担监控职责');
  });

  it('builds an alternative from confirmed requirements without current draft data', () => {
    const prompt = buildAnswerSkillAlternativeRegenerationPrompt({
      question: '班主任当天应该怎么处理？',
      enhancedAnswer: '先了解情况。',
      initialFeedback: '请给出按顺序的处理步骤。',
      confirmedRefinementFeedback: ['增加教师可以直接使用的话术。'],
      diagnosis: {
        summary: '原回答缺少稳定的执行步骤。',
        reusability: 'reusable',
        riskNotes: [],
      },
      targetSkill: {
        skillId: 'skill-one',
        name: '事件处理',
        selectionSource: 'recorded',
      },
      baseSkill: {
        id: 'skill-one',
        dirName: 'skill-one',
        name: '事件处理',
        description: '用于处理学生事件。',
        skillMd: '## Workflow\n先了解情况。',
      },
      rubricMd: '## 评估\n- 安全',
    });

    expect(prompt.userPrompt).toContain('增加教师可以直接使用的话术');
    expect(prompt.userPrompt).toContain('baseSkill');
    expect(prompt.userPrompt).not.toContain('currentDraft');
    expect(prompt.userPrompt).not.toContain('currentPatch');
    expect(prompt.userPrompt).not.toContain('qualityEvidence');
    expect(prompt.systemPrompt).toContain(
      'do not reuse or imitate the wording of any previous draft',
    );
  });
});
