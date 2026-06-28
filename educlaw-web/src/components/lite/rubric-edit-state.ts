type ResolveRubricManualEditContentInput = {
  seedContent?: unknown;
  storedRubric?: string;
  displayRubric?: string;
  fallbackTemplate: string;
};

export function resolveRubricManualEditContent({
  seedContent,
  storedRubric,
  displayRubric,
  fallbackTemplate,
}: ResolveRubricManualEditContentInput): string {
  const candidates = [
    typeof seedContent === 'string' ? seedContent : '',
    storedRubric,
    displayRubric,
    fallbackTemplate,
  ];

  for (const candidate of candidates) {
    const trimmed = String(candidate || '').trim();
    if (trimmed) return trimmed;
  }

  return fallbackTemplate.trim();
}
