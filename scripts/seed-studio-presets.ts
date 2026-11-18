import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { AgentPackageSnapshot, PackageSkill } from '@educlaw/shared';
import {
  closeDbPool,
  query,
  withTransaction,
} from '../educlaw-server/src/services/db.ts';
import {
  createPackageWithSnapshotTx,
  createPackageVersionWithSnapshotTx,
} from '../educlaw-server/src/services/package-service.ts';
import {
  AGENT_TEMPLATE_PRESETS,
  ANALYSIS_SKILL_PRESETS,
  LESSON_PACK_PRESETS,
  buildLessonPackDocument,
} from '../educlaw-web/src/lib/studio-presets.ts';
import type { LessonIndexItem } from '../educlaw-web/src/lib/lessons.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiBase = process.env.EDUCLAW_API_BASE || 'http://127.0.0.1:18081';
const userId = process.env.EDUCLAW_SEED_USER_ID || '395513060934025505';
const operator =
  process.env.EDUCLAW_SEED_OPERATOR ||
  process.env.USERNAME ||
  process.env.USER ||
  'unknown';
const maintenanceLog =
  process.env.EDUCLAW_SEED_LOG ||
  path.join(root, 'docs', 'reports', 'lesson-assets-maintenance-log.md');

const lessonIndex = JSON.parse(
  fs.readFileSync(
    path.join(root, 'educlaw-web/public/lessons/index.json'),
    'utf8',
  ),
) as LessonIndexItem[];

const lessonPackages = [
  { stage: '小学', name: '小学语数英课例包（预置）' },
  { stage: '初中', name: '初中语数英课例包（预置）' },
  { stage: '高中', name: '高中语数英课例包（预置）' },
] as const;
const analysisPackageName = '课堂分析方法集（预置）';
const presetPackageNames = new Set<string>([
  ...lessonPackages.map((item) => item.name),
  analysisPackageName,
]);

interface RepositorySkill {
  id: string;
  name: string;
  dirName: string;
  packageName: string;
  currentVersionId: string | null;
  latestVersionId: string | null;
  currentVersionNumber: number | null;
  latestVersionNumber: number | null;
}

interface PackageSummary {
  id: string;
  name: string;
  description: string;
  versionNumber: number;
  updatedAt: string;
}

interface PackageDetail extends PackageSummary {
  snapshot: AgentPackageSnapshot;
}

interface AgentSkillBinding {
  skillId: string;
  skillVersionId: string;
  enabled: boolean;
  packageId: string;
  name: string;
  description: string;
  versionNumber: number;
  available: boolean;
}

interface AgentDetail {
  id: string;
  name: string;
  description: string;
  instructions: string;
  model: string;
  skills: AgentSkillBinding[];
  updatedAt: string;
  currentVersion: string;
}

interface AgentSeed {
  name: string;
  description: string;
  instructions: string;
  skillNames: string[];
}

interface DesiredPackage {
  snapshot: AgentPackageSnapshot;
  kind: 'lesson-packs' | 'analysis';
  stage?: string;
}

class HttpError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`HTTP ${status}: ${body}`);
  }
}

function lessonCatalog(pack: (typeof LESSON_PACK_PRESETS)[number]) {
  const lessons = lessonIndex.filter(
    (lesson) =>
      lesson.subject === pack.subject &&
      lesson.grade === pack.grade &&
      lesson.stage === pack.stage,
  );
  return buildLessonPackDocument(pack, lessons);
}

function snapshotForLessonPacks(
  stage: string,
  name: string,
): AgentPackageSnapshot {
  const packs = LESSON_PACK_PRESETS.filter((pack) => pack.stage === stage);
  return {
    name,
    description: `${stage}语文、数学、英语共 ${packs.length} 个课例包 Skill，覆盖 ${stage}各年级课堂 ASR 课例。`,
    versionLabel: 'v1',
    agentMd: `你是一位${stage}教研助手。根据用户选择的课例包，帮助教师定位课例、还原教学环节、分析提问链与师生话语，并给出基于原文证据的改进建议。`,
    rubricMd: '',
    skills: packs.map((pack) => ({
      id: pack.id,
      dirName: pack.id,
      name: pack.name,
      description: pack.description,
      skillMd: [pack.prompt, '', '## 课例目录', '', lessonCatalog(pack)].join(
        '\n',
      ),
    })),
  };
}

function snapshotForAnalysisSkills(): AgentPackageSnapshot {
  return {
    name: analysisPackageName,
    description: `课堂 ASR 课例分析的 ${ANALYSIS_SKILL_PRESETS.length} 个方法 Skill：${ANALYSIS_SKILL_PRESETS.map((item) => item.name).join('、')}。`,
    versionLabel: 'v1',
    agentMd:
      '你是一位课堂分析方法助手。根据教师提供的课例与分析目标，选择合适的方法 Skill，引用课例原文作为证据，并标注需要回看原文的存疑点。',
    rubricMd: '',
    skills: ANALYSIS_SKILL_PRESETS.map((preset) => ({
      id: preset.id,
      dirName: preset.id,
      name: preset.name,
      description: preset.description,
      skillMd: [
        preset.prompt,
        '',
        '## 输出结构',
        '- 课例概览',
        '- 关键片段与原文证据',
        '- 分析结论',
        '- 可执行建议',
        '- 需要教师确认或回看原文的事项',
      ].join('\n'),
    })),
  };
}

function desiredPackages(): DesiredPackage[] {
  return [
    ...lessonPackages.map((item) => ({
      snapshot: snapshotForLessonPacks(item.stage, item.name),
      kind: 'lesson-packs' as const,
      stage: item.stage,
    })),
    { snapshot: snapshotForAnalysisSkills(), kind: 'analysis' as const },
  ];
}

const SUBJECT_AGENT_ANALYSIS_SKILL_IDS = [
  'analysis-asr-cleanup',
  'analysis-lesson-segments',
  'analysis-question-chain',
  'analysis-classroom-discourse',
  'analysis-goal-alignment',
  'analysis-lesson-compare',
  'analysis-research-report',
  'analysis-unit-design',
  'analysis-learner-diagnosis',
  'analysis-classroom-observation',
];

function agentSeeds(): AgentSeed[] {
  const subjectAgentAnalysisSkillNames = SUBJECT_AGENT_ANALYSIS_SKILL_IDS.map(
    (presetId) => {
      const preset = ANALYSIS_SKILL_PRESETS.find(
        (item) => item.id === presetId,
      );
      if (!preset) throw new Error(`找不到方法 Skill：${presetId}`);
      return preset.name;
    },
  );
  return [
    ...AGENT_TEMPLATE_PRESETS.map((preset) => ({
      name: preset.name,
      description: preset.description,
      instructions: preset.prompt,
      skillNames: (preset.skillPresetIds ?? [])
        .map((presetId) =>
          ANALYSIS_SKILL_PRESETS.find((item) => item.id === presetId),
        )
        .map((item) => item?.name)
        .filter((name): name is string => Boolean(name)),
    })),
    ...(['小学', '初中', '高中'] as const).flatMap((stage) =>
      (['语文', '数学', '英语'] as const).map((subject) => {
        const packs = LESSON_PACK_PRESETS.filter(
          (pack) => pack.stage === stage && pack.subject === subject,
        );
        return {
          name: `${stage}${subject}教研 Agent`,
          description: `面向${stage}${subject}教师的教研 Agent，绑定 ${packs.length} 个年级课例包与常用课堂分析方法。`,
          instructions: [
            `你是一位${stage}${subject}教研员，服务于${stage}${subject}各年级的课堂研究。`,
            '优先根据年级从对应课例包中检索课例；如果用户没有指定年级，先追问或列出候选课例。',
            '分析必须引用课例原文作为证据；ASR 可能漏记学生发言，涉及统计与推断时要标注存疑。',
            '输出默认包含：课例概览、关键片段与原文证据、分析结论、可执行改进建议、需要回看原文的事项。',
            '不要虚构课例、学生发言或教材单元信息。',
          ].join('\n'),
          skillNames: [
            ...packs.map((pack) => pack.name),
            ...subjectAgentAnalysisSkillNames,
          ],
        };
      }),
    ),
  ];
}

const knownPresetSkillNames = new Set([
  ...LESSON_PACK_PRESETS.map((preset) => preset.name),
  ...ANALYSIS_SKILL_PRESETS.map((preset) => preset.name),
]);

function skillPackageForName(name: string): string | undefined {
  const pack = LESSON_PACK_PRESETS.find((item) => item.name === name);
  if (pack) {
    return lessonPackages.find((item) => item.stage === pack.stage)?.name;
  }
  if (ANALYSIS_SKILL_PRESETS.some((item) => item.name === name)) {
    return analysisPackageName;
  }
  return undefined;
}

async function httpJson<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${pathname}`, {
    ...init,
    headers: {
      'x-user-id': userId,
      ...(init?.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) throw new HttpError(response.status, text);
  return JSON.parse(text) as T;
}

async function listRepositorySkills(): Promise<RepositorySkill[]> {
  const items: RepositorySkill[] = [];
  let cursor: string | null = null;
  do {
    const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const page = await httpJson<{
      items: RepositorySkill[];
      nextCursor: string | null;
    }>(`/api/skills/repository?limit=100${suffix}`);
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

async function listPackages() {
  return httpJson<PackageSummary[]>('/api/packages');
}

async function getPackageDetail(packageId: string) {
  return httpJson<PackageDetail>(`/api/packages/detail?packageId=${packageId}`);
}

async function listAgents() {
  return httpJson<AgentDetail[]>('/api/agent-workspaces');
}

async function getAgent(agentId: string) {
  return httpJson<AgentDetail>(`/api/agent-workspaces/${agentId}`);
}

async function currentVersionId(packageId: string) {
  const result = await query<{ current_version_id: string }>(
    'select current_version_id from agent_packages where id = $1 and user_id = $2',
    [packageId, userId],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`找不到包的当前版本：${packageId}`);
  return String(row.current_version_id);
}

async function currentVersionNumber(packageId: string) {
  const result = await query<{ version_number: number }>(
    `select v.version_number
       from agent_packages p
       join agent_package_versions v on v.id = p.current_version_id
      where p.id = $1 and p.user_id = $2`,
    [packageId, userId],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`找不到包的当前版本号：${packageId}`);
  return Number(row.version_number);
}

function canonicalSkill(skill: PackageSkill) {
  return JSON.stringify({
    dirName: skill.dirName.trim(),
    name: skill.name.trim(),
    description: skill.description.trim(),
    skillMd: skill.skillMd.trim(),
  });
}

function canonicalSnapshot(snapshot: AgentPackageSnapshot) {
  return JSON.stringify({
    name: snapshot.name.trim(),
    description: snapshot.description.trim(),
    agentMd: snapshot.agentMd.trim(),
    rubricMd: snapshot.rubricMd.trim(),
    skills: [...snapshot.skills]
      .sort((left, right) => left.dirName.localeCompare(right.dirName, 'zh-CN'))
      .map(canonicalSkill),
  });
}

function snapshotHash(snapshot: AgentPackageSnapshot) {
  return createHash('sha256').update(canonicalSnapshot(snapshot)).digest('hex');
}

function diffSnapshot(
  current: AgentPackageSnapshot,
  desired: AgentPackageSnapshot,
) {
  const currentByDir = new Map(
    current.skills.map((skill) => [skill.dirName, skill]),
  );
  const desiredByDir = new Map(
    desired.skills.map((skill) => [skill.dirName, skill]),
  );
  const added = [...desiredByDir.keys()].filter(
    (key) => !currentByDir.has(key),
  );
  const removed = [...currentByDir.keys()].filter(
    (key) => !desiredByDir.has(key),
  );
  const updated = [...desiredByDir.keys()].filter((key) => {
    const before = currentByDir.get(key);
    const after = desiredByDir.get(key);
    return before && after && canonicalSkill(before) !== canonicalSkill(after);
  });
  return { added, removed, updated };
}

function lessonCountFromSnapshot(snapshot: AgentPackageSnapshot) {
  return snapshot.skills
    .filter((skill) => skill.dirName.startsWith('lesson-pack-'))
    .reduce((total, skill) => {
      const match = skill.skillMd.match(/课例数量：(\d+) 节/);
      return total + (match ? Number(match[1]) : 0);
    }, 0);
}

function desiredLessonCount(pkg: DesiredPackage) {
  if (pkg.kind !== 'lesson-packs' || !pkg.stage) return 0;
  return lessonIndex.filter((lesson) => lesson.stage === pkg.stage).length;
}

function escapeCell(value: string) {
  return value.replace(/\|/g, '\\|').replace(/\n+/g, ' ');
}

function appendMaintenanceLog(rows: string[][]) {
  if (rows.length === 0) return;
  fs.mkdirSync(path.dirname(maintenanceLog), { recursive: true });
  if (!fs.existsSync(maintenanceLog)) {
    fs.writeFileSync(
      maintenanceLog,
      [
        '# 课例资产维护记录',
        '',
        '> 由 `scripts/seed-studio-presets.ts` 在执行正式写库时追加。',
        '',
        '| 时间 | 批次 | 对象 | 版本 | Skill 数 | 课例数 | 执行人 | 备注 |',
        '| --- | --- | --- | --- | --- | --- | --- | --- |',
        '',
      ].join('\n'),
      'utf8',
    );
  }
  fs.appendFileSync(
    maintenanceLog,
    rows.map((row) => `| ${row.map(escapeCell).join(' | ')} |`).join('\n') +
      '\n',
    'utf8',
  );
}

function resolveRepositorySkill(
  repository: RepositorySkill[],
  name: string,
  allowMissing = false,
) {
  const preferredPackage = skillPackageForName(name);
  const candidates = repository.filter((skill) => skill.name === name);
  const chosen =
    candidates.find((skill) => skill.packageName === preferredPackage) ||
    candidates.find((skill) => presetPackageNames.has(skill.packageName)) ||
    candidates[0];
  if (!chosen) {
    if (allowMissing) {
      return {
        skillId: `pending:${name}`,
        skillVersionId: '0',
        enabled: true,
        versionNumber: 0,
        pending: true,
      };
    }
    throw new Error(`仓库中找不到预置 Skill：${name}`);
  }
  const versionId = chosen.currentVersionId || chosen.latestVersionId;
  if (!versionId) {
    if (allowMissing) {
      return {
        skillId: `pending:${name}`,
        skillVersionId: '0',
        enabled: true,
        versionNumber: 0,
        pending: true,
      };
    }
    throw new Error(`Skill 没有可用版本：${name}`);
  }
  return {
    skillId: chosen.id,
    skillVersionId: versionId,
    enabled: true,
    versionNumber:
      chosen.currentVersionNumber ?? chosen.latestVersionNumber ?? 0,
    pending: false,
  };
}

async function createAgent(seed: AgentSeed, repository: RepositorySkill[]) {
  const bindings = seed.skillNames.map((name) =>
    resolveRepositorySkill(repository, name),
  );
  const response = await fetch(`${apiBase}/api/agent-workspaces`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-user-id': userId,
    },
    body: JSON.stringify({
      name: seed.name,
      description: seed.description,
      instructions: seed.instructions,
      model: '',
      skills: bindings.map((binding) => ({
        skillId: binding.skillId,
        skillVersionId: binding.skillVersionId,
        enabled: true,
      })),
    }),
  });
  if (!response.ok) {
    throw new Error(
      `创建 Agent 失败：${seed.name} ${response.status} ${await response.text()}`,
    );
  }
  const created = (await response.json()) as AgentDetail;
  console.log(`created agent: ${seed.name} (${bindings.length} skills)`);
  return created;
}

function buildAgentBindings(
  detail: AgentDetail,
  seed: AgentSeed,
  repository: RepositorySkill[],
  allowMissing = false,
) {
  const presetNames = new Set(seed.skillNames);
  const userSkills = detail.skills.filter(
    (skill) => !presetNames.has(skill.name),
  );
  const unavailable = userSkills.filter(
    (skill) => skill.enabled && !skill.available,
  );
  if (unavailable.length > 0) {
    throw new Error(
      `用户自建 Skill 不可用，未重绑定：${unavailable.map((skill) => skill.name).join('、')}`,
    );
  }
  const presetBindings = seed.skillNames.map((name) =>
    resolveRepositorySkill(repository, name, allowMissing),
  );
  return {
    presetBindings,
    userSkills,
    bindings: [
      ...presetBindings.map((binding) => ({
        skillId: binding.skillId,
        skillVersionId: binding.skillVersionId,
        enabled: true,
      })),
      ...userSkills.map((skill) => ({
        skillId: skill.skillId,
        skillVersionId: skill.skillVersionId,
        enabled: skill.enabled,
      })),
    ],
  };
}

async function rebindAgents(
  repository: RepositorySkill[],
  options: { dryRun: boolean; batch: string; note: string },
) {
  const agents = await listAgents();
  const logRows: string[][] = [];
  let changed = 0;

  for (const seed of agentSeeds()) {
    const existing = agents.find((agent) => agent.name === seed.name);
    if (!existing) {
      if (options.dryRun) {
        console.log(`agent 将创建: ${seed.name}`);
      } else {
        const created = await createAgent(seed, repository);
        logRows.push([
          new Date().toISOString(),
          options.batch,
          `Agent：${seed.name}`,
          'v0 -> v1',
          `${created.skills.length}`,
          '—',
          operator,
          `新建预置 Agent；${options.note}`,
        ]);
      }
      continue;
    }

    let detail = await getAgent(existing.id);
    const first = buildAgentBindings(detail, seed, repository, options.dryRun);
    const currentPreset = detail.skills.filter((skill) =>
      seed.skillNames.includes(skill.name),
    );
    const knownPresetPresent = detail.skills.filter((skill) =>
      knownPresetSkillNames.has(skill.name),
    );
    const added = seed.skillNames.filter(
      (name) => !currentPreset.some((skill) => skill.name === name),
    );
    const removed = knownPresetPresent.filter(
      (skill) => !seed.skillNames.includes(skill.name),
    );
    const versionChanged = currentPreset.filter((skill) => {
      const resolved = resolveRepositorySkill(
        repository,
        skill.name,
        options.dryRun,
      );
      return skill.versionNumber !== resolved.versionNumber;
    });

    const needsRebind =
      added.length > 0 || removed.length > 0 || versionChanged.length > 0;
    console.log(
      [
        `agent ${seed.name}:`,
        `预置重绑定 ${currentPreset.length}`,
        `新增 ${added.length}`,
        `预置方案外 ${removed.length}`,
        `版本变化 ${versionChanged.length}`,
        `保留用户 Skill ${first.userSkills.length}`,
        `绑定总数 ${first.bindings.length}`,
        needsRebind ? '' : '已是最新版本',
      ]
        .filter(Boolean)
        .join(' '),
    );

    if (options.dryRun || !needsRebind) continue;

    let savedAgent: AgentDetail | null = null;
    let beforeVersionNumber = await currentVersionNumber(detail.id);
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const built = buildAgentBindings(detail, seed, repository);
      const response = await fetch(
        `${apiBase}/api/agent-workspaces/${detail.id}`,
        {
          method: 'PUT',
          headers: {
            'content-type': 'application/json',
            'x-user-id': userId,
          },
          body: JSON.stringify({
            name: detail.name,
            description: detail.description,
            instructions: detail.instructions,
            model: detail.model,
            skills: built.bindings,
            expectedUpdatedAt: detail.updatedAt,
          }),
        },
      );
      if (response.ok) {
        savedAgent = (await response.json()) as AgentDetail;
        break;
      }
      const body = await response.text();
      lastError = new Error(
        `重绑定失败：${seed.name} ${response.status} ${body}`,
      );
      if (response.status !== 409) break;
      // 409 说明有人同时在编辑：重新读取最新配置后再合并，不盲写。
      detail = await getAgent(existing.id);
      beforeVersionNumber = await currentVersionNumber(detail.id);
    }
    if (!savedAgent) throw lastError;
    changed += 1;
    const afterVersionNumber = await currentVersionNumber(detail.id);
    logRows.push([
      new Date().toISOString(),
      options.batch,
      `Agent：${seed.name}`,
      `v${beforeVersionNumber} -> v${afterVersionNumber}`,
      `${savedAgent.skills.length}`,
      '—',
      operator,
      `预置重绑定 ${currentPreset.length}，保留用户 Skill ${first.userSkills.length}；${options.note}`,
    ]);
  }

  if (!options.dryRun && changed > 0) appendMaintenanceLog(logRows);
  return changed;
}

async function seedPackages(options: {
  update: boolean;
  dryRun: boolean;
  batch: string;
  note: string;
}) {
  const packages = await listPackages();
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  const logRows: string[][] = [];
  let changed = 0;

  for (const desired of desiredPackages()) {
    const snapshot = desired.snapshot;
    const existing = byName.get(snapshot.name);
    if (!existing) {
      console.log(
        `package 将创建: ${snapshot.name} (${snapshot.skills.length} skills)`,
      );
      if (options.dryRun) continue;
      const created = await withTransaction((client) =>
        createPackageWithSnapshotTx(client, userId, snapshot, 'imported'),
      );
      changed += 1;
      logRows.push([
        new Date().toISOString(),
        options.batch,
        snapshot.name,
        `v0 -> v${created.packageVersionNumber}`,
        `0 -> ${snapshot.skills.length}`,
        `0 -> ${desiredLessonCount(desired)}`,
        operator,
        options.note,
      ]);
      continue;
    }

    const detail = await getPackageDetail(existing.id);
    if (snapshotHash(detail.snapshot) === snapshotHash(snapshot)) {
      console.log(
        `package 无变化: ${snapshot.name} (v${detail.versionNumber})`,
      );
      continue;
    }

    const diff = diffSnapshot(detail.snapshot, snapshot);
    const nextVersion = detail.versionNumber + 1;
    console.log(
      [
        `package ${snapshot.name}:`,
        `v${detail.versionNumber} -> v${nextVersion}`,
        `新增 ${diff.added.length}`,
        `更新 ${diff.updated.length}`,
        `移除 ${diff.removed.length}`,
        `Skill 总数 ${detail.snapshot.skills.length} -> ${snapshot.skills.length}`,
      ].join(' '),
    );
    if (diff.added.length) console.log(`  added: ${diff.added.join(', ')}`);
    if (diff.updated.length)
      console.log(`  updated: ${diff.updated.join(', ')}`);
    if (diff.removed.length)
      console.log(`  removed: ${diff.removed.join(', ')}`);

    if (!options.update) {
      console.log('  内容有变化，但未传 --update，跳过写库');
      continue;
    }
    if (options.dryRun) continue;

    const expectedPackageVersionId = await currentVersionId(existing.id);
    const result = await withTransaction((client) =>
      createPackageVersionWithSnapshotTx(client, {
        userId,
        packageId: existing.id,
        expectedPackageVersionId,
        snapshot,
        source: 'imported',
        note: options.note,
      }),
    );
    changed += 1;
    logRows.push([
      new Date().toISOString(),
      options.batch,
      snapshot.name,
      `v${detail.versionNumber} -> v${result.packageVersionNumber}`,
      `${detail.snapshot.skills.length} -> ${snapshot.skills.length}`,
      `${lessonCountFromSnapshot(detail.snapshot)} -> ${desiredLessonCount(desired)}`,
      operator,
      options.note,
    ]);
  }

  if (!options.dryRun && changed > 0) appendMaintenanceLog(logRows);
  return changed;
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name: string) => argv.includes(name);
  const option = (name: string) => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const dryRun = flag('--dry-run');
  const all = flag('--all');
  const update = all || flag('--update');
  const rebind = all || flag('--rebind-agents');
  const batch = option('--batch') || new Date().toISOString().slice(0, 10);
  const note = option('--note') || `课例数据 ${batch} 更新`;
  const previewUpdate = update || dryRun;
  const previewRebind = rebind || dryRun;

  console.log(
    [
      `seed mode: ${dryRun ? 'dry-run' : 'write'}`,
      `update=${previewUpdate}`,
      `rebindAgents=${previewRebind}`,
      `batch=${batch}`,
      `api=${apiBase}`,
      `user=${userId}`,
    ].join(' '),
  );

  try {
    const packagesChanged = await seedPackages({
      update: previewUpdate,
      dryRun,
      batch,
      note,
    });
    if (previewRebind) {
      const repository = await listRepositorySkills();
      const agentsChanged = await rebindAgents(repository, {
        dryRun,
        batch,
        note,
      });
      console.log(
        `${dryRun ? 'dry-run complete' : 'seed complete'}: ` +
          `${packagesChanged} packages changed, ${agentsChanged} agents rebound`,
      );
    } else {
      console.log(
        `${dryRun ? 'dry-run complete' : 'seed complete'}: ` +
          `${packagesChanged} packages changed, agents skipped`,
      );
    }
    if (!dryRun) console.log(`maintenance log: ${maintenanceLog}`);
  } finally {
    await closeDbPool();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
