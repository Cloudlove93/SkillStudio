import type {
  GuidedEducationDraft,
  StructuredGuidedInput,
} from '@educlaw/shared';

const FIELDS = [
  'name',
  'audience',
  'scenario',
  'task',
  'input',
  'output',
  'boundaries',
] as const;

export function parseStructuredGuidedInput(
  value: unknown,
): StructuredGuidedInput | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('INVALID_STRUCTURED_INPUT');
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(
      (key) => !FIELDS.includes(key as (typeof FIELDS)[number]),
    )
  )
    throw new Error('INVALID_STRUCTURED_INPUT');
  const result = {} as StructuredGuidedInput;
  for (const key of FIELDS) {
    if (
      typeof record[key] !== 'string' ||
      record[key].length > (key === 'name' ? 80 : 4000)
    )
      throw new Error('INVALID_STRUCTURED_INPUT');
    result[key] = record[key].trim();
  }
  if (
    !Object.values(result).some(Boolean) ||
    Object.values(result).join('').length > 12000
  )
    throw new Error('INVALID_STRUCTURED_INPUT');
  return result;
}

export function structuredInputToEducationDraft(
  fields?: StructuredGuidedInput,
): GuidedEducationDraft {
  if (!fields) return {};
  const draft: GuidedEducationDraft = {};
  const pairs = [
    ['educational_goal', fields.task],
    [
      'audience_context',
      [fields.audience, fields.scenario].filter(Boolean).join('；'),
    ],
    ['input_evidence', fields.input],
    ['completion_evidence', fields.output],
    ['boundaries_responsibility', fields.boundaries],
  ] as const;
  for (const [dimension, content] of pairs)
    if (content)
      draft[dimension] = {
        content,
        evidence: [{ source: 'user_explicit', quote: content }],
      };
  return draft;
}
