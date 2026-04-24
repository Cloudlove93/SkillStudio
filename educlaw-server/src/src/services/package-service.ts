import AdmZip, { type IZipEntry } from "adm-zip";
import type {
  AgentPackageDetail,
  AgentPackageSnapshot,
  AgentPackageSummary,
  PackageSkill,
  PackageVersion,
} from "@educlaw/shared";
import { generateJson } from "./llm-service.js";
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

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || `skill-${Math.random().toString(36).slice(2, 8)}`;
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
    snapshot: JSON.parse(version.snapshot_json) as AgentPackageSnapshot,
  }));
}

async function createPackageWithSnapshot(
  userId: string,
  snapshot: AgentPackageSnapshot,
  source: PackageVersion["source"],
) {
  const packageId = newId();
  const versionId = newId();
  const now = new Date().toISOString();

  await query(
    "insert into agent_package_versions (id, package_id, version_number, source, snapshot_json, created_at) values ($1, $2, $3, $4, $5, $6)",
    [versionId, packageId, 1, source, JSON.stringify(snapshot), now],
  );

  await query(
    "insert into agent_packages (id, user_id, name, description, current_version_id, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7)",
    [packageId, userId, snapshot.name, snapshot.description, versionId, now, now],
  );

  return getPackage(userId, packageId);
}

export async function generatePackage(
  userId: string,
  instruction: string,
  model?: string,
  onPreview?: (preview: { type: string; name: string; content: string }) => void,
) {
  const generated = await generateJson<PackageGenerationResult>({
    model,
    systemPrompt: [
      "You are an agent-package generation assistant.",
      "Return JSON only.",
      "Generate one reusable prompt package with agent markdown, rubric markdown, and modular skills.",
      "Prefer Chinese content when the user instruction is Chinese.",
    ].join("\n"),
    userPrompt: [
      "Create a prompt package from this instruction:",
      instruction,
      "",
      "Return a JSON object with keys:",
      "name, description, agentMd, rubricMd, skills",
      "skills is an array of { dirName, name, description, skillMd }",
      "The agentMd should define role, workflow, boundaries, and output style.",
      "The rubricMd should define 3-6 scoring dimensions.",
      "The skillMd should be detailed reusable markdown instructions.",
    ].join("\n"),
    temperature: 0.4,
  });

  const snapshot = normalizeSnapshot(generated);

  onPreview?.({ type: "agent", name: "agent.md", content: snapshot.agentMd.slice(0, 1200) });
  onPreview?.({ type: "rubric", name: "rubric.md", content: snapshot.rubricMd.slice(0, 800) });
  for (const skill of snapshot.skills) {
    onPreview?.({ type: "skill", name: skill.name, content: skill.skillMd.slice(0, 800) });
  }

  return createPackageWithSnapshot(userId, snapshot, "generated");
}

export async function importPackageZip(userId: string, zipBuffer: Buffer) {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();
  const manifestEntry = entries.find((entry: IZipEntry) => entry.entryName.endsWith("manifest.json"));
  const agentEntry = entries.find((entry: IZipEntry) => entry.entryName.endsWith("agent.md"));
  const rubricEntry = entries.find((entry: IZipEntry) => entry.entryName.endsWith("rubric.md"));

  if (!manifestEntry || !agentEntry) {
    throw new Error("鐎电厧鍙嗛弽鐓庣础閺冪姵鏅ラ敍灞界箑妞よ瀵橀崥?manifest.json 閸?agent.md");
  }

  const manifest = JSON.parse(zip.readAsText(manifestEntry, "utf8")) as { name?: string; description?: string };

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
    name: manifest.name?.trim() || "\u5bfc\u5165\u7684\u667a\u80fd\u4f53\u5305",
    description: manifest.description?.trim() || "\u5bfc\u5165\u7684\u667a\u80fd\u4f53\u5305",
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
  const zip = new AdmZip();
  zip.addFile("manifest.json", Buffer.from(JSON.stringify({
    name: pkg.snapshot.name,
    description: pkg.snapshot.description,
    versionLabel: pkg.snapshot.versionLabel,
    exportedAt: new Date().toISOString(),
  }, null, 2)));
  zip.addFile("agent.md", Buffer.from(pkg.snapshot.agentMd));
  zip.addFile("rubric.md", Buffer.from(pkg.snapshot.rubricMd));
  for (const skill of pkg.snapshot.skills) {
    zip.addFile(`skills/${skill.dirName}/SKILL.md`, Buffer.from(skill.skillMd));
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
) {
  const { row } = await getPackageRow(userId, packageId);
  const versions = await query<DbRowPackageVersion>(
    "select * from agent_package_versions where package_id = $1 order by version_number desc limit 1",
    [packageId],
  );
  const nextVersion = (versions.rows[0]?.version_number || 0) + 1;
  const versionId = newId();
  const now = new Date().toISOString();
  const nextSnapshot = { ...snapshot, versionLabel: `v${nextVersion}` };

  await query(
    "insert into agent_package_versions (id, package_id, version_number, source, snapshot_json, created_at) values ($1, $2, $3, $4, $5, $6)",
    [versionId, packageId, nextVersion, source, JSON.stringify(nextSnapshot), now],
  );

  await query(
    "update agent_packages set name = $1, description = $2, current_version_id = $3, updated_at = $4 where id = $5 and user_id = $6",
    [nextSnapshot.name, nextSnapshot.description, versionId, now, row.id, userId],
  );

  return getPackage(userId, packageId);
}
