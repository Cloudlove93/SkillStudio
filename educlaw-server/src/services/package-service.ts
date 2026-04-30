import AdmZip, { type IZipEntry } from "adm-zip";
import type {
  AgentPackageDetail,
  AgentPackageSnapshot,
  AgentPackageSummary,
  PackageSkill,
  PackageVersion,
} from "@educlaw/shared";
import { generateChat, generateJson, generateText } from "./llm-service.js";
import { newId, query } from "./db.js";
import type { DbRowPackage, DbRowPackageVersion } from "../types.js";

interface PackageGenerationResult {
  name: string;
  description: string;
  agentMd: string;
  rubricMd: string;
  skills: Array<{
    dirName: string;
    name: string;
    description: string;
    skillMd: string;
  }>;
}

interface PackageBaseGenerationResult {
  name: string;
  description: string;
  skills: Array<{
    dirName: string;
    name: string;
    description: string;
  }>;
}

const MAX_BASE_DOCUMENT_CHARS = 12_000;
const MAX_SKILL_DOCUMENT_CHARS = 8_000;
const MAX_GENERATED_SKILLS = 2;

function ensureSkillIds(snapshot: AgentPackageSnapshot): AgentPackageSnapshot {
  const skills = Array.isArray(snapshot.skills) ? snapshot.skills : [];
  return {
    ...snapshot,
    skills: skills.map((skill) => ({
      ...skill,
      id: skill.id || newId(),
    })),
  };
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || `skill-${Math.random().toString(36).slice(2, 8)}`;
}

function buildDocumentContext(
  documents?: Array<{ name: string; content: string }>,
  maxChars = MAX_BASE_DOCUMENT_CHARS,
): string {
  if (!documents || documents.length === 0) return "";

  const parts = ["", "Uploaded documents:"];
  let remaining = maxChars;

  for (let index = 0; index < documents.length; index += 1) {
    const document = documents[index];
    const name = String(document?.name || `Document ${index + 1}`);
    const content = String(document?.content || "");

    if (remaining <= 0) {
      parts.push(`[Document ${index + 1}: ${name}]\n[内容已因长度限制省略]`);
      continue;
    }

    const chunk = content.slice(0, remaining);
    remaining -= chunk.length;
    const truncated = chunk.length < content.length ? "\n[内容已截断以控制单次模型请求长度]" : "";
    parts.push(`[Document ${index + 1}: ${name}]\n${chunk}${truncated}`);
  }

  return parts.join("\n");
}

function normalizeSkillMetadata(skills: PackageBaseGenerationResult["skills"]) {
  const used = new Set<string>();
  return skills.slice(0, MAX_GENERATED_SKILLS).map((skill, index) => {
    const baseDirName = slugify(skill.dirName || skill.name || `skill-${index + 1}`);
    let dirName = baseDirName;
    let suffix = 2;
    while (used.has(dirName)) {
      dirName = `${baseDirName}-${suffix}`;
      suffix += 1;
    }
    used.add(dirName);

    return {
      dirName,
      name: (skill.name || `技能 ${index + 1}`).trim(),
      description: sanitizeSkillDescription(skill.description),
    };
  });
}

function sanitizeSkillDescription(description: string | undefined): string {
  return (
    (description || "用于处理该智能体的核心任务")
      .replace(/\s+/g, " ")
      .replace(/[<>]/g, "")
      .trim()
      .slice(0, 180) || "用于处理该智能体的核心任务"
  );
}

function stripMarkdownFence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i);
  return (match ? match[1] : trimmed).trim();
}

function normalizeSkillMdFrontmatter(skillMd: string, dirName: string, description: string): string {
  const trimmed = stripMarkdownFence(skillMd);
  const safeDescription = sanitizeSkillDescription(description);
  const frontmatter = `---\nname: ${dirName}\ndescription: ${safeDescription}\n---`;
  const match = trimmed.match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
  const body = match ? trimmed.slice(match[0].length).trimStart() : trimmed;
  return `${frontmatter}\n\n${body}`.trim();
}

function normalizeSnapshot(input: PackageGenerationResult): AgentPackageSnapshot {
  return {
    name: input.name.trim(),
    description: input.description.trim(),
    versionLabel: "v1",
    agentMd: input.agentMd.trim(),
    rubricMd: input.rubricMd.trim(),
    skills: input.skills.map((skill) => ({
      id: newId(),
      dirName: slugify(skill.dirName || skill.name),
      name: skill.name.trim(),
      description: skill.description.trim(),
      skillMd: skill.skillMd.trim(),
    })),
  };
}

/* ── Claude Skill / Agent Skill 标准校验 ── */

function getBaseOutputSchemaPrompt(): string {
  return [
    "## 输出 JSON 结构",
    "返回以下结构的 JSON：",
    "- name: 智能体名称",
    "- description: 智能体一句话描述",
    "- skills: 1-2 个核心技能的元数据数组，每个技能包含：",
    "  - dirName: 目录名，小写英文 kebab-case",
    "  - name: 技能显示名称",
    "  - description: 一句话说明该 skill 做什么，以及什么时候使用（必须包含'当/如果/用于/遇到/针对'等触发词）",
    "",
    "要求：",
    "1. 只返回 JSON，不要 Markdown 代码块",
    "2. skills 最多 2 个，选择最能支撑该智能体工作的核心技能",
    "3. 不要在本步骤生成 agentMd、rubricMd 或 skillMd，大段 Markdown 会在后续步骤单独生成",
  ].join("\n");
}

function getCompactSkillTemplatePrompt(): string {
  return [
    "返回完整 SKILL.md 的 Markdown 文本，不要 JSON，不要 Markdown 代码块。",
    "SKILL.md 必须包含：",
    "---",
    "name: <dirName>",
    "description: <一句话说明该 skill 做什么，以及什么时候使用，必须包含触发词如'当/如果/用于/遇到/针对'>",
    "---",
    "# <Skill 显示名称>",
    "## Instructions",
    "## Workflow",
    "## Output Format",
    "## Examples",
    "## Common Issues",
    "",
    "要求：",
    "- 内容要精炼，每个章节 2-5 条即可",
    "- frontmatter name 必须等于 dirName",
    "- 只返回 SKILL.md 文件内容本身，不要解释",
  ].join("\n");
}

function extractFrontmatterValue(skillMd: string, key: string): string | null {
  const match = skillMd.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;
  const line = match[1].split("\n").find((l) => l.trim().startsWith(`${key}:`));
  if (!line) return null;
  const value = line.slice(line.indexOf(":") + 1).trim();
  return value.replace(/^["']|["']$/g, "");
}

function validateSkillMdStandard(skillMd: string, dirName: string): string[] {
  const errors: string[] = [];

  // 1. 检查是否以 YAML frontmatter 开头
  if (!skillMd.trim().startsWith("---")) {
    errors.push("SKILL.md 必须以 YAML frontmatter（---）开头");
    return errors; // 没有 frontmatter 后续检查无意义
  }

  const fmName = extractFrontmatterValue(skillMd, "name");
  const fmDescription = extractFrontmatterValue(skillMd, "description");

  // 2. 检查 frontmatter 中是否包含 name 和 description
  if (!fmName) errors.push("YAML frontmatter 缺少 name 字段");
  if (!fmDescription) errors.push("YAML frontmatter 缺少 description 字段");

  // 3. 检查 name 是否为小写英文 kebab-case
  if (fmName && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fmName)) {
    errors.push(`frontmatter name "${fmName}" 不是小写英文 kebab-case`);
  }

  // 4. 检查 name 是否包含保留词
  if (fmName && /\b(claude|anthropic)\b/i.test(fmName)) {
    errors.push(`frontmatter name "${fmName}" 包含保留词（claude / anthropic）`);
  }

  // 5. 检查 dirName 是否与 frontmatter name 一致
  if (fmName && dirName !== fmName) {
    errors.push(`dirName "${dirName}" 与 frontmatter name "${fmName}" 不一致`);
  }

  // 6. 检查 description 是否过长（>200 字符）
  if (fmDescription && fmDescription.length > 200) {
    errors.push(`frontmatter description 过长（${fmDescription.length} 字符，建议 ≤200）`);
  }

  // 7. 检查 description 是否包含 XML 尖括号
  if (fmDescription && /[<>]/.test(fmDescription)) {
    errors.push("frontmatter description 不应包含 XML 尖括号");
  }

  // 8. 检查 description 是否说明了触发场景
  if (fmDescription && !/(当|如果|用于|适合|场景|触发|调用|需要|时|情况|在|针对|遇到|面对|出现|用户|输入|请求|问题|任务|则|就|便)/.test(fmDescription)) {
    errors.push("frontmatter description 应说明 skill 的触发场景（什么时候使用）");
  }

  // 9. 检查正文结构
  const body = skillMd.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "").trim();
  if (body.length < 200) {
    errors.push("SKILL.md 正文过短（<200 字符），请补充详细说明");
  }

  const requiredSections = ["Instructions", "Workflow", "Output Format", "Examples", "Common Issues"];
  for (const section of requiredSections) {
    if (!new RegExp(`^##?\\s*${section}`, "im").test(body)) {
      errors.push(`正文缺少必要章节：${section}`);
    }
  }

  return errors;
}

function validateBaseGenerationResult(generated: PackageBaseGenerationResult): void {
  const errors: string[] = [];

  if (!generated.name?.trim()) errors.push("缺少智能体 name");
  if (!generated.description?.trim()) errors.push("缺少智能体 description");

  if (!Array.isArray(generated.skills) || generated.skills.length === 0) {
    errors.push("skills 必须为非空数组");
  } else {
    for (let index = 0; index < Math.min(generated.skills.length, MAX_GENERATED_SKILLS); index += 1) {
      const skill = generated.skills[index];
      const prefix = `skills[${index}]`;
      if (!skill.dirName?.trim()) errors.push(`${prefix} 缺少 dirName`);
      if (!skill.name?.trim()) errors.push(`${prefix} 缺少 name`);
      if (!skill.description?.trim()) errors.push(`${prefix} 缺少 description`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`生成基础结构校验失败：\n${errors.map((e) => "- " + e).join("\n")}`);
  }
}

function validateGenerationResult(generated: PackageGenerationResult): void {
  const errors: string[] = [];

  // 检查顶层字段
  if (!generated.name?.trim()) errors.push("缺少智能体 name");
  if (!generated.description?.trim()) errors.push("缺少智能体 description");
  if (!generated.agentMd?.trim()) errors.push("缺少 agentMd");
  if (!generated.rubricMd?.trim()) errors.push("缺少 rubricMd");

  // 检查 skills
  if (!Array.isArray(generated.skills) || generated.skills.length === 0) {
    errors.push("skills 必须为非空数组");
  } else {
    for (let i = 0; i < generated.skills.length; i++) {
      const skill = generated.skills[i];
      const prefix = `skills[${i}]`;
      if (!skill.dirName?.trim()) errors.push(`${prefix} 缺少 dirName`);
      if (!skill.name?.trim()) errors.push(`${prefix} 缺少 name`);
      if (!skill.description?.trim()) errors.push(`${prefix} 缺少 description`);
      if (!skill.skillMd?.trim()) {
        errors.push(`${prefix} 缺少 skillMd`);
      } else {
        if (skill.skillMd.trim().length < 300) {
          errors.push(`${prefix} skillMd 过短（<300 字符），请补充详细内容`);
        }
        const skillErrors = validateSkillMdStandard(skill.skillMd, skill.dirName || "");
        for (const e of skillErrors) {
          errors.push(`${prefix} ${e}`);
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`生成结果校验失败：\n${errors.map((e) => "- " + e).join("\n")}`);
  }
}

function toSummary(row: DbRowPackage, version: DbRowPackageVersion): AgentPackageSummary {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    versionNumber: version.version_number,
    updatedAt: row.updated_at,
  };
}

function toDetail(row: DbRowPackage, version: DbRowPackageVersion): AgentPackageDetail {
  return {
    ...toSummary(row, version),
    snapshot: JSON.parse(version.snapshot_json) as AgentPackageSnapshot,
  };
}

async function getPackageRow(userId: string, packageId: string) {
  const packageResult = await query<DbRowPackage>(
    "select * from agent_packages where id = $1 and user_id = $2",
    [packageId, userId],
  );
  const row = packageResult.rows[0];
  if (!row) throw new Error("\u667a\u80fd\u4f53\u5305\u4e0d\u5b58\u5728");

  const versionResult = await query<DbRowPackageVersion>(
    "select * from agent_package_versions where id = $1",
    [row.current_version_id],
  );
  const version = versionResult.rows[0];
  if (!version) throw new Error("瑜版挸澧犻悧鍫熸拱閺佺増宓佺紓鍝勩亼");
  return { row, version };
}

export async function listPackages(userId: string) {
  const result = await query<DbRowPackage>(
    "select * from agent_packages where user_id = $1 order by updated_at desc",
    [userId],
  );
  const items: AgentPackageSummary[] = [];
  for (const row of result.rows) {
    const versionResult = await query<DbRowPackageVersion>(
      "select * from agent_package_versions where id = $1",
      [row.current_version_id],
    );
    const version = versionResult.rows[0];
    if (version) items.push(toSummary(row, version));
  }
  return items;
}

export async function getPackage(userId: string, packageId: string) {
  const { row, version } = await getPackageRow(userId, packageId);
  return toDetail(row, version);
}

export async function listVersions(userId: string, packageId: string) {
  const packageResult = await query<DbRowPackage>(
    "select * from agent_packages where id = $1 and user_id = $2",
    [packageId, userId],
  );
  const row = packageResult.rows[0];
  if (!row) throw new Error("\u667a\u80fd\u4f53\u5305\u4e0d\u5b58\u5728");

  const versions = await query<DbRowPackageVersion>(
    "select * from agent_package_versions where package_id = $1 order by version_number desc",
    [packageId],
  );

  return versions.rows.map((version: DbRowPackageVersion): PackageVersion => ({
    id: version.id,
    packageId: version.package_id,
    versionNumber: version.version_number,
    createdAt: version.created_at,
    source: version.source as PackageVersion["source"],
    note: version.note || "",
    snapshot: JSON.parse(version.snapshot_json) as AgentPackageSnapshot,
  }));
}

export async function updateVersionNote(
  userId: string,
  packageId: string,
  versionId: string,
  note: string,
) {
  const packageResult = await query<DbRowPackage>(
    "select * from agent_packages where id = $1 and user_id = $2",
    [packageId, userId],
  );
  const row = packageResult.rows[0];
  if (!row) throw new Error("智能体包不存在");

  const result = await query<DbRowPackageVersion>(
    "update agent_package_versions set note = $1 where id = $2 and package_id = $3 returning *",
    [note, versionId, packageId],
  );
  if (result.rowCount === 0) throw new Error("版本不存在");
  const version = result.rows[0];
  return {
    id: version.id,
    packageId: version.package_id,
    versionNumber: version.version_number,
    createdAt: version.created_at,
    source: version.source as PackageVersion["source"],
    note: version.note || "",
    snapshot: JSON.parse(version.snapshot_json) as AgentPackageSnapshot,
  };
}

async function createPackageWithSnapshot(
  userId: string,
  snapshot: AgentPackageSnapshot,
  source: PackageVersion["source"],
) {
  const packageId = newId();
  const versionId = newId();
  const now = new Date().toISOString();
  const fixedSnapshot = ensureSkillIds(snapshot);

  await query(
    "insert into agent_package_versions (id, package_id, version_number, source, snapshot_json, created_at) values ($1, $2, $3, $4, $5, $6)",
    [versionId, packageId, 1, source, JSON.stringify(fixedSnapshot), now],
  );

  await query(
    "insert into agent_packages (id, user_id, name, description, current_version_id, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7)",
    [packageId, userId, fixedSnapshot.name, fixedSnapshot.description, versionId, now, now],
  );

  return getPackage(userId, packageId);
}

export async function generatePackage(
  userId: string,
  instruction: string,
  model?: string,
  documents?: Array<{ name: string; content: string }>,
  onPreview?: (preview: { type: string; name: string; content: string }) => void,
) {
  const startedAt = Date.now();
  const docParts = buildDocumentContext(documents, MAX_BASE_DOCUMENT_CHARS);
  const skillDocParts = buildDocumentContext(documents, MAX_SKILL_DOCUMENT_CHARS);
  const hasInstruction = instruction.trim().length > 0;

  console.log("[packages.generate] base start", {
    userId,
    instructionLength: instruction.length,
    documentCount: documents?.length || 0,
    documentChars: documents?.reduce((sum, doc) => sum + String(doc?.content || "").length, 0) || 0,
    model,
  });

  const base = await generateJson<PackageBaseGenerationResult>({
    model,
    systemPrompt: [
      "You are an agent-package generation assistant.",
      "Return JSON only.",
      "Generate only compact metadata for one reusable prompt package.",
      "Prefer Chinese content when the user instruction is Chinese.",
      "When documents are provided without explicit instructions, deeply analyze the documents to extract domain knowledge, workflows, and rules, then build the agent and skills entirely from the document content.",
      "Do not generate agent.md, rubric.md, or full SKILL.md content in this step.",
    ].join("\n"),
    userPrompt: hasInstruction
      ? [
          "Create a prompt package from this instruction:",
          instruction,
          docParts,
          "",
          getBaseOutputSchemaPrompt(),
        ].join("\n")
      : [
          "Analyze the following documents and create a compact prompt package base based entirely on their content.",
          "Infer the agent's role, workflow, core skills, and evaluation criteria directly from the document content.",
          docParts,
          "",
          getBaseOutputSchemaPrompt(),
        ].join("\n"),
    temperature: 0.4,
    maxTokens: 2000,
  }, 0);

  validateBaseGenerationResult(base);
  const skillMetas = normalizeSkillMetadata(base.skills);
  console.log("[packages.generate] base done", {
    durationMs: Date.now() - startedAt,
    skillCount: skillMetas.length,
  });

  const agentMd = stripMarkdownFence(await generateText({
    model,
    systemPrompt: [
      "You are an expert agent.md author.",
      "Return plain Markdown only.",
      "Do not wrap the answer in Markdown fences.",
      "Prefer Chinese content when the source content is Chinese.",
    ].join("\n"),
    userPrompt: [
      "Create a complete but concise agent.md for this package.",
      "",
      `Package name: ${base.name}`,
      `Package description: ${base.description}`,
      "",
      "Core skills metadata:",
      JSON.stringify(skillMetas, null, 2),
      "",
      hasInstruction ? "User instruction:" : "Source documents:",
      hasInstruction ? instruction : docParts,
      "",
      "The agent.md should define role, workflow, boundaries, and output style.",
      "Return only the Markdown file content.",
    ].join("\n"),
    temperature: 0.35,
    maxTokens: 3500,
  }));

  const rubricMd = stripMarkdownFence(await generateText({
    model,
    systemPrompt: [
      "You are an evaluation rubric author.",
      "Return plain Markdown only.",
      "Do not wrap the answer in Markdown fences.",
      "Prefer Chinese content when the source content is Chinese.",
    ].join("\n"),
    userPrompt: [
      "Create a rubric.md for this package with 3-5 scoring dimensions.",
      "",
      `Package name: ${base.name}`,
      `Package description: ${base.description}`,
      "",
      "agent.md 摘要：",
      agentMd.slice(0, 1800),
      "",
      "Return only the Markdown file content.",
    ].join("\n"),
    temperature: 0.25,
    maxTokens: 2000,
  }));

  onPreview?.({ type: "agent", name: "agent.md", content: agentMd.trim().slice(0, 1200) });
  onPreview?.({ type: "rubric", name: "rubric.md", content: rubricMd.trim().slice(0, 800) });

  const skills: PackageGenerationResult["skills"] = [];
  for (let index = 0; index < skillMetas.length; index += 1) {
    const skillMeta = skillMetas[index];
    const skillStartedAt = Date.now();
    console.log("[packages.generate] skill start", {
      index: index + 1,
      total: skillMetas.length,
      dirName: skillMeta.dirName,
      model,
    });

    const skillMdRaw = await generateText({
      model,
      systemPrompt: [
        "You are a concise SKILL.md author.",
        "Return plain Markdown only.",
        "Do not wrap the answer in Markdown fences.",
        "Prefer Chinese content when the source content is Chinese.",
        "Generate only the requested SKILL.md content; do not regenerate agent.md or rubric.md.",
      ].join("\n"),
      userPrompt: [
        "Create one compact SKILL.md for this package.",
        "",
        `Package name: ${base.name}`,
        `Package description: ${base.description}`,
        "",
        "agent.md 摘要：",
        agentMd.slice(0, 1800),
        "",
        "rubric.md 摘要：",
        rubricMd.slice(0, 1200),
        skillDocParts,
        "",
        "Skill metadata:",
        JSON.stringify(skillMeta),
        "",
        getCompactSkillTemplatePrompt(),
      ].join("\n"),
      temperature: 0.35,
      maxTokens: 4000,
    });

    const skillMd = normalizeSkillMdFrontmatter(skillMdRaw || "", skillMeta.dirName, skillMeta.description);
    const skill = { ...skillMeta, skillMd };
    skills.push(skill);
    onPreview?.({ type: "skill", name: skill.name, content: skill.skillMd.slice(0, 800) });
    console.log("[packages.generate] skill done", {
      index: index + 1,
      dirName: skill.dirName,
      durationMs: Date.now() - skillStartedAt,
    });
  }

  const generated: PackageGenerationResult = {
    name: base.name,
    description: base.description,
    agentMd,
    rubricMd,
    skills,
  };

  validateGenerationResult(generated);

  const snapshot = normalizeSnapshot(generated);
  console.log("[packages.generate] validate done", { durationMs: Date.now() - startedAt });
  return createPackageWithSnapshot(userId, snapshot, "generated");
}

async function importPackageWithVersions(
  userId: string,
  versions: Array<{ versionNumber: number; source: string; snapshot: AgentPackageSnapshot; createdAt: string }>,
) {
  if (versions.length === 0) throw new Error("版本历史为空");

  const packageId = newId();
  const now = new Date().toISOString();

  // Sort by versionNumber ascending to ensure correct insertion order
  const sortedVersions = [...versions].sort((a, b) => a.versionNumber - b.versionNumber);

  // Derive package name/description from any version that has it
  let packageName = "";
  let packageDescription = "";
  for (const v of sortedVersions) {
    if (v.snapshot.name) packageName = v.snapshot.name;
    if (v.snapshot.description) packageDescription = v.snapshot.description;
    if (packageName && packageDescription) break;
  }
  if (!packageName) packageName = "导入的智能体包";
  if (!packageDescription) packageDescription = "导入的智能体包";

  // 创建所有版本记录（确保每个 snapshot 都有 name/description）
  let currentVersionId = "";
  let maxVersionNumber = 0;
  for (const v of sortedVersions) {
    const versionId = newId();
    const enrichedSnapshot: AgentPackageSnapshot = ensureSkillIds({
      ...v.snapshot,
      name: v.snapshot.name || packageName,
      description: v.snapshot.description || packageDescription,
    });
    await query(
      "insert into agent_package_versions (id, package_id, version_number, source, snapshot_json, created_at) values ($1, $2, $3, $4, $5, $6)",
      [versionId, packageId, v.versionNumber, v.source, JSON.stringify(enrichedSnapshot), v.createdAt || now],
    );
    if (v.versionNumber >= maxVersionNumber) {
      maxVersionNumber = v.versionNumber;
      currentVersionId = versionId;
    }
  }

  await query(
    "insert into agent_packages (id, user_id, name, description, current_version_id, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7)",
    [packageId, userId, packageName, packageDescription, currentVersionId, now, now],
  );

  return getPackage(userId, packageId);
}

export async function importPackageZip(userId: string, zipBuffer: Buffer) {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();
  const manifestEntry = entries.find((entry: IZipEntry) => entry.entryName.endsWith("manifest.json"));
  const agentEntry = entries.find((entry: IZipEntry) => entry.entryName.endsWith("agent.md"));
  const rubricEntry = entries.find((entry: IZipEntry) => entry.entryName.endsWith("rubric.md"));
  const versionsEntry = entries.find((entry: IZipEntry) => entry.entryName.endsWith("versions.json"));

  if (!manifestEntry || !agentEntry) {
    throw new Error("导入的 ZIP 文件中缺少 manifest.json 或 agent.md");
  }

  const manifest = JSON.parse(zip.readAsText(manifestEntry, "utf8")) as {
    name?: string;
    description?: string;
  };

  // 如果存在 versions.json，恢复完整版本历史
  if (versionsEntry) {
    try {
      const versions = JSON.parse(zip.readAsText(versionsEntry, "utf8")) as Array<{
        versionNumber: number;
        source: string;
        snapshot: AgentPackageSnapshot;
        createdAt: string;
      }>;
      if (Array.isArray(versions) && versions.length > 0) {
        return importPackageWithVersions(userId, versions);
      }
    } catch {
      // fallback to normal import
    }
  }

  // 普通导入（兼容旧格式或没有版本历史的 ZIP）
  const skillEntries = entries.filter((entry: IZipEntry) => /skills\/[^/]+\/SKILL\.md$/.test(entry.entryName));
  const skills: PackageSkill[] = skillEntries.map((entry: IZipEntry) => {
    const parts = entry.entryName.split("/");
    const dirName = parts[parts.length - 2]!;
    const content = zip.readAsText(entry, "utf8");
    const title = content.split("\n").find((line: string) => line.startsWith("# "))?.replace(/^#\s+/, "") || dirName;
    return {
      id: newId(),
      dirName,
      name: title,
      description: `${title} skill`,
      skillMd: content,
    };
  });

  const snapshot: AgentPackageSnapshot = {
    name: manifest.name?.trim() || "导入的智能体包",
    description: manifest.description?.trim() || "导入的智能体包",
    versionLabel: "v1",
    agentMd: zip.readAsText(agentEntry, "utf8").trim(),
    rubricMd: rubricEntry
      ? zip.readAsText(rubricEntry, "utf8").trim()
      : "# Rubric\n\n## Dimensions\n- Clarity\n- Correctness\n- Structure",
    skills,
  };

  return createPackageWithSnapshot(userId, snapshot, "imported");
}

export async function exportPackageZip(userId: string, packageId: string) {
  const pkg = await getPackage(userId, packageId);
  const versions = await listVersions(userId, packageId);
  const zip = new AdmZip();

  zip.addFile("manifest.json", Buffer.from(JSON.stringify({
    name: pkg.snapshot.name,
    description: pkg.snapshot.description,
    versionLabel: pkg.snapshot.versionLabel,
    versionCount: versions.length,
    hasVersionHistory: versions.length > 1,
    exportedAt: new Date().toISOString(),
  }, null, 2)));

  zip.addFile("agent.md", Buffer.from(pkg.snapshot.agentMd));
  zip.addFile("rubric.md", Buffer.from(pkg.snapshot.rubricMd));
  for (const skill of pkg.snapshot.skills) {
    zip.addFile(`skills/${skill.dirName}/SKILL.md`, Buffer.from(skill.skillMd));
  }

  if (versions.length > 0) {
    zip.addFile("versions.json", Buffer.from(JSON.stringify(
      versions.map((v) => ({
        versionNumber: v.versionNumber,
        source: v.source,
        snapshot: v.snapshot,
        createdAt: v.createdAt,
      })),
      null,
      2,
    )));
  }

  return zip.toBuffer();
}

export async function deletePackage(userId: string, packageId: string) {
  const pkg = await query<DbRowPackage>(
    "select * from agent_packages where id = $1 and user_id = $2",
    [packageId, userId],
  );
  if (!pkg.rows[0]) throw new Error("\u667a\u80fd\u4f53\u5305\u4e0d\u5b58\u5728");

  await query(
    "delete from arena_messages where thread_id in (select id from arena_threads where package_id = $1 and user_id = $2)",
    [packageId, userId],
  );
  await query("delete from arena_threads where package_id = $1 and user_id = $2", [packageId, userId]);
  await query("delete from agent_package_versions where package_id = $1", [packageId]);
  await query("delete from agent_packages where id = $1 and user_id = $2", [packageId, userId]);
}

export async function applyOptimizedSnapshot(
  userId: string,
  packageId: string,
  snapshot: AgentPackageSnapshot,
  source: PackageVersion["source"],
  note?: string,
) {
  const pkg = await getPackage(userId, packageId);
  const versions = await query<DbRowPackageVersion>(
    "select * from agent_package_versions where package_id = $1 order by version_number desc limit 1",
    [packageId],
  );
  const nextVersion = (versions.rows[0]?.version_number || 0) + 1;
  const versionId = newId();
  const now = new Date().toISOString();

  // Ensure snapshot has name/description from the original package
  const nextSnapshot: AgentPackageSnapshot = ensureSkillIds({
    ...snapshot,
    name: snapshot.name || pkg.name,
    description: snapshot.description || pkg.description,
    versionLabel: `v${nextVersion}`,
  });

  await query(
    "insert into agent_package_versions (id, package_id, version_number, source, snapshot_json, note, created_at) values ($1, $2, $3, $4, $5, $6, $7)",
    [versionId, packageId, nextVersion, source, JSON.stringify(nextSnapshot), note || "", now],
  );

  await query(
    "update agent_packages set name = $1, description = $2, current_version_id = $3, updated_at = $4 where id = $5 and user_id = $6",
    [pkg.name, pkg.description, versionId, now, pkg.id, userId],
  );

  return getPackage(userId, packageId);
}

/* ── version compare ── */

export interface LineDiff {
  type: "same" | "removed" | "added";
  text: string;
}

export interface SkillDiff {
  dirName: string;
  name: string;
  diff: LineDiff[];
}

export interface VersionCompareResult {
  baseVersion: { id: string; versionNumber: number; source: string; createdAt: string };
  targetVersion: { id: string; versionNumber: number; source: string; createdAt: string };
  diffs: {
    agentMd: LineDiff[];
    rubricMd: LineDiff[];
    skills: SkillDiff[];
  };
  summary: string;
}

function computeDiff(oldText: string, newText: string): LineDiff[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const result: LineDiff[] = [];
  let i = 0, j = 0;

  while (i < oldLines.length || j < newLines.length) {
    const oldLine = i < oldLines.length ? oldLines[i] : undefined;
    const newLine = j < newLines.length ? newLines[j] : undefined;

    if (oldLine === newLine) {
      result.push({ type: "same", text: oldLine || "" });
      i++; j++;
    } else if (oldLine !== undefined && newLine !== undefined) {
      // Check if old line appears later in new (removed)
      const newIndexAhead = newLines.slice(j + 1).indexOf(oldLine);
      // Check if new line appeared earlier in old (added)
      const oldIndexAhead = oldLines.slice(i + 1).indexOf(newLine);

      if (newIndexAhead !== -1 && (oldIndexAhead === -1 || newIndexAhead <= oldIndexAhead)) {
        // oldLine is removed, skip it
        result.push({ type: "removed", text: oldLine });
        i++;
      } else if (oldIndexAhead !== -1 && (newIndexAhead === -1 || oldIndexAhead < newIndexAhead)) {
        // newLine is added
        result.push({ type: "added", text: newLine });
        j++;
      } else {
        // Both changed
        result.push({ type: "removed", text: oldLine });
        result.push({ type: "added", text: newLine });
        i++; j++;
      }
    } else if (oldLine !== undefined) {
      result.push({ type: "removed", text: oldLine });
      i++;
    } else if (newLine !== undefined) {
      result.push({ type: "added", text: newLine });
      j++;
    }
  }

  return result;
}

function compactDiff(diffs: LineDiff[], contextLines = 2): LineDiff[] {
  const result: LineDiff[] = [];
  let sameRunStart = -1;

  for (let i = 0; i < diffs.length; i++) {
    const d = diffs[i];
    if (d.type !== "same") {
      if (sameRunStart !== -1) {
        const runLen = i - sameRunStart;
        if (runLen > contextLines * 2) {
          result.push(...diffs.slice(sameRunStart, sameRunStart + contextLines));
          result.push({ type: "same", text: `... (${runLen - contextLines * 2} 行未变更) ...` });
          result.push(...diffs.slice(i - contextLines, i));
        } else {
          result.push(...diffs.slice(sameRunStart, i));
        }
        sameRunStart = -1;
      }
      result.push(d);
    } else {
      if (sameRunStart === -1) sameRunStart = i;
    }
  }

  if (sameRunStart !== -1) {
    const runLen = diffs.length - sameRunStart;
    if (runLen > contextLines * 2) {
      result.push(...diffs.slice(sameRunStart, sameRunStart + contextLines));
      result.push({ type: "same", text: `... (${runLen - contextLines * 2} 行未变更) ...` });
      result.push(...diffs.slice(diffs.length - contextLines, diffs.length));
    } else {
      result.push(...diffs.slice(sameRunStart, diffs.length));
    }
  }

  return result;
}

export async function getVersion(userId: string, packageId: string, versionId: string): Promise<PackageVersion> {
  const packageResult = await query<DbRowPackage>(
    "select * from agent_packages where id = $1 and user_id = $2",
    [packageId, userId],
  );
  if (!packageResult.rows[0]) throw new Error("智能体包不存在");

  const versionResult = await query<DbRowPackageVersion>(
    "select * from agent_package_versions where id = $1 and package_id = $2",
    [versionId, packageId],
  );
  const row = versionResult.rows[0];
  if (!row) throw new Error("版本不存在");

  return {
    id: row.id,
    packageId: row.package_id,
    versionNumber: row.version_number,
    createdAt: row.created_at,
    source: row.source as PackageVersion["source"],
    note: row.note || "",
    snapshot: JSON.parse(row.snapshot_json) as AgentPackageSnapshot,
  };
}

export async function compareVersions(
  userId: string,
  packageId: string,
  baseVersionId: string,
  targetVersionId: string,
  model?: string,
): Promise<VersionCompareResult> {
  const base = await getVersion(userId, packageId, baseVersionId);
  const target = await getVersion(userId, packageId, targetVersionId);

  const agentMdDiff = compactDiff(computeDiff(base.snapshot.agentMd, target.snapshot.agentMd));
  const rubricMdDiff = compactDiff(computeDiff(base.snapshot.rubricMd, target.snapshot.rubricMd));

  const skillDiffs: SkillDiff[] = [];
  const allDirNames = new Set([
    ...base.snapshot.skills.map((s) => s.dirName),
    ...target.snapshot.skills.map((s) => s.dirName),
  ]);

  for (const dirName of allDirNames) {
    const baseSkill = base.snapshot.skills.find((s) => s.dirName === dirName);
    const targetSkill = target.snapshot.skills.find((s) => s.dirName === dirName);
    const name = targetSkill?.name || baseSkill?.name || dirName;

    if (!baseSkill && targetSkill) {
      skillDiffs.push({
        dirName,
        name,
        diff: compactDiff(targetSkill.skillMd.split("\n").map((text) => ({ type: "added" as const, text }))),
      });
    } else if (baseSkill && !targetSkill) {
      skillDiffs.push({
        dirName,
        name,
        diff: compactDiff(baseSkill.skillMd.split("\n").map((text) => ({ type: "removed" as const, text }))),
      });
    } else if (baseSkill && targetSkill) {
      const diff = compactDiff(computeDiff(baseSkill.skillMd, targetSkill.skillMd));
      if (diff.some((d) => d.type !== "same")) {
        skillDiffs.push({ dirName, name, diff });
      }
    }
  }

  // AI summary
  const diffSummary = [
    `## agent.md`,
    agentMdDiff.filter((d) => d.type !== "same").slice(0, 40).map((d) => `${d.type === "removed" ? "-" : "+"} ${d.text}`).join("\n"),
    ``,
    `## rubric.md`,
    rubricMdDiff.filter((d) => d.type !== "same").slice(0, 40).map((d) => `${d.type === "removed" ? "-" : "+"} ${d.text}`).join("\n"),
    ``,
    `## skills`,
    skillDiffs.map((s) => {
      const changes = s.diff.filter((d) => d.type !== "same").slice(0, 20);
      return `### ${s.name} (${s.dirName})\n${changes.map((d) => `${d.type === "removed" ? "-" : "+"} ${d.text}`).join("\n")}`;
    }).join("\n\n"),
  ].join("\n");

  const summaryPrompt = [
    "你是智能体包版本对比专家。请根据以下两个版本的 diff，用中文总结改动内容。",
    "",
    `基准版本：v${base.versionNumber} (${base.source})`,
    `目标版本：v${target.versionNumber} (${target.source})`,
    "",
    "## Diff 内容",
    diffSummary.split("\n").slice(0, 200).join("\n").slice(0, 6000),
    "",
    "## 要求",
    "1. 总结每个文件（agent.md、rubric.md、skills）的主要改动",
    "2. 用 markdown 表格格式返回，表格包含以下列：",
    "   | 文件 | 改动类型 | 变化内容 | 作用/影响 |",
    "   - 文件：agent.md / rubric.md / skill 名称",
    "   - 改动类型：新增 / 删除 / 修改 / 重构 / 优化 / 无变更",
    "   - 变化内容：具体改了什么（1-2句话，精炼）",
    "   - 作用/影响：这个改动带来了什么效果（1句话）",
    "3. 表格下方用 1-2 句话总结整体改动趋势",
    "4. 如果无改动，表格里写'无变更'，总结写'两个版本一致'",
    "5. 必须返回包含 summary 字段的 JSON，summary 内容为 markdown 表格",
  ].join("\n");

  let summary = "";
  try {
    const result = await generateJson<{ summary: string }>({
      model,
      systemPrompt: '你是智能体包版本对比专家。根据 diff 内容总结改动。必须严格返回 JSON 格式：{"summary": "总结内容"}。summary 不能为空，必须包含实质性的总结内容。不要返回其他内容。',
      userPrompt: summaryPrompt,
      temperature: 0.3,
    });
    summary = result.summary?.trim() || "";
  } catch {
    summary = "";
  }

  // Fallback: if JSON parsing fails or summary is empty, try plain text
  if (!summary) {
    try {
      const chatResult = await generateChat([
        { role: "system", content: "你是智能体包版本对比专家。根据 diff 内容用中文总结改动。直接输出总结文本，不要返回 JSON。" },
        { role: "user", content: summaryPrompt },
      ], model, 0.3);
      summary = chatResult.trim();
    } catch {
      summary = "";
    }
  }

  if (!summary) {
    const hasChanges = agentMdDiff.some((d) => d.type !== "same") || rubricMdDiff.some((d) => d.type !== "same") || skillDiffs.length > 0;
    summary = hasChanges ? "AI 总结生成失败，请直接查看下方的 diff 详情。" : "两个版本无差异。";
  }

  return {
    baseVersion: { id: base.id, versionNumber: base.versionNumber, source: base.source, createdAt: base.createdAt },
    targetVersion: { id: target.id, versionNumber: target.versionNumber, source: target.source, createdAt: target.createdAt },
    diffs: { agentMd: agentMdDiff, rubricMd: rubricMdDiff, skills: skillDiffs },
    summary,
  };
}
