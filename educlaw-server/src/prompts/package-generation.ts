interface BaseMetadataPromptInput {
  hasInstruction: boolean;
  instruction: string;
  documentContext: string;
  outputSchemaPrompt: string;
}

interface AgentPromptInput {
  packageName: string;
  packageDescription: string;
  skillMetasJson: string;
  hasInstruction: boolean;
  sourceContext: string;
}

interface RubricPromptInput {
  packageName: string;
  packageDescription: string;
  agentExcerpt: string;
  sourceRubricExcerpt?: string;
  rubricDraft?: string;
}

interface SkillPromptInput {
  packageName: string;
  packageDescription: string;
  agentExcerpt: string;
  rubricExcerpt: string;
  documentContext: string;
  skillMetaJson: string;
  siblingSkillsJson: string;
  skillTemplatePrompt: string;
}

export function buildBaseMetadataSystemPrompt(): string {
  return [
    "You are an agent-package generation assistant.",
    "Return strict JSON only.",
    "Generate only compact metadata for one reusable prompt package.",
    "Prefer Chinese content when the user instruction is Chinese.",
    "When documents are provided without explicit instructions, deeply analyze the documents to extract domain knowledge, workflows, and rules, then build the agent and skills entirely from the document content.",
    "Do not generate agent.md, rubric.md, or full SKILL.md content in this step.",
    "Do not include long Markdown content in JSON fields.",
  ].join("\n");
}

export function buildBaseMetadataUserPrompt(input: BaseMetadataPromptInput): string {
  const intro = input.hasInstruction
    ? ["Create a prompt package from this instruction:", input.instruction]
    : [
        "Analyze the following documents and create a compact prompt package base based entirely on their content.",
        "Infer the agent's role, workflow, core skills, and evaluation criteria directly from the document content.",
      ];

  return [
    ...intro,
    input.documentContext,
    "",
    input.outputSchemaPrompt,
  ].filter(Boolean).join("\n");
}

export function buildAgentSystemPrompt(): string {
  return [
    "You are an expert agent.md author.",
    "Return plain Markdown only.",
    "Do not wrap the answer in Markdown fences.",
    "Prefer Chinese content when the source content is Chinese.",
  ].join("\n");
}

export function buildAgentUserPrompt(input: AgentPromptInput): string {
  return [
    "Create a complete but concise agent.md for this package.",
    "",
    `Package name: ${input.packageName}`,
    `Package description: ${input.packageDescription}`,
    "",
    "Core skills metadata:",
    input.skillMetasJson,
    "",
    input.hasInstruction ? "User instruction:" : "Source documents:",
    input.sourceContext,
    "",
    "The agent.md should define role, workflow, boundaries, and output style.",
    "Add a concise skill routing table. For each skill, describe:",
    "- typical user request that should use this skill",
    "- requests that should be routed to another skill",
    "- high-risk cases that require safety guidance or referral before continuing",
    "Keep each skill responsibility narrow; avoid assigning the same scenario to multiple skills.",
    "Return only the Markdown file content.",
  ].join("\n");
}

export function buildRubricSystemPrompt(): string {
  return [
    "You are an evaluation rubric author.",
    "Return plain Markdown only.",
    "Do not wrap the answer in Markdown fences.",
    "Prefer Chinese content when the source content is Chinese.",
  ].join("\n");
}

export function buildRubricUserPrompt(input: RubricPromptInput): string {
  const sourceRubricSection = input.sourceRubricExcerpt
    ? [
        "",
        "Uploaded documents already contain a rubric-related section. 优先复用这部分内容作为主依据，再在不改变原意的前提下补齐成更完整的 rubric.md。",
        "If the source rubric is already specific, preserve its dimensions, wording, and domain constraints instead of replacing them with generic dimensions.",
        "",
        "Source rubric excerpt:",
        input.sourceRubricExcerpt,
      ]
    : [];
  const rubricDraftSection = input.rubricDraft
    ? [
        "",
        "There is already an incomplete rubric draft. Keep every user-provided dimension, weight, example, and domain constraint that is still valid.",
        "Do not delete user-provided criteria just because the structure is incomplete. Reorganize and supplement it into a complete rubric.md that can be scored directly.",
        "When details are missing, add only the minimum necessary completion content so the rubric becomes usable.",
        "",
        "Existing rubric draft:",
        input.rubricDraft,
      ]
    : [];

  return [
    "Create a rubric.md for this package with 3-5 scoring dimensions.",
    "The rubric must include dimensions for document fidelity and safety/referral boundaries.",
    "Document fidelity should check whether outputs stay grounded in uploaded materials and avoid unsupported invention.",
    "Safety/referral boundaries should check whether high-risk cases such as severe harm, self-harm, medical/legal crisis, or imminent danger receive appropriate escalation guidance.",
    "Output a complete rubric.md with clear sections, while preserving uploaded rubric content whenever it already exists.",
    "If the uploaded rubric already uses a legacy but scorable structure such as 维度一/权重/5分到1分/关键检查点, preserve that structure and only补齐缺失部分 instead of rewriting it into a generic template.",
    "",
    `Package name: ${input.packageName}`,
    `Package description: ${input.packageDescription}`,
    "",
    "agent.md excerpt:",
    input.agentExcerpt,
    ...sourceRubricSection,
    ...rubricDraftSection,
    "",
    "Return only the Markdown file content.",
  ].join("\n");
}

export function buildSkillSystemPrompt(): string {
  return [
    "You are a concise SKILL.md author.",
    "Return plain Markdown only.",
    "Do not wrap the answer in Markdown fences.",
    "Prefer Chinese content when the source content is Chinese.",
    "Generate only the requested SKILL.md content; do not regenerate agent.md or rubric.md.",
  ].join("\n");
}

export function buildSkillUserPrompt(input: SkillPromptInput): string {
  return [
    "Create one compact SKILL.md for this package.",
    "",
    `Package name: ${input.packageName}`,
    `Package description: ${input.packageDescription}`,
    "",
    "agent.md excerpt:",
    input.agentExcerpt,
    "",
    "rubric.md excerpt:",
    input.rubricExcerpt,
    input.documentContext,
    "",
    "Skill metadata:",
    input.skillMetaJson,
    "",
    "Sibling skills metadata, used only for boundary clarity:",
    input.siblingSkillsJson,
    "",
    input.skillTemplatePrompt,
    "",
    "Keep this skill focused on its own trigger. If a request belongs to a sibling skill, say so in When not to use instead of covering that workflow here.",
  ].join("\n");
}
