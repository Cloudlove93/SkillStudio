import type { LessonIndexItem } from './lessons';
import type { StructuredSkillDraft } from '../components/skill-workspace/structured-skill-creation-state';
import { LESSON_PACK_COUNTS } from './lesson-pack-counts';

export type StudioPresetKind = 'lesson-pack' | 'analysis-skill' | 'agent-template';
export type StudioSubject = '语文' | '数学' | '英语';
export type StudioStage = '小学' | '初中' | '高中';
export type StudioGrade =
  | '1年级'
  | '2年级'
  | '3年级'
  | '4年级'
  | '5年级'
  | '6年级'
  | '7年级'
  | '8年级'
  | '9年级'
  | '高1'
  | '高2'
  | '高3';

export interface StudioPreset {
  id: string;
  kind: StudioPresetKind;
  name: string;
  description: string;
  tags: string[];
  keywords: string[];
  prompt: string;
  subject?: StudioSubject;
  stage?: StudioStage;
  grade?: StudioGrade;
  lessonCount?: number;
  skillPresetIds?: string[];
  structured?: Partial<StructuredSkillDraft>;
}

export interface PresetMatch {
  preset: StudioPreset;
  score: number;
  reason: string;
}

const STAGE_GRADES: Array<{ stage: StudioStage; grades: StudioGrade[] }> = [
  { stage: '小学', grades: ['1年级', '2年级', '3年级', '4年级', '5年级'] },
  { stage: '初中', grades: ['6年级', '7年级', '8年级', '9年级'] },
  { stage: '高中', grades: ['高1', '高2', '高3'] },
];
const SUBJECTS: StudioSubject[] = ['语文', '数学', '英语'];

const SUBJECT_METHOD: Record<StudioSubject, string> = {
  语文:
    '按“文本解读—语言实践—朗读与表达—单元语文要素”的顺序分析，关注教师如何引导学生从文字走向理解与表达。',
  数学:
    '按“问题情境—探究活动—汇报交流—变式练习—思维可视化”的顺序分析，关注关键问题、错误资源与算理表达。',
  英语:
    '按“语境导入—听说输入—任务操练—输出表达—反馈评价”的顺序分析，关注语言支架、互动机会与目标语言使用。',
};

const LESSON_PACK_KEYWORDS = [
  '课例',
  '课堂',
  'asr',
  '转写',
  '实录',
  '教学片段',
  '小学',
  '备课',
  '教研',
];

function lessonPackCount(subject: StudioSubject, grade: StudioGrade) {
  return LESSON_PACK_COUNTS[`lesson-pack-${subject}-${grade}`] ?? 40;
}

function lessonPackPrompt(
  stage: StudioStage,
  subject: StudioSubject,
  grade: StudioGrade,
): string {
  const count = lessonPackCount(subject, grade);
  return [
    `使用平台预置的「${stage}${subject}${grade}课例包 Skill」创建一位${stage}${subject}教研 Agent。`,
    `这个课例包包含${stage}${grade}${subject} ${count} 节课堂 ASR 课例，课例覆盖不同单元与课型，文本为课堂转写、未人工校对。`,
    SUBJECT_METHOD[subject],
    '工作方式：',
    '1. 先确认用户要研究的是课例包中的哪一节课、想解决的教学问题，以及期望产出（提问链、教学环节、文本解读、课堂话语、目标对齐或教研报告）。',
    '2. 只依据用户选定的课例原文分析，引用关键原话作为证据；ASR 可能有错字、漏字和说话人混叠，不确定处明确标注“需回看原文”。',
    '3. 输出结构固定为：课例概览、关键片段与证据、分析结论、可执行改进建议、需要教师确认的事项。',
    '4. 不虚构课标编号、教材内容、学生表现或课堂中未出现的话语；不替代教师做价值判断。',
    `5. 当用户没有指定课节时，先展示课例包目录并请其选择，不要自行编造课例。`,
  ].join('\n');
}

function lessonPackStructured(
  stage: StudioStage,
  subject: StudioSubject,
  grade: StudioGrade,
): Partial<StructuredSkillDraft> {
  const count = lessonPackCount(subject, grade);
  return {
    name: `${stage}${subject}${grade}课例包 Skill`,
    audience: `${stage}${grade}${subject}教师、教研组长与备课组`,
    scenario: '基于课堂 ASR 课例开展备课、磨课、课堂诊断与教研分析',
    task: `围绕${stage}${grade}${subject} ${count} 节课例，帮助教师选择课例、定位关键片段、分析教学环节与师生话语，并形成可执行的改进建议。`,
    input: '课例包中的课节名称或课例 ID、课堂 ASR 转写文本、教师关注的问题',
    output:
      '课例概览、关键片段与原文证据、教学环节或提问链分析、改进建议、需回看原文的存疑点',
    boundaries:
      '只分析用户选定的课例原文；ASR 未校对，不把转写误差当作教师原话；不虚构课标、教材和学生表现；重要判断保留教师确认。',
  };
}

export const LESSON_PACK_PRESETS: StudioPreset[] = STAGE_GRADES.flatMap(({ stage, grades }) =>
  SUBJECTS.flatMap((subject) =>
    grades.map((grade) => {
      const count = lessonPackCount(subject, grade);
      return {
        id: `lesson-pack-${subject}-${grade}`,
        kind: 'lesson-pack' as const,
        name: `${stage}${subject}${grade}课例包`,
        description: `${stage}${grade}${subject} ${count} 节课堂 ASR 课例，按单元与课型整理，可直接用于备课、磨课与教研分析。`,
        tags: ['课例包', stage, subject, grade],
        keywords: [...LESSON_PACK_KEYWORDS, stage, subject, grade],
        prompt: lessonPackPrompt(stage, subject, grade),
        subject,
        stage,
        grade,
        lessonCount: count,
        structured: lessonPackStructured(stage, subject, grade),
      };
    }),
  ),
);

export const ANALYSIS_SKILL_PRESETS: StudioPreset[] = [
  {
    id: 'analysis-asr-cleanup',
    kind: 'analysis-skill',
    name: 'ASR 课例清洗',
    description: '修正课堂转写中的错字、断句和说话人混叠，保留原话与时间线索。',
    tags: ['分析 Skill', 'ASR', '清洗'],
    keywords: ['清洗', '转写', 'asr', '错字', '断句', '说话人', '校对', '文本整理'],
    prompt: [
      '创建一个「ASR 课例清洗」Skill，用于课堂 ASR 转写文本的教研前处理。',
      '输入：课堂 ASR 原始转写、课例名称、已知的学科与年级。',
      '任务：在不改变教师原意的前提下修正明显错字与断句；区分教师与学生发言；标记无法确认的片段；保留时间戳或原始顺序。',
      '输出：清洗后的课例文本、修改说明、仍需回看原文的存疑清单。',
      '边界：不补写课堂中未出现的内容，不把推测写成原话，不对教师教学水平做评价。',
    ].join('\n'),
    structured: {
      name: 'ASR 课例清洗',
      audience: '需要用课堂转写做教研的教师与教研员',
      scenario: '课例 ASR 转写后的教研前处理',
      task: '修正错字断句、区分师生发言、标记存疑片段，保留原始顺序。',
      input: '课堂 ASR 原始转写、课例名称、学科与年级',
      output: '清洗后的课例文本、修改说明、存疑清单',
      boundaries: '不补写未出现的内容，不把推测写成原话，不做教学水平评价。',
    },
  },
  {
    id: 'analysis-lesson-segments',
    kind: 'analysis-skill',
    name: '课例分段与环节还原',
    description: '把一节课还原为导入、探究、练习、总结等教学环节，并标出时间与证据。',
    tags: ['分析 Skill', '课例分段', '教学环节'],
    keywords: ['分段', '环节', '流程', '导入', '探究', '练习', '总结', '课堂结构', '时间'],
    prompt: [
      '创建一个「课例分段与环节还原」Skill。',
      '输入：一节课堂 ASR 课例文本，可附带教师说明的课时目标。',
      '任务：依据课堂话语与活动转换，把课例还原为若干教学环节；为每个环节标注起止依据、主要活动、教师动作、学生动作和预计时长。',
      '输出：环节总览表、逐环节证据摘录、环节衔接分析、与课时目标的对应关系。',
      '边界：分段必须有原文依据；无法判断时标记“存疑”，不为了整齐而虚构时间。',
    ].join('\n'),
    structured: {
      name: '课例分段与环节还原',
      audience: '做课例研究的教师、教研组长',
      scenario: '把课堂实录还原为可讨论的教学环节',
      task: '识别导入、探究、练习、总结等环节，标注证据、活动与时长。',
      input: '课堂 ASR 课例文本、课时目标（可选）',
      output: '环节总览表、证据摘录、衔接分析、目标对应关系',
      boundaries: '分段必须有原文依据，无法判断时标记存疑，不虚构时间。',
    },
  },
  {
    id: 'analysis-question-chain',
    kind: 'analysis-skill',
    name: '提问链分析',
    description: '提取教师提问，梳理问题链的逻辑层次、等待时间与学生回答质量。',
    tags: ['分析 Skill', '提问', '问题链'],
    keywords: ['提问', '问题链', '追问', '问题', '候答', '等待时间', '回答', '理答'],
    prompt: [
      '创建一个「提问链分析」Skill，用于课堂提问与理答研究。',
      '输入：课堂 ASR 课例文本、学科与年级、教师关注的问题。',
      '任务：提取教师提问并区分事实性、理解性、探究性与评价性问题；还原问题之间的递进关系；标注候答时间、学生回答类型和教师理答方式。',
      '输出：提问清单（含原文位置）、问题链结构图、低效提问与断链点、可替换的追问建议。',
      '边界：只分析文本中出现的提问；不把教师未说的话补进问题链；建议要说明适用条件。',
    ].join('\n'),
    structured: {
      name: '提问链分析',
      audience: '关注课堂提问与思维发展的教师',
      scenario: '课例复盘、磨课与提问改进',
      task: '提取提问、判断问题层次、还原问题链、分析候答与理答。',
      input: '课堂 ASR 课例文本、学科年级、关注问题',
      output: '提问清单、问题链结构、断链点、追问建议',
      boundaries: '只分析文本中出现的提问，不补写未出现的问题。',
    },
  },
  {
    id: 'analysis-classroom-discourse',
    kind: 'analysis-skill',
    name: '师生话语分析',
    description: '统计师生话语比例、互动结构与发言机会，识别课堂中的真实参与。',
    tags: ['分析 Skill', '课堂话语', '师生互动'],
    keywords: ['话语', '师生', '互动', '发言', '参与', '问答', '小组', '讨论', '理答', '沉默'],
    prompt: [
      '创建一个「师生话语分析」Skill。',
      '输入：课堂 ASR 课例文本、学科与年级。',
      '任务：区分教师讲授、教师提问、学生应答、学生主动发言、小组讨论等话语类型；估算话语比例；分析互动结构与发言机会分布。',
      '输出：话语类型统计、互动片段证据、参与不均衡的可能原因、增加学生话语的行动建议。',
      '边界：ASR 可能漏记学生发言，统计结果只作趋势参考；不根据一次课例推断学生能力或教师水平。',
    ].join('\n'),
    structured: {
      name: '师生话语分析',
      audience: '做课堂观察与教研分析的教师',
      scenario: '课堂互动诊断与参与度复盘',
      task: '区分话语类型、估算比例、分析互动结构与发言机会。',
      input: '课堂 ASR 课例文本、学科年级',
      output: '话语统计、互动证据、参与不均衡原因、改进行动',
      boundaries: 'ASR 可能漏记学生发言，统计只作趋势参考，不推断学生能力。',
    },
  },
  {
    id: 'analysis-goal-alignment',
    kind: 'analysis-skill',
    name: '教学目标对齐',
    description: '检查教学目标、课堂活动与评价证据是否指向同一核心目标。',
    tags: ['分析 Skill', '目标对齐', '课标'],
    keywords: ['目标', '课标', '对齐', '评价', '一致性', '核心素养', '重难点', '达成'],
    prompt: [
      '创建一个「教学目标对齐」Skill。',
      '输入：课时目标、课堂 ASR 课例文本、教材或单元信息（可选）。',
      '任务：把目标拆成可观察的学生表现；逐段判断课堂活动与评价证据是否支持目标达成；找出目标漂移、活动替代目标、评价缺失等问题。',
      '输出：目标—活动—评价对照表、达成证据、偏差说明、调整建议。',
      '边界：不虚构课程标准编号或教材内容；没有证据时写“未观察到”，不替教师判定目标正确与否。',
    ].join('\n'),
    structured: {
      name: '教学目标对齐',
      audience: '备课组与教研员',
      scenario: '课时目标与课堂实施的一致性检查',
      task: '拆解可观察目标，对照活动与评价证据，找出目标漂移与评价缺口。',
      input: '课时目标、课堂 ASR 课例文本、教材单元信息（可选）',
      output: '目标—活动—评价对照表、达成证据、偏差说明、调整建议',
      boundaries: '不虚构课标编号或教材内容，无证据时写“未观察到”。',
    },
  },
  {
    id: 'analysis-lesson-compare',
    kind: 'analysis-skill',
    name: '课例对比分析',
    description: '对比同课异构或跨课例的教学处理，提炼可迁移的做法与差异。',
    tags: ['分析 Skill', '课例对比', '同课异构'],
    keywords: ['对比', '比较', '同课异构', '差异', '两节课', '多个课例', '共同点', '迁移'],
    prompt: [
      '创建一个「课例对比分析」Skill。',
      '输入：两节或多节课例的 ASR 文本，说明对比目的（同课异构、不同课型或不同年级）。',
      '任务：对齐可比维度（目标、情境、问题链、活动、评价、学生话语）；逐项比较并引用证据；区分教学理念差异与课堂条件差异。',
      '输出：对比矩阵、关键差异、各自适用条件、可迁移做法与不可照搬之处。',
      '边界：不把差异简单判断为优劣；课例条件不同时明确说明可比性限制。',
    ].join('\n'),
    structured: {
      name: '课例对比分析',
      audience: '教研组与同课异构研究团队',
      scenario: '两节或多节课例的对比研讨',
      task: '按目标、情境、问题链、活动、评价、话语等维度对比并提炼可迁移做法。',
      input: '多节课例 ASR 文本、对比目的与维度',
      output: '对比矩阵、关键差异、适用条件、可迁移做法',
      boundaries: '不把差异简单判断为优劣，说明可比性限制。',
    },
  },
  {
    id: 'analysis-research-report',
    kind: 'analysis-skill',
    name: '教研报告生成',
    description: '把课例分析结果整理成结构清晰、证据充分的教研报告。',
    tags: ['分析 Skill', '教研报告', '总结'],
    keywords: ['报告', '教研', '总结', '汇报', '纪要', '结论', '建议', '成文'],
    prompt: [
      '创建一个「教研报告生成」Skill。',
      '输入：一节或多节课例的分析结果、研讨记录、教师关注的问题。',
      '任务：把分散的分析整理为教研报告，包含背景、课例概况、关键发现、证据摘录、问题归因、改进建议和后续跟进。',
      '输出：可直接用于教研活动的报告正文，重要结论均附课例证据或标注来源。',
      '边界：不编造数据与教师发言；区分“课堂中观察到的事实”与“分析者的推断”；建议要具体可执行。',
    ].join('\n'),
    structured: {
      name: '教研报告生成',
      audience: '教研员、教研组长与汇报教师',
      scenario: '课例研讨后的报告整理与汇报',
      task: '把课例分析结果整理为有证据、有结论、有建议的教研报告。',
      input: '课例分析结果、研讨记录、关注问题',
      output: '教研报告正文、证据摘录、问题归因、改进建议、后续跟进',
      boundaries: '不编造数据与发言，区分事实与推断。',
    },
  },
  {
    id: 'analysis-lesson-search',
    kind: 'analysis-skill',
    name: '课例检索与匹配',
    description: '根据学科、年级、课型或教学问题，从课例包中定位可用课例。',
    tags: ['分析 Skill', '课例检索', '匹配'],
    keywords: ['检索', '找课', '匹配', '推荐课例', '哪节课', '课例包', '目录', '筛选'],
    prompt: [
      '创建一个「课例检索与匹配」Skill。',
      '输入：学科、年级、教材单元、课型、想研究的教学问题，以及课例包目录。',
      '任务：按条件筛选候选课例；说明每节课与需求的匹配点和不匹配点；优先推荐能提供所需课堂证据的课例。',
      '输出：候选课例列表（含 ID、单元、课型、匹配理由）、推荐顺序、备选方案。',
      '边界：只从给定课例目录中推荐，不虚构课例；匹配理由要具体到课例信息。',
    ].join('\n'),
    structured: {
      name: '课例检索与匹配',
      audience: '需要快速找到研究课例的教师与教研员',
      scenario: '按学科、年级、课型或教学问题选课',
      task: '从课例包目录中筛选并排序候选课例，说明匹配与不匹配点。',
      input: '学科、年级、单元、课型、教学问题、课例包目录',
      output: '候选课例列表、匹配理由、推荐顺序、备选方案',
      boundaries: '只从给定目录推荐，不虚构课例。',
    },
  },
];

export const AGENT_TEMPLATE_PRESETS: StudioPreset[] = [
  {
    id: 'agent-lesson-analyst',
    kind: 'agent-template',
    name: '课例拆解师',
    description: '把一节课拆成目标、环节、问题链与评价证据，给出可执行的改进建议。',
    tags: ['Agent 模板', '课例拆解', '教研'],
    keywords: ['拆解', '课例分析', '环节', '目标', '评价', '磨课', '诊断'],
    skillPresetIds: [
      'analysis-lesson-segments',
      'analysis-question-chain',
      'analysis-goal-alignment',
      'analysis-research-report',
    ],
    prompt: [
      '创建一个「课例拆解师」Agent，用于小学课堂课例的结构化拆解。',
      '它应具备并协同使用以下能力：课例分段与环节还原、提问链分析、教学目标对齐、教研报告生成。',
      '工作流程：确认课例与关注问题 → 还原教学环节 → 分析问题链与目标对齐 → 汇总关键发现 → 生成改进建议与教研报告。',
      '所有结论必须引用课例原文；ASR 存疑处标注“需回看原文”；不虚构课标、教材与学生表现。',
    ].join('\n'),
    structured: {
      name: '课例拆解师',
      audience: '小学教师、备课组与教研员',
      scenario: '课例研磨、课堂诊断与教研活动',
      task: '拆解教学环节、提问链与目标对齐，形成证据充分的改进建议和教研报告。',
      input: '课例 ASR 文本、课时目标、关注问题',
      output: '环节还原、问题链分析、目标对齐表、改进建议、教研报告',
      boundaries: '结论必须引用原文，ASR 存疑处标注，不虚构课标与学情。',
    },
  },
  {
    id: 'agent-text-interpreter',
    kind: 'agent-template',
    name: '文本解读师',
    description: '面向语文课例，从文本、单元要素与课堂语言实践三个层面做解读。',
    tags: ['Agent 模板', '文本解读', '语文'],
    keywords: ['文本解读', '语文', '阅读', '单元要素', '语言实践', '朗读', '写作'],
    skillPresetIds: [
      'analysis-lesson-segments',
      'analysis-question-chain',
      'analysis-goal-alignment',
      'analysis-research-report',
    ],
    prompt: [
      '创建一个「文本解读师」Agent，用于小学语文课例的文本解读与课堂分析。',
      '它应协同使用课例分段、提问链分析、目标对齐和报告生成能力。',
      '工作流程：确认课文与单元语文要素 → 解读文本核心价值 → 还原课堂中的语言实践 → 分析教师如何以问题链支持理解与表达 → 输出解读报告与改进建议。',
      '不脱离课文原文和课堂实录发挥；区分文本本身的解读与教师课堂处理。',
    ].join('\n'),
    structured: {
      name: '文本解读师',
      audience: '小学语文教师与备课组',
      scenario: '阅读课文本解读、单元整体教学与课例研磨',
      task: '从文本价值、单元要素和课堂语言实践三个层面解读语文课例。',
      input: '课文、单元信息、课堂 ASR 课例文本',
      output: '文本解读、课堂语言实践分析、问题链分析、改进建议',
      boundaries: '不脱离课文与实录发挥，区分文本解读与教师处理。',
    },
  },
  {
    id: 'agent-thinking-analyst',
    kind: 'agent-template',
    name: '思维链分析师',
    description: '追踪课堂问题链与学生思维过程，定位断链点和思维支架缺口。',
    tags: ['Agent 模板', '思维链', '提问'],
    keywords: ['思维', '思维链', '问题链', '推理', '追问', '支架', '认知'],
    skillPresetIds: [
      'analysis-question-chain',
      'analysis-classroom-discourse',
      'analysis-lesson-segments',
      'analysis-research-report',
    ],
    prompt: [
      '创建一个「思维链分析师」Agent，用于分析课堂中的问题链与学生思维过程。',
      '它应协同使用提问链分析、师生话语分析、课例分段和报告生成能力。',
      '工作流程：提取关键问题 → 还原问题之间的逻辑递进 → 定位断链、跳跃与低效追问 → 分析学生回答中的思维证据 → 给出可替换的问题与支架建议。',
      '所有判断以课堂原话为依据；不把学生的一次回答等同于其稳定能力。',
    ].join('\n'),
    structured: {
      name: '思维链分析师',
      audience: '关注学生思维发展的教师与教研员',
      scenario: '问题链设计、课堂追问与思维支架改进',
      task: '还原问题链、定位断链点、分析学生思维证据并提出追问与支架建议。',
      input: '课堂 ASR 课例文本、学科年级、关注的问题',
      output: '问题链结构、断链点、学生思维证据、追问与支架建议',
      boundaries: '以课堂原话为依据，不把一次回答等同于稳定能力。',
    },
  },
  {
    id: 'agent-discourse-analyst',
    kind: 'agent-template',
    name: '课堂话语分析师',
    description: '从师生话语比例、互动结构和参与机会分析课堂，提出增加学生话语的行动方案。',
    tags: ['Agent 模板', '课堂话语', '互动'],
    keywords: ['话语', '互动', '发言', '参与', '课堂观察', '小组讨论', '问答'],
    skillPresetIds: [
      'analysis-classroom-discourse',
      'analysis-question-chain',
      'analysis-lesson-compare',
      'analysis-research-report',
    ],
    prompt: [
      '创建一个「课堂话语分析师」Agent，用于课堂师生话语与互动结构分析。',
      '它应协同使用师生话语分析、提问链分析、课例对比和报告生成能力。',
      '工作流程：区分话语类型 → 估算师生话语比例 → 还原互动结构 → 识别发言机会不均衡 → 对比不同片段或课例 → 输出行动建议。',
      'ASR 可能漏记学生发言，统计只作趋势参考；不根据一节课推断学生能力或教师水平。',
    ].join('\n'),
    structured: {
      name: '课堂话语分析师',
      audience: '做课堂观察与教研改进的教师',
      scenario: '课堂互动诊断、参与度分析与课例对比',
      task: '分析师生话语比例、互动结构与发言机会，提出增加学生话语的行动方案。',
      input: '课堂 ASR 课例文本、学科年级、观察关注点',
      output: '话语统计、互动结构、参与不均衡分析、行动建议',
      boundaries: 'ASR 可能漏记学生发言，统计只作趋势参考，不推断能力与水平。',
    },
  },
];

export const STUDIO_PRESETS: StudioPreset[] = [
  ...LESSON_PACK_PRESETS,
  ...ANALYSIS_SKILL_PRESETS,
  ...AGENT_TEMPLATE_PRESETS,
];

const KIND_ORDER: Record<StudioPresetKind, number> = {
  'lesson-pack': 0,
  'analysis-skill': 1,
  'agent-template': 2,
};

const CHINESE_GRADE: Record<string, StudioGrade> = {
  一: '1年级',
  二: '2年级',
  三: '3年级',
  四: '4年级',
  五: '5年级',
  六: '6年级',
  七: '7年级',
  八: '8年级',
  九: '9年级',
};

function normalizeText(text: string) {
  return text.toLocaleLowerCase().replace(/\s+/g, ' ');
}

function detectSubject(text: string): StudioSubject | null {
  return SUBJECTS.find((subject) => text.includes(subject)) ?? null;
}

function detectStage(text: string): StudioStage | null {
  if (/小学|小[一二三四五六]/u.test(text)) return '小学';
  if (/初中|初[一二三]|预备班|六三制/u.test(text)) return '初中';
  if (/高中|高[一二三1-3]/u.test(text)) return '高中';
  return null;
}

function detectGrade(text: string): StudioGrade | null {
  const highArabic = text.match(/高\s*([1-3])/);
  if (highArabic) return `高${highArabic[1]}` as StudioGrade;
  const highChinese = text.match(/高\s*([一二三])/);
  if (highChinese) {
    const map = { 一: '高1', 二: '高2', 三: '高3' } as const;
    return map[highChinese[1] as keyof typeof map];
  }
  const junior = text.match(/初\s*([一二三])/);
  if (junior) {
    const map = { 一: '7年级', 二: '8年级', 三: '9年级' } as const;
    return map[junior[1] as keyof typeof map];
  }
  const arabic = text.match(/([1-9])\s*年级/);
  if (arabic) return `${arabic[1]}年级` as StudioGrade;
  for (const [chinese, grade] of Object.entries(CHINESE_GRADE)) {
    if (text.includes(`${chinese}年级`) || text.includes(`小学${chinese}年`)) {
      return grade;
    }
  }
  return null;
}

function matchedKeywords(text: string, keywords: string[]) {
  return keywords.filter((keyword) =>
    text.includes(keyword.toLocaleLowerCase()),
  );
}

function presetReason(
  preset: StudioPreset,
  subject: StudioSubject | null,
  grade: StudioGrade | null,
  hits: string[],
): string {
  if (preset.kind === 'lesson-pack') {
    if (subject && grade && preset.subject === subject && preset.grade === grade) {
      return `匹配${preset.stage ?? ''}${grade}${subject}课例`;
    }
    if (subject && preset.subject === subject) {
      return `同科课例包，可按年级继续筛选`;
    }
    return `包含 ${preset.lessonCount ?? 40} 节可分析课例`;
  }
  if (preset.kind === 'analysis-skill') {
    return hits.length ? `匹配${hits.slice(0, 2).join('、')}` : '可复用的课堂分析方法';
  }
  return preset.skillPresetIds?.length
    ? `组合 ${preset.skillPresetIds.length} 个相关分析 Skill`
    : '可直接装配的教研 Agent';
}

export function recommendPresets(
  text: string,
  limit = 3,
): PresetMatch[] {
  const normalized = normalizeText(text);
  if (normalized.trim().length < 2) return [];
  const subject = detectSubject(normalized);
  const stage = detectStage(normalized);
  const grade = detectGrade(normalized);
  const materialHit = matchedKeywords(normalized, LESSON_PACK_KEYWORDS).length > 0;
  const analysisScores = new Map<string, number>();

  const scored = STUDIO_PRESETS.map((preset) => {
    let score = 0;
    let hits: string[] = [];
    if (preset.kind === 'lesson-pack') {
      if (subject && preset.subject === subject) score += 3;
      if (stage && preset.stage === stage) score += 2;
      if (stage && preset.stage !== stage) score -= 2;
      if (grade && preset.grade === grade) score += 3;
      if (subject && grade && preset.subject === subject && preset.grade !== grade) {
        score += 1;
      }
      if (materialHit) score += 2;
      if (!subject && !grade && materialHit) score += 1;
    } else if (preset.kind === 'analysis-skill') {
      hits = matchedKeywords(normalized, preset.keywords);
      score += hits.length * 2;
      analysisScores.set(preset.id, score);
    } else {
      hits = matchedKeywords(normalized, preset.keywords);
      score += hits.length * 1.5;
      const skillScore = (preset.skillPresetIds ?? []).reduce(
        (total, id) => total + (analysisScores.get(id) ?? 0),
        0,
      );
      if (skillScore > 0) score += Math.min(3, skillScore / 2);
    }
    return {
      preset,
      score,
      reason: presetReason(preset, subject, grade, hits),
    };
  });

  const sorted = scored
    .filter((match) => match.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        KIND_ORDER[a.preset.kind] - KIND_ORDER[b.preset.kind] ||
        a.preset.name.localeCompare(b.preset.name, 'zh-CN'),
    );
  // 只保留最匹配的一个课例包，避免同科其他年级占满推荐位。
  let packKept = false;
  return sorted
    .filter((match) => {
      if (match.preset.kind !== 'lesson-pack') return true;
      if (packKept) return false;
      packKept = true;
      return true;
    })
    .slice(0, limit);
}

export function presetToPrompt(preset: StudioPreset) {
  return preset.prompt.trim();
}

export function presetToStructuredDraft(
  preset: StudioPreset,
): StructuredSkillDraft {
  const structured = preset.structured ?? {};
  return {
    name: structured.name ?? preset.name,
    audience: structured.audience ?? '',
    scenario: structured.scenario ?? '',
    task: structured.task ?? preset.description,
    input: structured.input ?? '',
    output: structured.output ?? '',
    boundaries: structured.boundaries ?? '',
  };
}

export function findLessonPack(
  subject: string,
  grade: string,
): StudioPreset | null {
  return (
    LESSON_PACK_PRESETS.find(
      (preset) => preset.subject === subject && preset.grade === grade,
    ) ?? null
  );
}

export function buildLessonPackDocument(
  pack: StudioPreset,
  lessons: LessonIndexItem[],
) {
  const lines = [
    `# ${pack.name}`,
    '',
    pack.description,
    '',
    `课例数量：${lessons.length} 节`,
    `适用范围：${pack.stage ?? ''}${pack.grade ?? ''}${pack.subject ?? ''}`,
    '',
    '说明：以下课例来自课堂 ASR 转写，未人工校对；分析时请以原文为准，存疑处标注“需回看原文”。',
    '',
    '## 课例目录',
  ];
  lessons.forEach((lesson, index) => {
    lines.push(
      `${index + 1}. ${lesson.name}（${lesson.unit || '未标注单元'} · ${
        lesson.lessonType || '课例'
      } · ${lesson.charCount.toLocaleString('zh-CN')} 字 · ID: ${lesson.id}）`,
    );
  });
  lines.push(
    '',
    '## 使用方式',
    '1. 让教师先选一节课例，再把该课例 ASR 原文作为附件带入。',
    '2. 按课例概览、关键片段、分析结论、改进建议、待确认事项输出。',
    '3. 不虚构课标编号、教材内容或课堂中未出现的话语。',
  );
  return lines.join('\n');
}
