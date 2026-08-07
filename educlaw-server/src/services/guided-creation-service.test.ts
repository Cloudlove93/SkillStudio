import { describe, expect, it } from 'vitest';
import {
  buildGuidedAssistantTurnV3,
  buildGuidedEducationGenerationInstruction,
  buildGuidedGenerationInstruction,
  buildGuidedAssistantTurn,
  buildGuidedAssistantTurnV2,
  parseExtractionResult,
  parseEducationExtractionResult,
} from './guided-creation-service.js';

describe('guided creation conversation service', () => {
  it('parses bounded seven-dimension extraction without trusting invented quotes', () => {
    const result = parseEducationExtractionResult({
      operations: [{
        dimension: 'educational_goal',
        content: '学生能解释物体浮沉',
        source: 'user_explicit',
        quote: '解释物体浮沉',
      }],
      step_complete: true,
      acknowledgement: '我理解你关注的是学生能否解释现象。',
    });

    expect(result.operations[0]?.dimension).toBe('educational_goal');
    expect(result.step_complete).toBe(true);
    expect(() => parseEducationExtractionResult({
      operations: [{ dimension: 'role', content: '教师', source: 'user_explicit' }],
      acknowledgement: '好的。',
    })).toThrowError('INVALID_EDUCATION_EXTRACTION');
  });

  it('starts v3 at educational intent even when the first message already contains several facts', () => {
    const turn = buildGuidedAssistantTurnV3({
      current_draft: {},
      completed_steps: [],
      current_step: null,
      user_message: '我想给初二学生做一个浮力实验指导 Skill',
      extraction: {
        operations: [
          {
            dimension: 'educational_goal',
            content: '指导学生完成浮力实验',
            source: 'user_explicit',
            quote: '浮力实验指导',
          },
          {
            dimension: 'audience_context',
            content: '面向初二学生',
            source: 'user_explicit',
            quote: '初二学生',
          },
        ],
        step_complete: true,
        acknowledgement: '我理解你要设计初二浮力实验指导。',
      },
      phrasing: null,
    });

    expect(turn.completed_steps).toEqual([]);
    expect(turn.current_step).toBe('intent_context');
    expect(turn.status).toBe('collecting');
    expect(turn.content.match(/[？?]/g)).toHaveLength(1);
  });

  it('uses confirmation options when step dimensions already have content', () => {
    const turn = buildGuidedAssistantTurnV3({
      current_draft: {},
      completed_steps: [],
      current_step: null,
      user_message: '我想给初二学生做一个浮力实验指导 Skill',
      extraction: {
        operations: [
          {
            dimension: 'educational_goal',
            content: '指导学生完成浮力实验',
            source: 'user_explicit',
            quote: '浮力实验指导',
          },
          {
            dimension: 'audience_context',
            content: '面向初二学生',
            source: 'user_explicit',
            quote: '初二学生',
          },
        ],
        step_complete: true,
        acknowledgement: '我理解你要设计初二浮力实验指导。',
      },
      phrasing: null,
    });

    // 两个维度都有内容 → 走确认句 → 选项应为确认类（而非引导类）
    expect(turn.suggested_options).toContain('准确，继续');
    expect(turn.suggested_options).not.toContain('理解关键概念');
  });

  it('moves from role and context to teacher experience instead of ending', () => {
    const turn = buildGuidedAssistantTurnV3({
      current_draft: {
        educational_goal: {
          content: '让学生理解浮力与排开液体的关系',
          evidence: [{ source: 'user_explicit', quote: '理解浮力' }],
        },
      },
      completed_steps: [],
      current_step: 'intent_context',
      user_message: '给初二学生分组实验使用，我是引导探究的实验老师',
      extraction: {
        operations: [{
          dimension: 'audience_context',
          content: '初二学生分组实验，由教师引导探究',
          source: 'user_explicit',
          quote: '初二学生分组实验',
        }],
        step_complete: true,
        acknowledgement: '使用对象和课堂情境已经明确。',
      },
      phrasing: null,
    });

    expect(turn.completed_steps).toEqual(['intent_context']);
    expect(turn.current_step).toBe('teacher_experience');
    expect(turn.content).toContain('实际教学时');
    expect(turn.status).toBe('collecting');
  });

  it('only confirms after the final user-owned educational evidence is collected', () => {
    const turn = buildGuidedAssistantTurnV3({
      current_draft: {
        educational_goal: { content: '学生能解释浮沉', evidence: [{ source: 'user_explicit', quote: '解释浮沉' }] },
        audience_context: { content: '初二分组实验', evidence: [{ source: 'user_explicit', quote: '初二' }] },
        input_evidence: { content: '教材、器材与实验记录', evidence: [{ source: 'user_adopted', quote: '可以' }] },
        teaching_strategy: { content: '先预测再用数据论证', evidence: [{ source: 'user_explicit', quote: '先预测' }] },
        action_adaptation: { content: '混淆概念时使用对照实验', evidence: [{ source: 'user_explicit', quote: '对照实验' }] },
        boundaries_responsibility: { content: '安全和结论由教师确认', evidence: [{ source: 'user_adopted', quote: '教师确认' }] },
      },
      completed_steps: ['intent_context', 'teacher_experience', 'strategy_co_creation', 'action_adjustment'],
      current_step: 'evidence_review',
      user_message: '完成时学生要能用实验数据解释两种浮沉现象',
      extraction: {
        operations: [{
          dimension: 'completion_evidence',
          content: '学生能用实验数据解释两种浮沉现象',
          source: 'user_explicit',
          quote: '用实验数据解释两种浮沉现象',
        }],
        step_complete: true,
        acknowledgement: '完成标准已经明确。',
      },
      phrasing: null,
    });

    expect(turn.status).toBe('ready_for_confirmation');
    expect(turn.completed_steps).toHaveLength(5);
    expect(turn.confirmation?.sections).toHaveLength(7);
  });

  it('keeps materials and teacher responsibility open until the teacher confirms them', () => {
    const turn = buildGuidedAssistantTurnV3({
      current_draft: {
        educational_goal: { content: '学生能解释浮沉', evidence: [{ source: 'user_explicit', quote: '解释浮沉' }] },
        audience_context: { content: '初二实验课', evidence: [{ source: 'user_explicit', quote: '初二' }] },
        teaching_strategy: { content: '先预测再实验', evidence: [{ source: 'user_explicit', quote: '先预测' }] },
        action_adaptation: { content: '错误时增加对照', evidence: [{ source: 'user_explicit', quote: '增加对照' }] },
      },
      completed_steps: ['intent_context', 'teacher_experience', 'strategy_co_creation', 'action_adjustment'],
      current_step: 'evidence_review',
      user_message: '学生能依据记录的数据解释浮沉，就算达到了效果',
      extraction: {
        operations: [{
          dimension: 'completion_evidence',
          content: '学生能依据记录的数据解释浮沉',
          source: 'user_explicit',
          quote: '依据记录的数据解释浮沉',
        }],
        step_complete: true,
        acknowledgement: '效果证据已经明确。',
      },
      phrasing: null,
    });

    expect(turn.status).toBe('collecting');
    expect(turn.current_step).toBe('teacher_experience');
    expect(turn.education_draft?.input_evidence).toBeUndefined();
    expect(turn.education_draft?.boundaries_responsibility).toBeUndefined();
  });

  it('uses a deterministic stage confirmation when the current stage is already described', () => {
    const turn = buildGuidedAssistantTurnV3({
      current_draft: {
        input_evidence: {
          content: '教材、实验器材和学生观察记录',
          evidence: [{ source: 'user_explicit', quote: '实验器材' }],
        },
        teaching_strategy: {
          content: '先预测，再实验验证',
          evidence: [{ source: 'user_explicit', quote: '先预测' }],
        },
        action_adaptation: {
          content: '根据学生的控制变量情况调整支架',
          evidence: [{ source: 'user_explicit', quote: '调整支架' }],
        },
      },
      completed_steps: ['intent_context'],
      current_step: 'teacher_experience',
      user_message: '我还想补充其他细节',
      extraction: {
        operations: [],
        step_complete: false,
        acknowledgement: '已记录',
        question: 'MODEL_WRONG_QUESTION？',
        suggested_options: ['方向一', '方向二'],
      },
      phrasing: {
        step: 'teacher_experience',
        question: 'MODEL_WRONG_QUESTION？',
        suggested_options: ['方向一', '方向二'],
      },
    });

    expect(turn.content).not.toContain('MODEL_WRONG_QUESTION');
  });

  it('turns the seven dimensions into executable Skill rules without internal evidence metadata', () => {
    const instruction = buildGuidedEducationGenerationInstruction({
      educational_goal: { content: '学生能解释浮沉', evidence: [{ source: 'user_explicit' }] },
      audience_context: { content: '初二实验课', evidence: [{ source: 'user_explicit' }] },
      input_evidence: { content: '教材与实验记录', evidence: [{ source: 'user_adopted' }] },
      teaching_strategy: { content: '预测、实验、论证', evidence: [{ source: 'user_explicit' }] },
      action_adaptation: { content: '观察控制变量，错误时增加对照', evidence: [{ source: 'user_explicit' }] },
      boundaries_responsibility: { content: '安全由教师确认', evidence: [{ source: 'user_adopted' }] },
      completion_evidence: { content: '能用数据解释', evidence: [{ source: 'user_explicit' }] },
    });

    expect(instruction).toContain('观察与调整规则');
    expect(instruction).toContain('教师确认节点');
    expect(instruction).not.toContain('user_explicit');
    expect(instruction).not.toContain('experience_id');
  });

  it('turns the confirmed draft into a one-Skill generation instruction', () => {
    const instruction = buildGuidedGenerationInstruction({
      roles: '教师助手',
      goal: '生成课堂反馈',
      usage_scenario: '课后复盘',
      input_contract: '课堂记录和教学目标',
      output_contract: '结构化反馈',
      core_capabilities: '分析课堂表现并给出建议',
      workflow: '分析、生成、自检',
      knowledge_evidence: '用户材料',
      boundaries_permissions: '不编造课堂事实',
      exception_recovery: '信息不足时追问',
      completion_evidence: '反馈可直接使用',
    });

    expect(instruction).toContain('只生成 1 个 Skill');
    expect(instruction).toContain('生成课堂反馈');
    expect(instruction).toContain('不编造课堂事实');
    expect(instruction).not.toContain('创建多个 Skill');
  });

  it('accepts only bounded draft operations from model output', () => {
    const result = parseExtractionResult({
      operations: [
        {
          op: 'set',
          path: 'goal',
          value: '帮助教师生成课堂反馈',
          state: 'explicit',
        },
      ],
      acknowledgement: '明白了。',
    });

    expect(result.operations).toHaveLength(1);
    expect(result.acknowledgement).toBe('明白了。');
    expect(() =>
      parseExtractionResult({
        operations: [{ op: 'set', path: 'private_data', value: 'x' }],
        acknowledgement: 'ok',
      }),
    ).toThrowError('INVALID_MODEL_EXTRACTION');
  });

  it('asks one deterministic blocking question after applying extraction', () => {
    const turn = buildGuidedAssistantTurn({
      current_draft: {},
      current_field_states: {},
      extraction: {
        operations: [
          {
            op: 'set',
            path: 'roles',
            value: '面向教师的备课助手',
            state: 'explicit',
          },
        ],
        acknowledgement: '明白，这是给教师使用的备课助手。',
      },
      phrasing: {
        question: '这个 Skill 最需要帮助教师完成什么目标？',
        suggested_options: ['生成教案', '设计课堂活动', '检查教学目标'],
      },
    });

    expect(turn.next_blocking_field).toBe('goal');
    expect(turn.content.match(/[？?]/g)).toHaveLength(1);
    expect(turn.suggested_options).toHaveLength(3);
    expect(turn.status).toBe('collecting');
  });

  it('ignores a model question for the wrong field and uses a safe fallback', () => {
    const turn = buildGuidedAssistantTurn({
      current_draft: { roles: '教师助手' },
      current_field_states: { roles: 'explicit' },
      extraction: { operations: [], acknowledgement: '好的。' },
      phrasing: {
        field: 'output_contract',
        question: '最后想输出什么？还需要别的吗？',
        suggested_options: ['教案'],
      },
    });

    expect(turn.next_blocking_field).toBe('goal');
    expect(turn.content).toContain('最希望这个 Skill 帮你完成什么目标');
    expect(turn.content.match(/[？?]/g)).toHaveLength(1);
  });

  it('returns a confirmation card when all required fields are ready', () => {
    const turn = buildGuidedAssistantTurn({
      current_draft: {
        roles: '教师助手',
        goal: '生成课堂反馈',
        usage_scenario: '课后复盘',
        input_contract: '课堂记录和教学目标',
        output_contract: '结构化反馈',
        core_capabilities: '分析课堂表现并给出建议',
        workflow: '分析记录、对照目标、生成反馈、自检',
      },
      current_field_states: {},
      extraction: { operations: [], acknowledgement: '信息已经完整。' },
      phrasing: null,
    });

    expect(turn.status).toBe('ready_for_confirmation');
    expect(turn.next_blocking_field).toBeNull();
    expect(turn.confirmation?.sections).toHaveLength(6);
    expect(turn.content).not.toMatch(/[？?]/);
  });

  it('preserves evidence and stage completion from bounded model output', () => {
    const result = parseExtractionResult({
      operations: [
        {
          op: 'set',
          path: 'roles',
          value: '实验设计助手',
          state: 'explicit',
          evidence: '帮我设计实验的助手',
        },
      ],
      stage_complete: true,
      acknowledgement: '已了解你的定位。',
    });

    expect(result.stage_complete).toBe(true);
    expect(result.operations[0]?.evidence).toBe('帮我设计实验的助手');
  });

  it('asks the positioning stage after the initial request without confirming it', () => {
    const turn = buildGuidedAssistantTurnV2({
      current_draft: {},
      current_field_states: {},
      confirmed_stages: [],
      current_stage: null,
      user_message: '我想做一个物理浮力实验指导的 Skill',
      extraction: {
        operations: [
          {
            op: 'set',
            path: 'goal',
            value: '指导物理浮力实验',
            state: 'explicit',
            evidence: '物理浮力实验指导',
          },
        ],
        stage_complete: true,
        acknowledgement: '我理解你想设计一个浮力实验指导 Skill。',
      },
      phrasing: {
        stage: 'positioning',
        question: '它主要面向哪个年级，并希望帮助教师还是学生？',
        suggested_options: ['初中物理教师', '初中学生'],
      },
    });

    expect(turn.status).toBe('collecting');
    expect(turn.confirmed_stages).toEqual([]);
    expect(turn.next_stage).toBe('positioning');
    expect(turn.focus_stage).toBe('positioning');
  });

  it('continues to scenario and input after the user confirms the role', () => {
    const turn = buildGuidedAssistantTurnV2({
      current_draft: { goal: '指导物理浮力实验' },
      current_field_states: { goal: 'explicit' },
      confirmed_stages: [],
      current_stage: 'positioning',
      user_message: '帮我设计实验的助手',
      extraction: {
        operations: [
          {
            op: 'set',
            path: 'roles',
            value: '实验设计助手',
            state: 'explicit',
            evidence: '帮我设计实验的助手',
          },
        ],
        stage_complete: true,
        acknowledgement: '已了解它主要承担实验设计工作。',
      },
      phrasing: {
        stage: 'scenario_input',
        question: '通常面向哪个年级，并在什么实验条件下使用？',
        suggested_options: ['八年级分组实验', '课堂演示实验'],
      },
    });

    expect(turn.status).toBe('collecting');
    expect(turn.confirmed_stages).toEqual(['positioning']);
    expect(turn.next_stage).toBe('scenario_input');
    expect(turn.focus_stage).toBe('scenario_input');
    expect(turn.confirmation).toBeNull();
  });

  it('advances when verified user evidence completes the stage even if the model flag is false', () => {
    const turn = buildGuidedAssistantTurnV2({
      current_draft: { goal: '整理完整的物理实验指导流程' },
      current_field_states: { goal: 'explicit' },
      confirmed_stages: [],
      current_stage: 'positioning',
      user_message: '由主讲教师使用',
      extraction: {
        operations: [
          {
            op: 'set',
            path: 'roles',
            value: '主讲教师',
            state: 'explicit',
            evidence: '主讲教师',
          },
        ],
        stage_complete: false,
        acknowledgement: '已记下由主讲教师使用。',
      },
      phrasing: {
        stage: 'scenario_input',
        field: 'usage_scenario',
        question: '这套流程主要用于哪种教学场景？',
        suggested_options: ['教师课堂演示', '学生分组探究'],
      },
    });

    expect(turn.confirmed_stages).toEqual(['positioning']);
    expect(turn.focus_stage).toBe('scenario_input');
    expect(turn.next_blocking_field).toBe('usage_scenario');
  });

  it('asks only for the missing field instead of repeating known stage details', () => {
    const turn = buildGuidedAssistantTurnV2({
      current_draft: { goal: '整理完整的物理实验指导流程' },
      current_field_states: { goal: 'explicit' },
      confirmed_stages: [],
      current_stage: 'positioning',
      user_message: '我想继续完善',
      extraction: {
        operations: [],
        stage_complete: false,
        acknowledgement: '目标已经清楚了。',
      },
      phrasing: {
        stage: 'positioning',
        field: 'roles',
        question: '这套流程主要由谁使用？还希望它完成什么目标？',
        suggested_options: ['主讲教师', '实验课教师'],
      },
    });

    expect(turn.next_blocking_field).toBe('roles');
    expect(turn.content).toContain('这套流程主要由谁使用？');
    expect(turn.content).not.toContain('还希望它完成什么目标');
    expect(turn.content.match(/[？?]/g)).toHaveLength(1);
  });

  it('confirms an already complete stage instead of asking for the same fields again', () => {
    const turn = buildGuidedAssistantTurnV2({
      current_draft: {
        roles: '主讲教师',
        goal: '整理完整的物理实验指导流程',
      },
      current_field_states: { roles: 'explicit', goal: 'explicit' },
      confirmed_stages: [],
      current_stage: null,
      user_message: '我想把完整的物理实验指导流程做成主讲教师使用的 Skill',
      extraction: {
        operations: [],
        stage_complete: false,
        acknowledgement: '我已经理解了这个 Skill 的定位。',
      },
      phrasing: null,
    });

    expect(turn.next_blocking_field).toBeNull();
    expect(turn.content).toContain('这个理解准确吗？');
    expect(turn.content).not.toContain('最希望它帮助完成什么事情');
    expect(turn.suggested_options).toContain('准确，继续');
  });

  it('accepts a clear local confirmation when the stage details are already explicit', () => {
    const turn = buildGuidedAssistantTurnV2({
      current_draft: {
        roles: '主讲教师',
        goal: '整理完整的物理实验指导流程',
      },
      current_field_states: { roles: 'explicit', goal: 'explicit' },
      confirmed_stages: [],
      current_stage: 'positioning',
      user_message: '没错，下一步吧',
      extraction: {
        operations: [],
        stage_complete: false,
        acknowledgement: '定位已经确认。',
      },
      phrasing: null,
    });

    expect(turn.confirmed_stages).toEqual(['positioning']);
    expect(turn.focus_stage).toBe('scenario_input');
  });

  it('does not advance a stage when the user leaves the decision to AI', () => {
    const turn = buildGuidedAssistantTurnV2({
      current_draft: { goal: '指导物理浮力实验' },
      current_field_states: { goal: 'explicit' },
      confirmed_stages: [],
      current_stage: 'positioning',
      user_message: '你决定就行',
      extraction: {
        operations: [],
        stage_complete: false,
        acknowledgement: '我可以先提供几个方向供你选择。',
      },
      phrasing: null,
    });

    expect(turn.confirmed_stages).toEqual([]);
    expect(turn.focus_stage).toBe('positioning');
    expect(turn.status).toBe('collecting');
  });

  it('keeps asking in the same stage until all stage details come from the user', () => {
    const turn = buildGuidedAssistantTurnV2({
      current_draft: {},
      current_field_states: {},
      confirmed_stages: ['positioning'],
      current_stage: 'scenario_input',
      user_message: '主要在八年级课堂分组实验时使用',
      extraction: {
        operations: [
          {
            op: 'set',
            path: 'usage_scenario',
            value: '八年级课堂分组实验',
            state: 'explicit',
            evidence: '八年级课堂分组实验',
          },
        ],
        stage_complete: true,
        acknowledgement: '使用场景已经清楚了。',
      },
      phrasing: {
        stage: 'scenario_input',
        question: '开始设计时，你通常会提供哪些实验器材、课堂条件或材料？',
        suggested_options: ['器材清单和班级情况', '教材实验要求'],
      },
    });

    expect(turn.confirmed_stages).toEqual(['positioning']);
    expect(turn.focus_stage).toBe('scenario_input');
    expect(turn.next_blocking_field).toBe('input_contract');
  });
});
