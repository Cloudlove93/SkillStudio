import type { LessonIndexItem } from './lessons';
import type { StructuredSkillDraft } from '../components/skill-workspace/structured-skill-creation-state';
import { LESSON_PACK_COUNTS } from './lesson-pack-counts';

export type StudioPresetKind =
  | 'lesson-pack'
  | 'analysis-skill'
  | 'agent-template';
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
  语文: '按“文本解读—语言实践—朗读与表达—单元语文要素”的顺序分析，关注教师如何引导学生从文字走向理解与表达。',
  数学: '按“问题情境—探究活动—汇报交流—变式练习—思维可视化”的顺序分析，关注关键问题、错误资源与算理表达。',
  英语: '按“语境导入—听说输入—任务操练—输出表达—反馈评价”的顺序分析，关注语言支架、互动机会与目标语言使用。',
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

export const LESSON_PACK_PRESETS: StudioPreset[] = STAGE_GRADES.flatMap(
  ({ stage, grades }) =>
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
    keywords: [
      '清洗',
      '转写',
      'asr',
      '错字',
      '断句',
      '说话人',
      '校对',
      '文本整理',
    ],
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
    description:
      '把一节课还原为导入、探究、练习、总结等教学环节，并标出时间与证据。',
    tags: ['分析 Skill', '课例分段', '教学环节'],
    keywords: [
      '分段',
      '环节',
      '流程',
      '导入',
      '探究',
      '练习',
      '总结',
      '课堂结构',
      '时间',
    ],
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
    keywords: [
      '提问',
      '问题链',
      '追问',
      '问题',
      '候答',
      '等待时间',
      '回答',
      '理答',
    ],
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
    keywords: [
      '话语',
      '师生',
      '互动',
      '发言',
      '参与',
      '问答',
      '小组',
      '讨论',
      '理答',
      '沉默',
    ],
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
    keywords: [
      '目标',
      '课标',
      '对齐',
      '评价',
      '一致性',
      '核心素养',
      '重难点',
      '达成',
    ],
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
    keywords: [
      '对比',
      '比较',
      '同课异构',
      '差异',
      '两节课',
      '多个课例',
      '共同点',
      '迁移',
    ],
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
    keywords: [
      '检索',
      '找课',
      '匹配',
      '推荐课例',
      '哪节课',
      '课例包',
      '目录',
      '筛选',
    ],
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
  {
    id: 'analysis-unit-design',
    kind: 'analysis-skill',
    name: '单元整体教学设计',
    description:
      '把一个单元拆成目标、课时任务、学习支架与评价证据，形成可执行的单元教学方案。',
    tags: ['分析 Skill', '单元整体', '教学设计'],
    keywords: [
      '单元',
      '整体设计',
      '单元目标',
      '课时',
      '大概念',
      '学习支架',
      '单元规划',
      '教学评一致',
    ],
    prompt: [
      '创建一个「单元整体教学设计」Skill，用于单元层面的教学设计。',
      '输入：教材版本、年级、单元名称或单元目录、课程标准要求（可选）、课时数量。',
      '任务：提炼单元核心目标与学习主题；把单元拆成若干课时任务；为每个课时说明目标、活动、学习支架与评价证据；标出课时之间的递进关系。',
      '输出：单元目标、课时任务表、目标—活动—评价对照、单元学习支架、需要教师确认的教材信息。',
      '边界：不虚构教材单元目录或课标编号；没有单元信息时先请用户补充；课时建议要说明适用条件。',
    ].join('\n'),
    structured: {
      name: '单元整体教学设计',
      audience: '做单元整体教学的教师、备课组长与教研员',
      scenario: '单元规划、课时拆分与教学评一致性检查',
      task: '提炼单元目标，拆分课时任务，设计学习支架与评价证据。',
      input: '教材版本、年级、单元目录、课标要求（可选）、课时数量',
      output: '单元目标、课时任务表、目标—活动—评价对照、学习支架、待确认信息',
      boundaries: '不虚构教材目录与课标编号，缺少单元信息时先补充。',
    },
  },
  {
    id: 'analysis-learner-diagnosis',
    kind: 'analysis-skill',
    name: '学情分析与前测',
    description:
      '根据前测、作业或课堂表现，分析学生的已知、易错点与学习起点，给出教学起点建议。',
    tags: ['分析 Skill', '学情分析', '前测'],
    keywords: [
      '学情',
      '前测',
      '起点',
      '已知',
      '易错',
      '错误',
      '诊断',
      '学生基础',
      '预习',
    ],
    prompt: [
      '创建一个「学情分析与前测」Skill。',
      '输入：前测题、学生作答、作业样本、课堂观察记录或教师对学生基础的描述。',
      '任务：区分学生已掌握、半掌握和未掌握的知识与能力；归纳典型错误及其可能原因；判断学习起点与可能的学习障碍。',
      '输出：学情画像、典型错误清单、教学起点建议、需要补充的前测或观察证据。',
      '边界：不根据少量样本推断全体学生；不把一次回答等同于稳定能力；缺少数据时明确说明。',
    ].join('\n'),
    structured: {
      name: '学情分析与前测',
      audience: '需要确定教学起点的教师与备课组',
      scenario: '前测分析、作业诊断与教学起点判断',
      task: '归纳学生已知、易错点与学习障碍，给出教学起点建议。',
      input: '前测题、学生作答、作业样本、课堂观察记录',
      output: '学情画像、典型错误、教学起点建议、需补充的证据',
      boundaries: '不以少量样本推断全体，不把一次回答等同于稳定能力。',
    },
  },
  {
    id: 'analysis-homework-assessment',
    kind: 'analysis-skill',
    name: '作业与评价设计',
    description:
      '围绕课时目标设计分层作业、评价任务与评分标准，检查作业与目标的一致性。',
    tags: ['分析 Skill', '作业设计', '评价'],
    keywords: [
      '作业',
      '评价',
      '分层',
      '评分',
      '检测',
      '练习',
      '反馈',
      '教学评一致',
    ],
    prompt: [
      '创建一个「作业与评价设计」Skill。',
      '输入：课时目标、教材内容、学生基础、作业时长限制。',
      '任务：设计基础、提升、拓展三层作业；为每道题标注对应目标与难度；给出评价标准或评分要点；检查作业是否覆盖目标且不超负荷。',
      '输出：作业清单、目标—作业对照表、评分要点、预计时长、可选替代任务。',
      '边界：不虚构教材题目；不把机械重复当作分层；作业量要符合学段与时长限制。',
    ].join('\n'),
    structured: {
      name: '作业与评价设计',
      audience: '设计课时作业与评价任务的教师、备课组',
      scenario: '分层作业设计、评价任务与评分要点制定',
      task: '围绕目标设计分层作业与评价任务，检查覆盖度与负荷。',
      input: '课时目标、教材内容、学生基础、作业时长限制',
      output: '作业清单、目标—作业对照、评分要点、预计时长、替代任务',
      boundaries: '不虚构教材题目，不把机械重复当作分层。',
    },
  },
  {
    id: 'analysis-classroom-observation',
    kind: 'analysis-skill',
    name: '课堂观察与量表',
    description:
      '把课堂观察关注点转成可记录、可评分的观察量表，并给出记录与复盘方法。',
    tags: ['分析 Skill', '课堂观察', '量表'],
    keywords: [
      '课堂观察',
      '量表',
      '观察记录',
      '观察维度',
      '评分',
      '证据',
      '课堂诊断',
    ],
    prompt: [
      '创建一个「课堂观察与量表」Skill。',
      '输入：观察目的、学科年级、课堂关注点（提问、互动、目标达成、学生参与等）。',
      '任务：把关注点拆成可观察指标；为每个指标定义记录方式、证据类型和评分等级；生成可直接使用的观察量表。',
      '输出：观察维度表、指标与证据说明、评分等级、课堂记录模板、复盘问题。',
      '边界：量表只描述可观察行为，不评价教师人格；指标要能在一次课堂中记录；不虚构观察数据。',
    ].join('\n'),
    structured: {
      name: '课堂观察与量表',
      audience: '做课堂观察与教研诊断的教师、教研员',
      scenario: '观察量表设计、课堂记录与复盘',
      task: '把关注点拆成可观察指标，制定记录方式、证据与评分等级。',
      input: '观察目的、学科年级、课堂关注点',
      output: '观察维度表、指标与证据说明、评分等级、记录模板、复盘问题',
      boundaries: '只描述可观察行为，不评价教师人格，不虚构观察数据。',
    },
  },
  {
    id: 'analysis-interdisciplinary-design',
    kind: 'analysis-skill',
    name: '跨学科主题学习设计',
    description:
      '围绕真实问题设计跨学科主题任务，明确学科分工、课时安排与评价证据。',
    tags: ['分析 Skill', '跨学科', '主题学习'],
    keywords: [
      '跨学科',
      '主题学习',
      '项目化',
      '真实问题',
      '学科融合',
      '综合实践',
    ],
    prompt: [
      '创建一个「跨学科主题学习设计」Skill。',
      '输入：主题或真实问题、涉及学科与年级、可用课时、学校资源条件。',
      '任务：提炼跨学科核心问题；明确各学科的知识与能力贡献；设计任务链、课时安排、学习支架与成果形式；给出评价证据。',
      '输出：主题概述、学科分工、任务链、课时安排、成果与评价、实施条件与风险。',
      '边界：不为了跨学科而强行拼接学科；不虚构学校资源；涉及校外实践时说明安全与审批要求。',
    ].join('\n'),
    structured: {
      name: '跨学科主题学习设计',
      audience: '设计跨学科主题学习与项目化学习的教师团队',
      scenario: '真实问题驱动的跨学科主题课程设计',
      task: '提炼核心问题，明确学科分工，设计任务链、课时与评价。',
      input: '主题或真实问题、涉及学科与年级、可用课时、学校资源',
      output: '主题概述、学科分工、任务链、课时安排、成果与评价、实施风险',
      boundaries: '不强拼学科，不虚构学校资源，校外实践需说明安全与审批。',
    },
  },
  {
    id: 'analysis-test-blueprint',
    kind: 'analysis-skill',
    name: '命题与双向细目表',
    description:
      '依据教学目标与知识分布编制双向细目表，检查试题覆盖、难度与分值结构。',
    tags: ['分析 Skill', '命题', '双向细目表'],
    keywords: [
      '命题',
      '双向细目表',
      '试题',
      '难度',
      '分值',
      '覆盖率',
      '试卷分析',
    ],
    prompt: [
      '创建一个「命题与双向细目表」Skill。',
      '输入：考试范围、课时目标、教材内容、题型与总分要求、学生基础（可选）。',
      '任务：列出知识点与能力层级；编制双向细目表；分配题型、分值与难度；检查目标覆盖与重复；给出命题建议。',
      '输出：双向细目表、题型结构、难度分布、目标覆盖检查、需教师确认的教材范围。',
      '边界：不虚构教材知识点或课标编号；不直接生成整套试题除非用户提供范围；难度判断要说明依据。',
    ].join('\n'),
    structured: {
      name: '命题与双向细目表',
      audience: '需要命题、组卷与试卷分析的教师、教研员',
      scenario: '单元检测、期末命题与双向细目表编制',
      task: '编制知识点—能力层级双向细目表，检查覆盖、难度与分值结构。',
      input: '考试范围、课时目标、教材内容、题型与总分要求',
      output: '双向细目表、题型结构、难度分布、覆盖检查、待确认范围',
      boundaries: '不虚构教材知识点与课标编号，不直接生成整套试题。',
    },
  },
];

export const AGENT_TEMPLATE_PRESETS: StudioPreset[] = [
  {
    id: 'agent-lesson-analyst',
    kind: 'agent-template',
    name: '课例拆解师',
    description:
      '把一节课拆成目标、环节、问题链与评价证据，给出可执行的改进建议。',
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
    keywords: [
      '文本解读',
      '语文',
      '阅读',
      '单元要素',
      '语言实践',
      '朗读',
      '写作',
    ],
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
    description:
      '从师生话语比例、互动结构和参与机会分析课堂，提出增加学生话语的行动方案。',
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
  {
    id: 'agent-unit-designer',
    kind: 'agent-template',
    name: '单元整体教学设计师',
    description: '把单元目标拆成课时任务与评价证据，形成可执行的单元教学方案。',
    tags: ['Agent 模板', '单元整体', '教学设计'],
    keywords: [
      '单元',
      '整体设计',
      '单元设计',
      '课时',
      '大概念',
      '教学评一致',
      '单元规划',
    ],
    skillPresetIds: [
      'analysis-unit-design',
      'analysis-lesson-search',
      'analysis-lesson-segments',
      'analysis-goal-alignment',
      'analysis-research-report',
    ],
    prompt: [
      '创建一个「单元整体教学设计师」Agent，用于单元整体教学设计。',
      '它应协同使用单元整体教学设计、课例检索与匹配、课例分段与环节还原、教学目标对齐和教研报告生成能力。',
      '工作流程：确认教材单元与课标要求 → 检索可参考课例 → 提炼单元目标与课时任务 → 对照目标、活动与评价 → 输出单元方案与改进建议。',
      '不虚构教材目录、课标编号或课时安排；缺少单元信息时先请用户补充；引用课例时标注原文依据。',
    ].join('\n'),
    structured: {
      name: '单元整体教学设计师',
      audience: '备课组长、教研员与做单元整体教学的教师',
      scenario: '单元规划、课时拆分与教学评一致性设计',
      task: '提炼单元目标，拆分课时任务，结合课例证据设计学习支架与评价。',
      input: '教材版本、年级、单元目录、课标要求（可选）、课时数量',
      output: '单元目标、课时任务表、目标—活动—评价对照、课例参考、改进建议',
      boundaries: '不虚构教材目录与课标编号，缺少单元信息时先补充。',
    },
  },
  {
    id: 'agent-assessment-designer',
    kind: 'agent-template',
    name: '作业与评价设计师',
    description: '围绕课时或单元目标设计分层作业、评价任务与评分标准。',
    tags: ['Agent 模板', '作业设计', '评价'],
    keywords: ['作业', '评价', '分层', '评分', '命题', '双向细目表', '检测'],
    skillPresetIds: [
      'analysis-homework-assessment',
      'analysis-test-blueprint',
      'analysis-goal-alignment',
      'analysis-research-report',
    ],
    prompt: [
      '创建一个「作业与评价设计师」Agent，用于作业、评价与命题设计。',
      '它应协同使用作业与评价设计、命题与双向细目表、教学目标对齐和教研报告生成能力。',
      '工作流程：确认目标与考试范围 → 设计分层作业或双向细目表 → 检查目标覆盖与难度结构 → 输出作业/试卷方案与评分要点。',
      '不虚构教材题目与课标编号；作业量和难度要符合学段与时长限制；缺少范围信息时先追问。',
    ].join('\n'),
    structured: {
      name: '作业与评价设计师',
      audience: '设计作业、命题与评价任务的教师、备课组',
      scenario: '分层作业设计、单元检测命题与评分标准制定',
      task: '围绕目标设计作业与命题方案，检查覆盖、难度与负荷。',
      input: '课时或单元目标、教材内容、考试范围、作业时长限制',
      output: '作业清单、双向细目表、评分要点、难度分布、改进建议',
      boundaries: '不虚构教材题目与课标编号，作业量符合学段与时长限制。',
    },
  },
  {
    id: 'agent-learner-diagnostician',
    kind: 'agent-template',
    name: '学情诊断师',
    description:
      '从前后测、作业和课堂表现分析学生起点与易错点，给出教学起点建议。',
    tags: ['Agent 模板', '学情分析', '课堂诊断'],
    keywords: ['学情', '前测', '诊断', '易错', '学生基础', '课堂观察', '起点'],
    skillPresetIds: [
      'analysis-learner-diagnosis',
      'analysis-question-chain',
      'analysis-classroom-discourse',
      'analysis-classroom-observation',
      'analysis-research-report',
    ],
    prompt: [
      '创建一个「学情诊断师」Agent，用于学情分析与课堂诊断。',
      '它应协同使用学情分析与前测、提问链分析、师生话语分析、课堂观察与量表和教研报告生成能力。',
      '工作流程：收集前测/作业/课堂证据 → 归纳已知、易错与学习障碍 → 判断教学起点 → 设计观察或前测补充 → 输出诊断报告与教学建议。',
      '不根据少量样本推断全体学生；不把一次回答等同于稳定能力；缺少证据时明确说明并建议补充。',
    ].join('\n'),
    structured: {
      name: '学情诊断师',
      audience: '需要判断教学起点与易错点的教师、备课组',
      scenario: '前测分析、作业诊断与课堂观察复盘',
      task: '归纳学生已知、易错点与学习障碍，判断教学起点并设计补充证据。',
      input: '前测题、学生作答、作业样本、课堂观察记录',
      output: '学情画像、典型错误、教学起点建议、观察量表、诊断报告',
      boundaries: '不以少量样本推断全体，不把一次回答等同于稳定能力。',
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
    if (
      subject &&
      grade &&
      preset.subject === subject &&
      preset.grade === grade
    ) {
      return `匹配${preset.stage ?? ''}${grade}${subject}课例`;
    }
    if (subject && preset.subject === subject) {
      return `同科课例包，可按年级继续筛选`;
    }
    return `包含 ${preset.lessonCount ?? 40} 节可分析课例`;
  }
  if (preset.kind === 'analysis-skill') {
    return hits.length
      ? `匹配${hits.slice(0, 2).join('、')}`
      : '可复用的课堂分析方法';
  }
  return preset.skillPresetIds?.length
    ? `组合 ${preset.skillPresetIds.length} 个相关分析 Skill`
    : '可直接装配的教研 Agent';
}

export function recommendPresets(text: string, limit = 3): PresetMatch[] {
  const normalized = normalizeText(text);
  if (normalized.trim().length < 2) return [];
  const subject = detectSubject(normalized);
  const stage = detectStage(normalized);
  const grade = detectGrade(normalized);
  const materialHit =
    matchedKeywords(normalized, LESSON_PACK_KEYWORDS).length > 0;
  const analysisScores = new Map<string, number>();

  const scored = STUDIO_PRESETS.map((preset) => {
    let score = 0;
    let hits: string[] = [];
    if (preset.kind === 'lesson-pack') {
      if (subject && preset.subject === subject) score += 3;
      if (stage && preset.stage === stage) score += 2;
      if (stage && preset.stage !== stage) score -= 2;
      if (grade && preset.grade === grade) score += 3;
      if (
        subject &&
        grade &&
        preset.subject === subject &&
        preset.grade !== grade
      ) {
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
