import type {
  AgentWorkspace,
  AgentWorkspaceInput,
  AgentExecutionSnapshot,
  ArenaThread,
  SkillArenaConfig,
  PackageSkill,
  AgentPackageSnapshot,
} from '@educlaw/shared';
import { query, withTransaction, type Queryable } from './db.js';
import { getThreadDetail } from './arena-service.js';
import {
  createPackageWithSnapshotTx,
  createPackageVersionWithSnapshotTx,
  PackageVersionConflictError,
} from './package-service.js';
import { parseDbJson } from '../utils/json.js';
import { config as serverConfig } from '../config.js';

export class AgentWorkspaceError extends Error {
  constructor(
    message: string,
    public status = 422,
    public code = 'INVALID_ARGUMENT',
  ) {
    super(message);
  }
}

type PackageRow = {
  id: string;
  user_id: string;
  name: string;
  description: string;
  model: string | null;
  current_version_id: string;
  created_at: Date | string;
  updated_at: Date | string;
  source_session_id?: string | null;
};

type SkillLinkRow = {
  skill_id: string;
  skill_version_id: string;
  skill_uid: string;
  dir_name: string;
  name: string;
  description: string;
  version_number: number;
  status: string;
  skill_status: string;
  skill_snapshot_json: PackageSkill | string;
};

const timestamp = (value: Date | string) => new Date(value).toISOString();

const emptySnapshot = (): AgentPackageSnapshot => ({
  name: '',
  description: '',
  versionLabel: '',
  agentMd: '',
  rubricMd: '',
  skills: [],
});

export function parseAgentInput(raw: unknown): AgentWorkspaceInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new AgentWorkspaceError('Agent 配置不能为空');
  const body = raw as Record<string, unknown>;
  const text = (key: string, max: number, required = false) => {
    const value = body[key] ?? '';
    if (
      typeof value !== 'string' ||
      value.length > max ||
      (required && !value.trim())
    )
      throw new AgentWorkspaceError(`${key} 格式不正确`);
    return value.trim();
  };
  if (!Array.isArray(body.skills) || body.skills.length > 20)
    throw new AgentWorkspaceError('每个 Agent 最多挂载 20 个 Skill');
  const skills = body.skills.map((rawBinding: unknown) => {
    if (!rawBinding || typeof rawBinding !== 'object')
      throw new AgentWorkspaceError('Skill 配置无效');
    const binding = rawBinding as Record<string, unknown>;
    for (const key of ['skillId', 'skillVersionId']) {
      if (
        typeof binding[key] !== 'string' ||
        !/^[1-9]\d*$/.test(binding[key] as string) ||
        !Number.isSafeInteger(Number(binding[key]))
      )
        throw new AgentWorkspaceError('Skill 与版本标识无效');
    }
    if (typeof binding.enabled !== 'boolean')
      throw new AgentWorkspaceError('Skill 启用状态无效');
    return {
      skillId: binding.skillId as string,
      skillVersionId: binding.skillVersionId as string,
      enabled: binding.enabled,
    };
  });
  if (new Set(skills.map((s) => s.skillId)).size !== skills.length)
    throw new AgentWorkspaceError('不能重复挂载同一个 Skill');
  return {
    name: text('name', 100, true),
    description: text('description', 2000),
    instructions: text('instructions', 16000),
    model: text('model', 256),
    skills,
  };
}

const isId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[1-9]\d*$/.test(value) &&
  Number.isSafeInteger(Number(value));

/** Agent 就是包：所有读写都落在 agent_packages 上。 */
async function ownedPackage(
  db: Queryable,
  userId: string,
  id: string,
  lock = false,
): Promise<PackageRow> {
  if (!isId(id)) throw new AgentWorkspaceError('Agent 标识无效');
  const result = await db.query<PackageRow>(
    `select * from agent_packages where id = $1 and user_id = $2${lock ? ' for update' : ''}`,
    [id, userId],
  );
  if (!result.rows[0])
    throw new AgentWorkspaceError('Agent 不存在', 404, 'AGENT_NOT_FOUND');
  return result.rows[0];
}

async function loadSnapshot(
  db: Queryable,
  pkg: PackageRow,
): Promise<AgentPackageSnapshot> {
  const result = await db.query<{
    snapshot_json: AgentPackageSnapshot | string;
  }>(
    'select snapshot_json from agent_package_versions where id = $1 and package_id = $2',
    [pkg.current_version_id, pkg.id],
  );
  return parseDbJson(result.rows[0]?.snapshot_json, emptySnapshot());
}

/** 读取当前包版本挂载的 Skill，skillId / skillVersionId 可直接回传给前端。 */
async function resolvePackageSkills(
  db: Queryable,
  pkg: PackageRow,
  snapshot?: AgentPackageSnapshot,
): Promise<
  Array<
    AgentExecutionSnapshot['skills'][number] & {
      enabled: boolean;
      available: boolean;
    }
  >
> {
  const versionSnapshot = snapshot ?? (await loadSnapshot(db, pkg));
  const enabledById = new Map<string, boolean>(
    (versionSnapshot.skills ?? []).map((skill) => [
      String(skill.id),
      skill.enabled !== false,
    ]),
  );
  const result = await db.query<SkillLinkRow>(
    `select link.skill_id, link.skill_version_id, s.skill_uid, s.dir_name,
            coalesce(nullif(s.display_name, ''), s.name) as name, s.description,
            sv.version_number, sv.status, s.status as skill_status,
            sv.skill_snapshot_json
       from agent_package_version_skills link
       join agent_package_skills s
         on s.id = link.skill_id and s.package_id = link.package_id
       join agent_skill_versions sv
         on sv.id = link.skill_version_id and sv.package_id = link.package_id
      where link.package_id = $1 and link.package_version_id = $2
      order by link.sort_order asc, link.skill_id asc`,
    [pkg.id, pkg.current_version_id],
  );
  return result.rows.map((row) => {
    const snapshot = parseDbJson<Partial<PackageSkill>>(
      row.skill_snapshot_json,
      {},
    );
    const skillMd =
      typeof snapshot.skillMd === 'string' ? snapshot.skillMd : '';
    return {
      skillId: String(row.skill_id),
      skillVersionId: String(row.skill_version_id),
      enabled: enabledById.get(row.skill_uid) !== false,
      packageId: String(pkg.id),
      packageVersionId: String(pkg.current_version_id),
      skillUid: row.skill_uid,
      name: row.name,
      description: row.description || snapshot.description || '',
      versionNumber: Number(row.version_number),
      skillMd,
      available:
        row.status === 'active' &&
        row.skill_status === 'active' &&
        skillMd.trim().length > 0,
    };
  });
}

async function toAgent(
  db: Queryable,
  pkg: PackageRow,
): Promise<AgentWorkspace> {
  const snapshot = await loadSnapshot(db, pkg);
  const skills = await resolvePackageSkills(db, pkg, snapshot);
  return {
    id: String(pkg.id),
    name: pkg.name,
    description: pkg.description,
    instructions: snapshot.agentMd || '',
    model: pkg.model || '',
    skills: skills.map((skill) => ({
      skillId: skill.skillId,
      skillVersionId: skill.skillVersionId,
      enabled: skill.enabled,
      packageId: skill.packageId,
      name: skill.name,
      description: skill.description,
      versionNumber: skill.versionNumber,
      available: skill.available,
    })),
    createdAt: timestamp(pkg.created_at),
    updatedAt: timestamp(pkg.updated_at),
    currentVersion: String(pkg.current_version_id),
    sourceSessionId: pkg.source_session_id
      ? String(pkg.source_session_id)
      : snapshot.sourceSessionId || null,
  };
}

export async function listAgents(userId: string) {
  const rows = await query<PackageRow>(
    'select * from agent_packages where user_id = $1 order by updated_at desc, id desc',
    [userId],
  );
  return Promise.all(rows.rows.map((row) => toAgent({ query }, row)));
}

export async function getAgent(userId: string, id: string) {
  return toAgent({ query }, await ownedPackage({ query }, userId, id));
}

/**
 * 把前端选择的 Skill 版本内容整理成包快照。
 * 包即 Agent，因此跨包选中的 Skill 会在保存时复制进当前 Agent 包。
 * 停用的 Skill 也需要保留在快照里，否则再次保存后复选框会消失；
 * 只有停用且版本已不可用时才安全跳过。
 */
async function buildSnapshotSkills(
  db: Queryable,
  userId: string,
  bindings: AgentWorkspaceInput['skills'],
): Promise<PackageSkill[]> {
  const skills: PackageSkill[] = [];
  for (const binding of bindings) {
    const result = await db.query<{
      skill_uid: string;
      dir_name: string;
      display_name: string | null;
      description: string;
      version_number: number;
      status: string;
      skill_status: string;
      skill_snapshot_json: PackageSkill | string;
      package_id: string;
      skill_id: string;
      origin_package_id?: string | null;
      origin_skill_id?: string | null;
    }>(
      `select s.skill_uid, s.dir_name, s.display_name, s.description,
              sv.version_number, sv.status, s.status as skill_status,
              sv.skill_snapshot_json, s.package_id, s.id as skill_id, s.origin_package_id, s.origin_skill_id
         from agent_skill_versions sv
         join agent_package_skills s
           on s.id = sv.skill_id and s.package_id = sv.package_id
         join agent_packages p on p.id = s.package_id
        where sv.id = $1 and sv.skill_id = $2 and p.user_id = $3`,
      [binding.skillVersionId, binding.skillId, userId],
    );
    const row = result.rows[0];
    if (!row || row.status !== 'active' || row.skill_status !== 'active') {
      if (!binding.enabled) continue;
      throw new AgentWorkspaceError(
        '挂载的 Skill 或版本不可用，请重新选择',
        422,
        'SKILL_UNAVAILABLE',
      );
    }
    const snapshot = parseDbJson<Partial<PackageSkill>>(
      row.skill_snapshot_json,
      {},
    );
    const skillMd =
      typeof snapshot.skillMd === 'string' ? snapshot.skillMd : '';
    if (!skillMd.trim()) {
      if (!binding.enabled) continue;
      throw new AgentWorkspaceError('Skill 内容为空');
    }
    if (
      skills.some(
        (skill) =>
          skill.id === row.skill_uid ||
          skill.dirName === (snapshot.dirName || row.dir_name),
      )
    )
      throw new AgentWorkspaceError(
        '所选 Skill 的标识或目录重名，请先在来源 Skill 中修改标识后重试',
      );
    skills.push({
      id: row.skill_uid,
      dirName: (snapshot.dirName || row.dir_name || '').trim(),
      name: row.display_name?.trim() || snapshot.name || row.skill_uid,
      description: snapshot.description || row.description || '',
      skillMd,
      enabled: binding.enabled,
      originPackageId:
        row.origin_package_id ||
        snapshot.originPackageId ||
        String(row.package_id),
      originSkillId:
        row.origin_skill_id || snapshot.originSkillId || String(row.skill_id),
    });
  }
  return skills;
}

export async function saveAgent(userId: string, raw: unknown, id?: string) {
  const input = parseAgentInput(raw);
  return withTransaction(async (client) => {
    const current = id ? await ownedPackage(client, userId, id, true) : null;
    if (current) {
      const expected = (raw as Record<string, unknown>).expectedUpdatedAt;
      if (
        typeof expected !== 'string' ||
        expected !== timestamp(current.updated_at)
      )
        throw new AgentWorkspaceError(
          'Agent 配置已更新，请重新加载后保存',
          409,
          'AGENT_CONFLICT',
        );
    }
    const skills = await buildSnapshotSkills(client, userId, input.skills);
    const currentSnapshot = current
      ? await loadSnapshot(client, current)
      : null;
    const snapshot: AgentPackageSnapshot = {
      name: input.name,
      description: input.description,
      versionLabel: currentSnapshot?.versionLabel || '',
      agentMd: input.instructions,
      rubricMd: currentSnapshot?.rubricMd || '',
      skills,
      ...(currentSnapshot?.sourceSessionId
        ? { sourceSessionId: currentSnapshot.sourceSessionId }
        : {}),
    };
    try {
      const saved = current
        ? await createPackageVersionWithSnapshotTx(client, {
            userId,
            packageId: current.id,
            expectedPackageVersionId: current.current_version_id,
            snapshot,
            source: 'manual',
            note: 'Agent 配置更新',
            model: input.model,
          })
        : await createPackageWithSnapshotTx(
            client,
            userId,
            snapshot,
            'manual',
            input.model,
          );
      return toAgent(
        client,
        await ownedPackage(client, userId, String(saved.packageId)),
      );
    } catch (error) {
      if (error instanceof PackageVersionConflictError)
        throw new AgentWorkspaceError(
          'Agent 配置已更新，请重新加载后保存',
          409,
          'AGENT_CONFLICT',
        );
      throw error;
    }
  });
}

/**
 * 把已有产物转成 Agent：生成的包或仓库中的 Skill 所归属的包。
 * 包本身已是 Agent，重复调用只会返回同一个包。
 */
export async function provisionAgent(
  userId: string,
  raw: unknown,
): Promise<AgentWorkspace> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new AgentWorkspaceError('Agent 来源不能为空');
  const body = raw as Record<string, unknown>;
  const sessionId =
    typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  const requestedSkillId =
    typeof body.skillId === 'string' ? body.skillId.trim() : '';
  if (!!sessionId === !!requestedSkillId)
    throw new AgentWorkspaceError('请提供且仅提供一个 Agent 来源');
  if (!isId(sessionId || requestedSkillId))
    throw new AgentWorkspaceError('Agent 来源标识无效');

  let packageId = '';
  if (sessionId) {
    const session = await query<Record<string, unknown>>(
      `select status, package_id, skill_id
         from skill_guided_creation_sessions
        where id = $1 and user_id = $2 and deleted_at is null`,
      [sessionId, userId],
    );
    const row = session.rows[0];
    if (!row)
      throw new AgentWorkspaceError('创建会话不存在', 404, 'SESSION_NOT_FOUND');
    if (row.status !== 'completed')
      throw new AgentWorkspaceError(
        '该会话尚未完成生成，请稍后再试',
        409,
        'SESSION_NOT_READY',
      );
    if (row.package_id) packageId = String(row.package_id);
    else if (row.skill_id) {
      const owner = await query<{ package_id: string }>(
        `select s.package_id from agent_package_skills s
           join agent_packages p on p.id = s.package_id
          where s.id = $1 and p.user_id = $2`,
        [String(row.skill_id), userId],
      );
      packageId = owner.rows[0]?.package_id || '';
    }
  } else {
    const owner = await query<{ package_id: string }>(
      `select s.package_id from agent_package_skills s
         join agent_packages p on p.id = s.package_id
        where s.id = $1 and p.user_id = $2`,
      [requestedSkillId, userId],
    );
    packageId = owner.rows[0]?.package_id || '';
  }
  if (!packageId)
    throw new AgentWorkspaceError(
      'Skill 或版本不可用，请重新选择',
      422,
      'SKILL_UNAVAILABLE',
    );
  // 旧 skill-only 包原地补全 Agent 默认配置，不复制 Skill 实体。
  return withTransaction(async (client) => {
    let pkg = await ownedPackage(client, userId, packageId, true);
    const snapshot = await loadSnapshot(client, pkg);
    if (!snapshot.agentMd.trim() || !pkg.model?.trim()) {
      await createPackageVersionWithSnapshotTx(client, {
        userId,
        packageId: pkg.id,
        expectedPackageVersionId: pkg.current_version_id,
        snapshot: {
          ...snapshot,
          agentMd:
            snapshot.agentMd.trim() ||
            '你是一位教学助手。遵循已启用 Skill 的工作方法完成教学任务；信息不足时先询问，并明确说明依据与边界。',
        },
        source: 'manual',
        note: '历史 Skill 转为 Agent',
        model: pkg.model?.trim() || serverConfig.llmModel,
      });
      pkg = await ownedPackage(client, userId, packageId);
    }
    return toAgent(client, pkg);
  });
}

export async function listAgentConversations(userId: string, id: string) {
  await ownedPackage({ query }, userId, id);
  const rows = await query<{ id: string }>(
    `select id from arena_threads
      where user_id = $1 and package_id = $2 and arena_kind = 'skill_arena'
        and arena_config_jsonb->>'agentRequestId' is not null
      order by updated_at desc, id desc`,
    [userId, id],
  );
  return Promise.all(
    rows.rows.map(async (row) => {
      const detail = await getThreadDetail(userId, String(row.id));
      return detail.thread;
    }),
  );
}

export async function createAgentConversation(
  userId: string,
  id: string,
  raw: unknown,
): Promise<ArenaThread> {
  const body = raw as { purpose?: unknown; requestId?: unknown } | null;
  if (
    !body ||
    (body.purpose !== 'run' && body.purpose !== 'test') ||
    typeof body.requestId !== 'string' ||
    !body.requestId.trim() ||
    body.requestId.length > 120
  )
    throw new AgentWorkspaceError('对话类型或请求标识无效');
  const purpose = body.purpose;
  const requestId = body.requestId.trim();
  const conversation = await withTransaction(async (client) => {
    const agent = await ownedPackage(client, userId, id, true);
    const existing = await client.query<{
      id: string;
      arena_config_jsonb: SkillArenaConfig | string;
    }>(
      `select id, arena_config_jsonb from arena_threads
        where user_id = $1 and package_id = $2
          and arena_config_jsonb->>'agentRequestId' = $3
        limit 1`,
      [userId, id, requestId],
    );
    const replay = existing.rows[0];
    if (replay) {
      const config = parseDbJson<SkillArenaConfig | null>(
        replay.arena_config_jsonb,
        null,
      );
      if ((config?.surface || 'run') !== purpose)
        throw new AgentWorkspaceError(
          '请求标识已用于其他对话类型',
          409,
          'IDEMPOTENCY_CONFLICT',
        );
      return String(replay.id);
    }

    const snapshot = await loadSnapshot(client, agent);
    const skills = await resolvePackageSkills(client, agent, snapshot);
    const enabledSkills = skills.filter((skill) => skill.enabled);
    // Deleted links must not silently turn a partially mounted Agent into a
    // different execution. The package snapshot records every intended binding.
    const missingEnabledSkill = (snapshot.skills ?? []).some(
      (skill) =>
        skill.enabled !== false &&
        !skills.some((resolved) => resolved.skillUid === String(skill.id)),
    );
    if (missingEnabledSkill || enabledSkills.some((skill) => !skill.available))
      throw new AgentWorkspaceError(
        '该 Agent 的部分 Skill 或固定版本已不可用，请重新保存配置',
        422,
        'SKILL_UNAVAILABLE',
      );
    if (!enabledSkills.length)
      throw new AgentWorkspaceError(
        '请到 Agent 编辑配置中启用至少一个 Skill，再开始对话',
        422,
        'NO_ENABLED_SKILLS',
      );
    const model = agent.model?.trim() || serverConfig.llmModel;
    const execution: AgentExecutionSnapshot = {
      agentId: String(agent.id),
      name: agent.name,
      instructions: snapshot.agentMd || '',
      model,
      skills: enabledSkills.map((skill) => ({
        skillId: skill.skillId,
        skillVersionId: skill.skillVersionId,
        enabled: true,
        packageId: String(agent.id),
        name: skill.name,
        description: skill.description,
        versionNumber: skill.versionNumber,
        available: true,
        packageVersionId: String(agent.current_version_id),
        skillUid: skill.skillUid,
        skillMd: skill.skillMd,
      })),
    };
    const first = execution.skills[0]!;
    const config: SkillArenaConfig = {
      mode: 'skill_arena',
      compositionMode: 'skill_only',
      surface: purpose,
      agentRequestId: requestId,
      basePackageVersionId: String(agent.current_version_id),
      left: null,
      right: {
        side: 'right',
        skillId: first.skillId,
        skillVersionId: first.skillVersionId,
        skillUid: first.skillUid,
        skillName: first.name,
        versionNumber: first.versionNumber,
      },
      agentExecution: execution,
    };
    const now = new Date().toISOString();
    const title = `${agent.name} · ${purpose === 'test' ? '测试' : '对话'}`;
    const result = await client.query<{ id: string }>(
      `insert into arena_threads (user_id,package_id,title,model,arena_kind,base_package_version_id,arena_config_jsonb,created_at,updated_at)
      values ($1,$2,$3,$4,'skill_arena',$5,$6,$7,$7) returning id`,
      [
        userId,
        agent.id,
        title,
        model,
        String(agent.current_version_id),
        JSON.stringify(config),
        now,
      ],
    );
    const threadId = result.rows[0]!.id;
    await client.query(
      "insert into arena_thread_variants (thread_id,package_id,side,skill_id,skill_version_id,created_at) values ($1,$2,'right',$3,$4,$5)",
      [threadId, agent.id, first.skillId, first.skillVersionId, now],
    );
    return {
      id: Number(threadId),
      packageId: Number(agent.id),
      title,
      model,
      arenaKind: 'skill_arena',
      basePackageVersionId: String(agent.current_version_id),
      skillArenaConfig: config,
      createdAt: now,
      updatedAt: now,
    } satisfies ArenaThread;
  });
  // Release the transaction/Agent row lock before loading a replay through the
  // pool. Concurrent retries waiting on that lock can otherwise occupy every
  // connection while this owner waits for a separate detail-read connection.
  return typeof conversation === 'string'
    ? (await getThreadDetail(userId, conversation)).thread
    : conversation;
}
