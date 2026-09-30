export interface AnswerSkillTestEvaluationInput {
  question: string;
  conversationContext: string;
  userFeedback: string;
  refinementFeedback: string[];
  diagnosis: {
    summary: string;
    reusability: 'reusable' | 'single_turn' | 'unclear';
    riskNotes: string[];
  };
  rubricMd: string;
  beforeAnswer: string;
  afterSamples: [string, string, string];
}

export interface AnswerSkillTestEvaluationSample {
  sampleIndex: number;
  passed: boolean;
  score: number;
  satisfiedRequirements: string[];
  unmetRequirements: string[];
  riskNotes: string[];
  criticalRisk: boolean;
}

export interface AnswerSkillTestEvaluationOutput {
  samples: [
    AnswerSkillTestEvaluationSample,
    AnswerSkillTestEvaluationSample,
    AnswerSkillTestEvaluationSample,
  ];
  bestSampleIndex: number;
  overallSummary: string;
}

export interface AnswerSkillTestEvaluationLocalizationPromptInput {
  output: AnswerSkillTestEvaluationOutput;
}

export class AnswerSkillTestEvaluationContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnswerSkillTestEvaluationContractError';
  }
}

const SYSTEM_PROMPT = [
  'You evaluate three independently generated answers for an EduSkill draft.',
  "Judge each sample against the user's initial reusable feedback, every successful later draft-refinement message, the diagnosis, the Package rubric, the original question, and any recorded conversation context.",
  'Compare against the before answer only to identify whether the requested reusable improvement is present.',
  'A sample passes only when it materially satisfies the feedback without introducing unsafe, fabricated, or misleading guidance.',
  'Set criticalRisk=true for any risk that must block publishing, including unsafe instructions, fabricated facts presented as known, or advice that could materially harm the user.',
  'Do not decide whether the user may save the draft. Return evidence only; the user makes the final product decision.',
  'Return strict JSON with exactly this shape, no additional keys, and no Markdown code fence:',
  'Keep JSON keys, sampleIndex, passed, score, criticalRisk, and bestSampleIndex unchanged.',
  'Write every user-facing natural-language string in satisfiedRequirements, unmetRequirements, riskNotes, and overallSummary in Simplified Chinese.',
  'Preserve the original question and answers as evidence; do not translate or rewrite them.',
  JSON.stringify({
    samples: [
      {
        sampleIndex: 0,
        passed: true,
        score: 85,
        satisfiedRequirements: ['已满足用户要求'],
        unmetRequirements: [],
        riskNotes: [],
        criticalRisk: false,
      },
      {
        sampleIndex: 1,
        passed: false,
        score: 60,
        satisfiedRequirements: [],
        unmetRequirements: ['仍未满足用户要求'],
        riskNotes: [],
        criticalRisk: false,
      },
      {
        sampleIndex: 2,
        passed: true,
        score: 80,
        satisfiedRequirements: ['已满足用户要求'],
        unmetRequirements: [],
        riskNotes: [],
        criticalRisk: false,
      },
    ],
    bestSampleIndex: 0,
    overallSummary: '三个样本中有两个稳定满足了用户提出的改进要求。',
  }),
  'samples must contain exactly three entries with unique sampleIndex values 0, 1, and 2.',
  'score must be an integer from 0 through 100.',
  'bestSampleIndex must identify one of the three samples.',
].join('\n');

export function buildAnswerSkillTestEvaluationPrompt(
  input: AnswerSkillTestEvaluationInput,
): {
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
} {
  return {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: JSON.stringify({
      question: input.question,
      conversationContext: input.conversationContext,
      userFeedback: input.userFeedback,
      refinementFeedback: input.refinementFeedback,
      diagnosis: input.diagnosis,
      rubricMd: input.rubricMd,
      beforeAnswer: input.beforeAnswer,
      afterSamples: input.afterSamples,
    }),
    temperature: 0,
  };
}

export function buildAnswerSkillTestEvaluationLocalizationPrompt(
  input: AnswerSkillTestEvaluationLocalizationPromptInput,
): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: [
      'You localize one already validated three-sample evaluation result.',
      'Return strict JSON with exactly the same object shape and no Markdown code fence.',
      'Translate only satisfiedRequirements, unmetRequirements, riskNotes, and overallSummary into Simplified Chinese.',
      'Do not add, remove, or reorder samples or any string-array item.',
      'Do not change sampleIndex, passed, score, criticalRisk, or bestSampleIndex.',
      'Keep JSON keys unchanged and do not add any field.',
      'Do not translate answer samples because they are not part of this localization payload.',
    ].join('\n'),
    userPrompt: JSON.stringify({
      task: 'Localize only the permitted user-facing strings.',
      output: input.output,
    }),
  };
}

function asObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AnswerSkillTestEvaluationContractError(
      `${field} must be an object`,
    );
  }
  return value as Record<string, unknown>;
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  field: string,
): void {
  const allowed = new Set(keys);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new AnswerSkillTestEvaluationContractError(
      `${field} contains unexpected fields: ${unexpected.join(', ')}`,
    );
  }
}

function asString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new AnswerSkillTestEvaluationContractError(
      `${field} must be a string`,
    );
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new AnswerSkillTestEvaluationContractError(
      `${field} must contain 1-${maxLength} characters`,
    );
  }
  return normalized;
}

function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > 12) {
    throw new AnswerSkillTestEvaluationContractError(
      `${field} must be an array with at most 12 items`,
    );
  }
  return value.map((item, index) => asString(item, `${field}[${index}]`, 500));
}

function parseSample(
  value: unknown,
  index: number,
): AnswerSkillTestEvaluationSample {
  const field = `samples[${index}]`;
  const object = asObject(value, field);
  assertOnlyKeys(
    object,
    [
      'sampleIndex',
      'passed',
      'score',
      'satisfiedRequirements',
      'unmetRequirements',
      'riskNotes',
      'criticalRisk',
    ],
    field,
  );
  if (
    !Number.isInteger(object.sampleIndex) ||
    Number(object.sampleIndex) < 0 ||
    Number(object.sampleIndex) > 2
  ) {
    throw new AnswerSkillTestEvaluationContractError(
      `${field}.sampleIndex must be 0, 1, or 2`,
    );
  }
  if (
    !Number.isInteger(object.score) ||
    Number(object.score) < 0 ||
    Number(object.score) > 100
  ) {
    throw new AnswerSkillTestEvaluationContractError(
      `${field}.score must be an integer from 0 through 100`,
    );
  }
  if (typeof object.passed !== 'boolean') {
    throw new AnswerSkillTestEvaluationContractError(
      `${field}.passed must be boolean`,
    );
  }
  if (typeof object.criticalRisk !== 'boolean') {
    throw new AnswerSkillTestEvaluationContractError(
      `${field}.criticalRisk must be boolean`,
    );
  }
  return {
    sampleIndex: Number(object.sampleIndex),
    passed: object.passed,
    score: Number(object.score),
    satisfiedRequirements: asStringArray(
      object.satisfiedRequirements,
      `${field}.satisfiedRequirements`,
    ),
    unmetRequirements: asStringArray(
      object.unmetRequirements,
      `${field}.unmetRequirements`,
    ),
    riskNotes: asStringArray(object.riskNotes, `${field}.riskNotes`),
    criticalRisk: object.criticalRisk,
  };
}

export function parseAnswerSkillTestEvaluationOutput(
  value: unknown,
): AnswerSkillTestEvaluationOutput {
  const object = asObject(value, 'evaluation');
  assertOnlyKeys(
    object,
    ['samples', 'bestSampleIndex', 'overallSummary'],
    'evaluation',
  );
  if (!Array.isArray(object.samples) || object.samples.length !== 3) {
    throw new AnswerSkillTestEvaluationContractError(
      'evaluation.samples must contain exactly three items',
    );
  }
  const samples = object.samples
    .map(parseSample)
    .sort((left, right) => left.sampleIndex - right.sampleIndex);
  const sampleIndexes = samples.map((sample) => sample.sampleIndex).sort();
  if (sampleIndexes.join(',') !== '0,1,2') {
    throw new AnswerSkillTestEvaluationContractError(
      'evaluation.samples must use unique indexes 0, 1, and 2',
    );
  }
  if (
    !Number.isInteger(object.bestSampleIndex) ||
    Number(object.bestSampleIndex) < 0 ||
    Number(object.bestSampleIndex) > 2
  ) {
    throw new AnswerSkillTestEvaluationContractError(
      'evaluation.bestSampleIndex must be 0, 1, or 2',
    );
  }
  return {
    samples: samples as AnswerSkillTestEvaluationOutput['samples'],
    bestSampleIndex: Number(object.bestSampleIndex),
    overallSummary: asString(
      object.overallSummary,
      'evaluation.overallSummary',
      3000,
    ),
  };
}
