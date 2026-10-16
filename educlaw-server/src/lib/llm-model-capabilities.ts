/** Keep explicit thinking support limited to the models verified by EduSkill. */
export function supportsModelExplicitThinking(modelId: string): boolean {
  const normalized = modelId.toLowerCase();
  return normalized === "kimi-k2.5" || normalized === "kimi-k2.6";
}
