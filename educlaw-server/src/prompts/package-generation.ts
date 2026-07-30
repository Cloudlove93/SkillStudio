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
  mode?: "repair" | "optimize";
}

interface RubricBoundaryReviewPromptInput {
  documentName: string;
  extractedRubric: string;
  leadingContext: string;
  trailingContext: string;
}

interface RubricLocatorPromptInput {
  documentName: string;
  windowStartLine: number;
  windowEndLine: number;
  numberedWindow: string;
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

export function buildBaseMetadataUserPrompt(
  input: BaseMetadataPromptInput,
): string {
  const intro = input.hasInstruction
    ? ["Create a prompt package from this instruction:", input.instruction]
    : [
        "Analyze the following documents and create a compact prompt package base based entirely on their content.",
        "Infer the agent's role, workflow, core skills, and evaluation criteria directly from the document content.",
      ];

  return [...intro, input.documentContext, "", input.outputSchemaPrompt]
    .filter(Boolean)
    .join("\n");
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

export function buildRubricBoundaryReviewSystemPrompt(): string {
  return [
    "You are a rubric extraction boundary reviewer.",
    "Return strict JSON only.",
    "You are a boundary judge, not a rubric writer.",
    "You only judge whether the current rubric excerpt missed nearby rubric lines.",
    "Do not rewrite the rubric.",
    "Do not summarize the document.",
    "Only inspect the extracted rubric and the nearby context above and below it.",
    "Be conservative: keep the current excerpt unless the nearby lines clearly belong to the same scoring body.",
  ].join("\n");
}

export function buildRubricBoundaryReviewUserPrompt(
  input: RubricBoundaryReviewPromptInput,
): string {
  return [
    "Review whether the current rubric extraction boundary is complete.",
    "You are a boundary judge around the current excerpt.",
    "Your job is only to judge boundary completeness around the current excerpt.",
    "Do not generate a new rubric and do not improve wording.",
    "",
    `Document: ${input.documentName}`,
    "",
    "Current extracted rubric:",
    input.extractedRubric,
    "",
    "Nearby context above the excerpt:",
    input.leadingContext || "[none]",
    "",
    "Nearby context below the excerpt:",
    input.trailingContext || "[none]",
    "",
    "Return one JSON object with this schema:",
    `{"decision":"keep"|"expand_up"|"expand_down"|"expand_both","reason":"short reason","linesUp":0,"linesDown":0}`,
    "",
    "Rules:",
    "- Do not rewrite the rubric.",
    "- Judge only whether the nearby lines belong to the actual scoring body of the rubric.",
    "- Include nearby lines only when they are clearly part of the same rubric section, such as a missing heading, weight line, score band line, dimension title, or scoring note immediately attached to the extracted excerpt.",
    "- Exclude nearby lines when they begin a different support section, for example 分级描述, 案例对比, 测试情景, 规范依据, 附录, references, appendix, examples, scenarios, or policy references.",
    "- If the nearby lines are ambiguous, choose keep.",
    "- If the current excerpt already covers the scoring body, return keep with 0 lines.",
    "- If only nearby omitted lines belong to the rubric, expand just enough to include them.",
    "- Never request expansion just to make the rubric better, longer, or more polished.",
    "- linesUp and linesDown must be integers from 0 to 6.",
  ].join("\n");
}

export function buildRubricLocatorSystemPrompt(): string {
  return [
    "You are a rubric locator for educational agent task documents.",
    "Return strict JSON only.",
    "Your job is to locate the rubric section inside a document that has been pre-converted to plain text (possibly from Markdown, Word, or PDF).",
    "You are a locator, not a rubric author. Never rewrite, summarize, or improve the rubric.",
    "You only return the line range of the actual scoring body.",
    "",
    "Definition of a rubric section:",
    "- A scoring body that evaluates an AI agent's output for the task described in the document.",
    "- Typically organized as a table or list of dimensions/weights/score bands (e.g. 优秀/良好/合格/不合格, A/B/C, 满分/部分分/零分).",
    "- Common headings include: 评价准则, 评价标准, 评分标准, 评估标准, 评分准则, 评估准则, 评价量表, 评估量表, 评分量表, Rubric, Evaluation Criteria.",
    "- Headings may have a numbering prefix (e.g. '5、评价准则', '### 5. 评价准则') or a parenthetical subtitle (e.g. '评价准则（基于智能体输出的评价维度）').",
    "- A document may contain MULTIPLE rubric-like sections (e.g. one for process evaluation, one for result evaluation, one for AI output evaluation). You must include ALL of them.",
    "",
    "What is NOT a rubric section (exclude these):",
    "- Task description, trigger scenarios, core problems, solutions, workflows.",
    "- Case comparisons (案例对比), test scenarios (测试情景), regulatory references (规范依据), appendix (附录).",
    "- Narrative summaries that describe rubric meaning without listing actual dimensions/weights/bands.",
    "- Agent.md or SKILL.md content blocks embedded in the document.",
  ].join("\n");
}

export function buildRubricLocatorUserPrompt(
  input: RubricLocatorPromptInput,
): string {
  return [
    "Locate the rubric section inside the document below.",
    "The document is shown with line numbers in the format `LINE\\tCONTENT`.",
    `Line numbers in the window below range from ${input.windowStartLine} to ${input.windowEndLine}.`,
    `Document: ${input.documentName}`,
    "",
    "Your task:",
    "1. Identify every continuous block that constitutes a rubric scoring body (dimensions + weights + score bands, or equivalent).",
    "2. If multiple rubric blocks exist, merge them into one continuous range that covers all of them (including the lines between them if they belong to the same overall rubric section).",
    "3. Return the start and end line numbers (inclusive) of the merged range.",
    "4. If no rubric section exists in the window, return startLine=0 and endLine=0 with confidence=\"none\".",
    "",
    "Return one JSON object with this schema:",
    `{"startLine":number,"endLine":number,"confidence":"high"|"medium"|"low"|"none","reason":"short reason in Chinese, max 60 chars"}`,
    "",
    "Rules:",
    "- startLine and endLine must be integers within the window range shown below.",
    "- endLine must be >= startLine.",
    "- Do not include the heading line of a non-rubric section that follows the rubric (e.g. '### 6、案例对比' should be excluded).",
    "- Do include the rubric heading line itself (e.g. '### 5、评价准则').",
    "- Include weight tables, dimension tables, score band tables, and scoring notes that are part of the rubric.",
    "- Exclude narrative text before the rubric heading and after the rubric ends.",
    "- If the rubric clearly extends beyond the window boundary, set confidence=\"medium\" and note it in the reason.",
    "- Keep the reason field concise: at most 60 Chinese characters.",
    "",
    "Document with line numbers:",
    input.numberedWindow,
  ].join("\n");
}

export function buildRubricUserPrompt(input: RubricPromptInput): string {
  const mode = input.mode ?? "repair";
  const normalizedSource = input.sourceRubricExcerpt?.trim() || "";
  const normalizedDraft = input.rubricDraft?.trim() || "";
  const includeSourceSection =
    Boolean(normalizedSource) && normalizedSource !== normalizedDraft;

  const sourceRubricSection = includeSourceSection
    ? [
        "",
        "Uploaded documents already contain a rubric-related section. Reuse that content as the primary source, and only add the minimum completion needed to make rubric.md directly scorable.",
        "If the source rubric is already specific, preserve its dimensions, wording, and domain constraints instead of replacing them with generic dimensions.",
        "",
        "Source rubric excerpt:",
        normalizedSource,
      ]
    : [];
  const rubricDraftSection = normalizedDraft
    ? [
        "",
        mode === "optimize"
          ? "There is already a scorable rubric draft. Preserve its task focus, dimensions, weights, and domain constraints while improving clarity and direct scoreability."
          : "There is already an incomplete rubric draft. Keep every user-provided dimension, weight, example, and domain constraint that is still valid.",
        mode === "optimize"
          ? "Tighten wording, remove duplication, and make the scoring bands easier to use, but do not change the task domain or replace the rubric with a generic template."
          : "Do not delete user-provided criteria just because the structure is incomplete. Reorganize and supplement it into a complete rubric.md that can be scored directly.",
        mode === "optimize"
          ? "Keep the rubric concise and practical. This is a rubric optimization pass only, not an interactive optimization request."
          : "When details are missing, add only the minimum necessary completion content so the rubric becomes usable.",
        "",
        mode === "optimize" ? "Existing scorable rubric:" : "Existing rubric draft:",
        normalizedDraft,
      ]
    : [];

  return [
    mode === "optimize"
      ? "Optimize the existing rubric.md for this package so it stays directly scorable and easier to use."
      : "Create a rubric.md for this package with 3-5 scoring dimensions.",
    "The rubric must include dimensions for document fidelity and safety/referral boundaries.",
    "Document fidelity should check whether outputs stay grounded in uploaded materials and avoid unsupported invention.",
    "Safety/referral boundaries should check whether high-risk cases such as severe harm, self-harm, medical/legal crisis, or imminent danger receive appropriate escalation guidance.",
    "Output a complete rubric.md with clear sections, while preserving uploaded rubric content whenever it already exists.",
    "If the uploaded rubric already uses a legacy but scorable structure such as 维度 / 权重 / 分档描述 / 关键检查点, preserve that structure and only fill in the missing pieces instead of rewriting it into a generic template.",
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
