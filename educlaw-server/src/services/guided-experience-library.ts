import type {
  GuidedCreationStep,
  GuidedEducationDraft,
} from '@educlaw/shared';

export interface GuidedTeachingExperience {
  experience_id: string;
  scenario_tags: string[];
  focus_steps: GuidedCreationStep[];
  applicable_when: string;
  educational_intent: string;
  suggested_strategy: string;
  observation_signals: string[];
  adjustment_guidance: string;
  teacher_responsibility: string;
  effectiveness_evidence: string[];
  source: { title: string; url: string; published_at?: string };
  status: 'candidate';
}

const CURRICULUM_SOURCE = {
  title: '义务教育课程方案和课程标准（2022年版）情况介绍',
  url: 'https://www.moe.gov.cn/fbh/live/2022/54382/sfcl/202204/t20220421_620077.html',
  published_at: '2022-04-21',
};
const REFORM_SOURCE = {
  title: '基础教育课程教学改革深化行动方案',
  url: 'https://www.moe.gov.cn/srcsite/A26/jcj_kcjcgh/202306/t20230601_1062380.html',
  published_at: '2023-05-09',
};
const SCIENCE_SOURCE = {
  title: '中小学科学教育工作指南',
  url: 'https://www.moe.gov.cn/srcsite/A29/202501/t20250122_1176589.html',
  published_at: '2025-01-22',
};

export const GUIDED_TEACHING_EXPERIENCES: GuidedTeachingExperience[] = [
  {
    experience_id: 'lesson-goal-evidence-v1',
    scenario_tags: ['完整课时设计', '课时设计', '教案'],
    focus_steps: ['intent_context', 'evidence_review'],
    applicable_when: '需要把一节课从内容覆盖转向可观察的学生发展时',
    educational_intent: '使教学目标、学习活动和评价证据围绕同一核心素养表现组织',
    suggested_strategy: '先明确学生课后能做出的关键表现，再倒推活动与评价任务',
    observation_signals: ['学生能否解释关键概念', '学生能否在新情境中迁移使用'],
    adjustment_guidance: '若活动完成但目标表现未出现，缩减内容并增加针对关键表现的练习与反馈',
    teacher_responsibility: '教师确认目标符合课程标准、学情和课时条件',
    effectiveness_evidence: ['课堂作品与目标一致', '学生能用证据说明思路'],
    source: CURRICULUM_SOURCE,
    status: 'candidate',
  },
  {
    experience_id: 'lesson-prior-knowledge-v1',
    scenario_tags: ['完整课时设计', '课时设计', '教案'],
    focus_steps: ['teacher_experience', 'strategy_co_creation'],
    applicable_when: '新内容依赖既有知识，学生起点可能不一致时',
    educational_intent: '让教学从学生真实起点出发',
    suggested_strategy: '用一个短任务暴露已有理解和典型误区，再决定讲解与探究的起点',
    observation_signals: ['学生使用了什么既有方法', '错误是否来自前置概念缺口'],
    adjustment_guidance: '若多数学生前置知识不足，先补关键支点；若少数不足，提供局部支架',
    teacher_responsibility: '教师根据本班实际判断诊断结果，不由系统替代学情判断',
    effectiveness_evidence: ['后续任务中的同类错误减少', '学生能连接新旧知识'],
    source: REFORM_SOURCE,
    status: 'candidate',
  },
  {
    experience_id: 'lesson-inquiry-cycle-v1',
    scenario_tags: ['完整课时设计', '实验探究', '科学教育'],
    focus_steps: ['strategy_co_creation', 'action_adjustment'],
    applicable_when: '课程包含实验、探究或基于证据得出结论的任务时',
    educational_intent: '发展提出问题、设计探究、分析证据和形成解释的能力',
    suggested_strategy: '组织预测—设计—操作—记录—论证—反思的探究链，而非只复现结论',
    observation_signals: ['学生能否控制变量', '结论是否由记录的数据支持'],
    adjustment_guidance: '若学生只关注结果，要求回到数据和实验条件；若操作受阻，分层提供方法提示',
    teacher_responsibility: '教师确认实验安全、器材条件和结论的科学性',
    effectiveness_evidence: ['实验记录可核查', '学生能说明证据与结论的关系'],
    source: SCIENCE_SOURCE,
    status: 'candidate',
  },
  {
    experience_id: 'lesson-visible-thinking-v1',
    scenario_tags: ['完整课时设计', '课时设计', '课堂观察'],
    focus_steps: ['teacher_experience', 'action_adjustment'],
    applicable_when: '仅看答案难以判断学生是否真正理解时',
    educational_intent: '让学生的思考过程成为可观察、可反馈的学习证据',
    suggested_strategy: '要求学生解释依据、比较方法或展示关键步骤，并预设教师追问',
    observation_signals: ['学生是否能解释为什么', '方法改变后能否保持正确'],
    adjustment_guidance: '若答案正确但无法解释，增加对比和追问；若表达困难，提供句式或图示支架',
    teacher_responsibility: '教师结合口头、书面与实际操作综合判断',
    effectiveness_evidence: ['学生解释与作品相互印证', '反馈后能自主修正'],
    source: REFORM_SOURCE,
    status: 'candidate',
  },
  {
    experience_id: 'lesson-feedback-loop-v1',
    scenario_tags: ['完整课时设计', '课时设计', '课堂评价'],
    focus_steps: ['action_adjustment', 'evidence_review'],
    applicable_when: '需要在课内根据学习表现及时调整教学时',
    educational_intent: '发挥评价的诊断、改进和激励作用',
    suggested_strategy: '在关键节点设置快速检查，并为不同表现预先写明下一步教学动作',
    observation_signals: ['关键检查的错误分布', '反馈后学生是否能够独立改进'],
    adjustment_guidance: '根据共同错误重教关键概念，根据个别错误提供针对性提示或同伴支持',
    teacher_responsibility: '教师决定是否调整节奏、任务难度和课堂安排',
    effectiveness_evidence: ['检查结果驱动了明确调整', '调整后的表现有可见改善'],
    source: REFORM_SOURCE,
    status: 'candidate',
  },
  {
    experience_id: 'diff-common-goal-v1',
    scenario_tags: ['分层教学设计', '差异化教学', '因材施教'],
    focus_steps: ['intent_context', 'strategy_co_creation'],
    applicable_when: '学生起点不同，但仍需共同达成核心学习目标时',
    educational_intent: '在提供不同支持的同时保持共同的核心学习目标',
    suggested_strategy: '固定核心概念和成功标准，调整任务入口、支架程度和延伸深度',
    observation_signals: ['各组是否都在处理同一核心概念', '支持是否降低了核心要求'],
    adjustment_guidance: '若分层变成不同目标，重新对齐共同标准；若任务过难，先增加支架而非删除核心思考',
    teacher_responsibility: '教师确认分层不固化学生标签，不降低合理期待',
    effectiveness_evidence: ['各层学生都能展示核心目标', '不同材料之间标准一致'],
    source: CURRICULUM_SOURCE,
    status: 'candidate',
  },
  {
    experience_id: 'diff-diagnostic-entry-v1',
    scenario_tags: ['分层教学设计', '差异化教学', '因材施教'],
    focus_steps: ['teacher_experience', 'strategy_co_creation'],
    applicable_when: '尚不清楚学生差异来自知识、方法还是表达障碍时',
    educational_intent: '依据学习证据提供支持，而不是凭固定印象分组',
    suggested_strategy: '用低风险诊断任务识别需要的支持类型，并允许学生随表现变化调整路径',
    observation_signals: ['错误类型而非单一分数', '学生在不同支架下的变化'],
    adjustment_guidance: '发现诊断不足时补充观察，不根据一次表现长期固定层级',
    teacher_responsibility: '教师审核分组依据并保护学生尊严与选择权',
    effectiveness_evidence: ['支持与实际困难相匹配', '学生可根据进展调整路径'],
    source: REFORM_SOURCE,
    status: 'candidate',
  },
  {
    experience_id: 'diff-scaffold-fade-v1',
    scenario_tags: ['分层教学设计', '差异化教学', '学习支架'],
    focus_steps: ['strategy_co_creation', 'action_adjustment'],
    applicable_when: '部分学生需要提示才能进入任务时',
    educational_intent: '通过适量支架促进独立完成，而不是替学生完成',
    suggested_strategy: '按问题提示、过程提示、示例提示设置递进支架，并规定撤除条件',
    observation_signals: ['学生在哪一级提示后继续', '能否逐步减少帮助'],
    adjustment_guidance: '若提示直接泄露答案，改为过程性问题；若仍无法开始，检查前置知识',
    teacher_responsibility: '教师决定支架强度并避免形成依赖',
    effectiveness_evidence: ['支架减少后仍能完成同类任务', '学生能说明自己的方法'],
    source: CURRICULUM_SOURCE,
    status: 'candidate',
  },
  {
    experience_id: 'diff-multiple-expression-v1',
    scenario_tags: ['分层教学设计', '差异化教学', '多样化评价'],
    focus_steps: ['strategy_co_creation', 'evidence_review'],
    applicable_when: '单一书面表达可能遮蔽学生真实理解时',
    educational_intent: '允许学生用合适方式展示相同核心理解',
    suggested_strategy: '在不改变成功标准的前提下，提供口头、图示、操作或书面等表达路径',
    observation_signals: ['不同表达是否指向同一标准', '表达障碍是否与理解障碍分离'],
    adjustment_guidance: '若形式选择降低思考要求，收紧共同标准；若表达成为障碍，增加合适工具',
    teacher_responsibility: '教师确保评价公平并综合判断证据',
    effectiveness_evidence: ['多种作品都能对应共同标准', '学生能选择并解释表达方式'],
    source: SCIENCE_SOURCE,
    status: 'candidate',
  },
  {
    experience_id: 'diff-progress-adjust-v1',
    scenario_tags: ['分层教学设计', '差异化教学', '形成性评价'],
    focus_steps: ['action_adjustment', 'evidence_review'],
    applicable_when: '分层支持需要随学生进展动态变化时',
    educational_intent: '让支持依据形成性证据持续调整',
    suggested_strategy: '为每种支持设置进入、保持和退出信号，在关键节点重新判断',
    observation_signals: ['学生独立完成率和错误变化', '迁移任务中的稳定表现'],
    adjustment_guidance: '连续达到标准则减少支架；出现新障碍则切换支持类型而非简单降级',
    teacher_responsibility: '教师确认调整时机，避免系统自动给学生贴标签',
    effectiveness_evidence: ['支持随证据发生变化', '学生独立性逐步提升'],
    source: REFORM_SOURCE,
    status: 'candidate',
  },
];

export const GUIDED_SKILL_CONVERSION_RULES = [
  '把教育目标写成可观察的学生表现，而不是只写要生成什么材料。',
  '把教师经验转成条件—行动—观察—调整规则，避免只保留抽象原则。',
  '让教案、学习任务、支持材料和评价证据共享同一核心目标与成功标准。',
  '预先写明典型困难的表现、可能原因和下一步追问或支架。',
  '为关键步骤规定输入依据、输出格式和可检查的完成证据。',
  '在安全、专业判断和影响学生的重要节点保留教师确认。',
  '候选经验只能用于提出问题或建议，只有用户明确表达或采纳后才能写成 Skill 要求。',
] as const;

const LESSON_KEYWORDS = ['课时', '教案', '课堂', '教学', '实验', '学习单'];
const DIFFERENTIATION_KEYWORDS = ['分层', '差异', '因材施教', '不同水平', '支架'];

function draftText(draft: GuidedEducationDraft): string {
  return Object.values(draft)
    .map((section) => section?.content ?? '')
    .join(' ');
}

export function matchTeachingExperiences(input: {
  draft: GuidedEducationDraft;
  step: GuidedCreationStep;
}): GuidedTeachingExperience[] {
  const text = draftText(input.draft);
  const scenario = DIFFERENTIATION_KEYWORDS.some((keyword) => text.includes(keyword))
    ? '分层教学设计'
    : LESSON_KEYWORDS.some((keyword) => text.includes(keyword))
      ? '完整课时设计'
      : null;
  if (!scenario) return [];

  return GUIDED_TEACHING_EXPERIENCES
    .filter(
      (item) =>
        item.scenario_tags.includes(scenario) &&
        item.focus_steps.includes(input.step),
    )
    .slice(0, 2);
}
