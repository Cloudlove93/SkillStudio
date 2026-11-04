import type {
  AgentWorkspace,
  AgentWorkspaceInput,
  AgentExecutionSnapshot,
  ArenaThread,
  SkillArenaConfig,
  PackageSkill,
} from '@educlaw/shared';
import { query, withTransaction, type Queryable } from './db.js';
import { getThreadDetail } from './arena-service.js';

export class AgentWorkspaceError extends Error {
  constructor(
    message: string,
    public status = 422,
    public code = 'INVALID_ARGUMENT',
  ) {
    super(message);
  }
}
type AgentRow = {
  id: string;
  user_id: string;
  name: string;
  description: string;
  instructions: string;
  model: string;
  skills_json: AgentWorkspaceInput['skills'];
  created_at: Date | string;
  updated_at: Date | string;
};
const timestamp = (value: Date | string) => new Date(value).toISOString();
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
async function ownedAgent(
  db: Queryable,
  userId: string,
  id: string,
  lock = false,
) {
  if (!/^[1-9]\d*$/.test(id)) throw new AgentWorkspaceError('Agent 标识无效');
  const result = await db.query<AgentRow>(
    `select * from user_agents where id = $1 and user_id = $2${lock ? ' for update' : ''}`,
    [id, userId],
  );
  if (!result.rows[0])
    throw new AgentWorkspaceError('Agent 不存在', 404, 'AGENT_NOT_FOUND');
  return result.rows[0];
}
async function resolveSkills(
  db: Queryable,
  userId: string,
  bindings: AgentWorkspaceInput['skills'],
  requireActive: boolean,
) {
  const resolved: AgentExecutionSnapshot['skills'] = [];
  for (const binding of bindings) {
    const result = await db.query<{
      package_id: string;
      current_version_id: string;
      created_in_package_version_id?: string;
      skill_uid: string;
      version_number: number;
      skill_snapshot_json: PackageSkill;
      status: string;
      skill_status: string;
      display_name: string | null;
    }>(
      `select sv.package_id, sv.created_in_package_version_id, p.current_version_id, s.skill_uid, sv.version_number, sv.skill_snapshot_json,
        sv.status, s.status as skill_status, s.display_name
       from agent_skill_versions sv join agent_package_skills s on s.id = sv.skill_id and s.package_id = sv.package_id
       join agent_packages p on p.id = sv.package_id
       where sv.id = $1 and sv.skill_id = $2 and p.user_id = $3${requireActive ? ' for share of p, s, sv' : ''}`,
      [binding.skillVersionId, binding.skillId, userId],
    );
    const row = result.rows[0];
    const skill = row?.skill_snapshot_json;
    if (!row || row.status !== 'active' || row.skill_status !== 'active') {
      if (requireActive)
        throw new AgentWorkspaceError(
          '挂载的 Skill 或版本不可用，请重新选择',
          422,
          'SKILL_UNAVAILABLE',
        );
      // Listing keeps the binding so the Agent can be repaired instead of failing the whole list.
      resolved.push({
        ...binding,
        packageId: row ? String(row.package_id) : '',
        packageVersionId: row
          ? String(
              row.created_in_package_version_id ?? row.current_version_id,
            )
          : '',
        skillUid: row?.skill_uid ?? '',
        name: row?.display_name || `Skill ${binding.skillId}`,
        description: '挂载的 Skill 已不可用，请重新选择版本。',
        versionNumber: row ? Number(row.version_number) : 0,
        skillMd: '',
        available: false,
      });
      continue;
    }
    if (!skill || typeof skill.skillMd !== 'string' || !skill.skillMd.trim()) {
      if (requireActive) throw new AgentWorkspaceError('Skill 内容为空');
      resolved.push({
        ...binding,
        packageId: String(row.package_id),
        packageVersionId: String(
          row.created_in_package_version_id ?? row.current_version_id,
        ),
        skillUid: row.skill_uid,
        name: row.display_name || `Skill ${binding.skillId}`,
        description: '挂载的 Skill 内容为空，请重新选择版本。',
        versionNumber: Number(row.version_number),
        skillMd: '',
        available: false,
      });
      continue;
    }
    resolved.push({
      ...binding,
      packageId: String(row.package_id),
      packageVersionId: String(
        row.created_in_package_version_id ?? row.current_version_id,
      ),
      skillUid: row.skill_uid,
      name: row.display_name || skill.name,
      description: skill.description,
      versionNumber: Number(row.version_number),
      skillMd: skill.skillMd,
      available: true,
    });
  }
  return resolved;
}
async function toAgent(db: Queryable, row: AgentRow): Promise<AgentWorkspace> {
  // Listing preserves unavailable bindings so they can be repaired instead of hiding the Agent.
  const skills = await resolveSkills(db, row.user_id, row.skills_json, false);
  return {
    id: String(row.id),
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    model: row.model,
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
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}
export async function listAgents(userId: string) {
  const rows = await query<AgentRow>(
    'select * from user_agents where user_id = $1 order by updated_at desc, id desc',
    [userId],
  );
  return Promise.all(rows.rows.map((row) => toAgent({ query }, row)));
}
export async function getAgent(userId: string, id: string) {
  return toAgent({ query }, await ownedAgent({ query }, userId, id));
}
export async function saveAgent(userId: string, raw: unknown, id?: string) {
  const input = parseAgentInput(raw);
  return withTransaction(async (client) => {
    const current = id ? await ownedAgent(client, userId, id, true) : null;
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
    await resolveSkills(client, userId, input.skills, true);
    const now = new Date(
      Math.max(
        Date.now(),
        current ? new Date(current.updated_at).getTime() + 1 : 0,
      ),
    ).toISOString();
    const values = [
      input.name,
      input.description,
      input.instructions,
      input.model,
      JSON.stringify(input.skills),
      now,
    ];
    const result = current
      ? await client.query<AgentRow>(
          'update user_agents set name=$1, description=$2, instructions=$3, model=$4, skills_json=$5, updated_at=$6 where id=$7 and user_id=$8 returning *',
          [...values, id, userId],
        )
      : await client.query<AgentRow>(
          'insert into user_agents (name,description,instructions,model,skills_json,updated_at,created_at,user_id) values ($1,$2,$3,$4,$5,$6,$6,$7) returning *',
          [...values, userId],
        );
    return toAgent(client, result.rows[0]!);
  });
}

const isId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[1-9]\d*$/.test(value) &&
  Number.isSafeInteger(Number(value));

/**
 * 把已生成的 Skill 转成可对话的 Agent。
 * 同一个生成会话或同一个 Skill 只会创建一个 Agent；重复调用返回既有 Agent。
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

  return withTransaction(async (client) => {
    let sourceKey: string;
    let skillId: string;
    let skillVersionId: string;
    let preferredName = '';
    let model = '';

    if (sessionId) {
      const session = await client.query<Record<string, unknown>>(
        `select display_name, status, model, skill_id, skill_version_id
           from skill_guided_creation_sessions
          where id = $1 and user_id = $2 and deleted_at is null`,
        [sessionId, userId],
      );
      const row = session.rows[0];
      if (!row)
        throw new AgentWorkspaceError(
          '创建会话不存在',
          404,
          'SESSION_NOT_FOUND',
        );
      if (!row.skill_id || !row.skill_version_id || row.status !== 'completed')
        throw new AgentWorkspaceError(
          '该会话尚未完成生成，请稍后再试',
          409,
          'SESSION_NOT_READY',
        );
      sourceKey = `guided:${sessionId}`;
      skillId = String(row.skill_id);
      skillVersionId = String(row.skill_version_id);
      preferredName =
        typeof row.display_name === 'string' ? row.display_name.trim() : '';
      model =
        typeof row.model === 'string' ? row.model.trim().slice(0, 256) : '';
    } else {
      const latest = await client.query<{ id: string }>(
        `select sv.id
           from agent_skill_versions sv
           join agent_package_skills s on s.id = sv.skill_id
           join agent_packages p on p.id = sv.package_id
          where sv.skill_id = $1 and p.user_id = $2
            and s.status = 'active' and sv.status = 'active'
          order by sv.version_number desc
          limit 1`,
        [requestedSkillId, userId],
      );
      const versionId = latest.rows[0]?.id;
      if (!versionId)
        throw new AgentWorkspaceError(
          'Skill 或版本不可用，请重新选择',
          422,
          'SKILL_UNAVAILABLE',
        );
      sourceKey = `skill:${requestedSkillId}`;
      skillId = requestedSkillId;
      skillVersionId = String(versionId);
    }

    const skills = await resolveSkills(
      client,
      userId,
      [{ skillId, skillVersionId, enabled: true }],
      true,
    );
    const skill = skills[0]!;
    const name = (preferredName || skill.name).slice(0, 100);
    const description = skill.description.slice(0, 2000);
    const instructions = `你是「${name}」教学 Agent。请围绕用户的教学场景，优先依据已挂载的教学 Skill 完成任务；信息不足时先澄清，不编造课程事实。`;

    const bySource = await client.query<AgentRow>(
      'select * from user_agents where user_id = $1 and source_key = $2',
      [userId, sourceKey],
    );
    if (bySource.rows[0]) return toAgent(client, bySource.rows[0]);

    // 同一 Skill 已经有 Agent 时复用它，避免重复创建。
    const bySkill = await client.query<AgentRow>(
      `select * from user_agents a
        where a.user_id = $1
          and exists (
            select 1 from jsonb_array_elements(a.skills_json) binding
            where binding->>'skillId' = $2
          )
        order by a.updated_at desc, a.id desc
        limit 1`,
      [userId, skillId],
    );
    if (bySkill.rows[0]) {
      await client.query(
        'update user_agents set source_key = $1 where id = $2 and source_key is null',
        [sourceKey, bySkill.rows[0].id],
      );
      return toAgent(client, bySkill.rows[0]);
    }

    const now = new Date().toISOString();
    try {
      const inserted = await client.query<AgentRow>(
        'insert into user_agents (name,description,instructions,model,skills_json,updated_at,created_at,user_id,source_key) values ($1,$2,$3,$4,$5,$6,$6,$7,$8) returning *',
        [
          name,
          description,
          instructions,
          model,
          JSON.stringify([{ skillId, skillVersionId, enabled: true }]),
          now,
          userId,
          sourceKey,
        ],
      );
      return toAgent(client, inserted.rows[0]!);
    } catch (error) {
      const retry = await client.query<AgentRow>(
        'select * from user_agents where user_id = $1 and source_key = $2',
        [userId, sourceKey],
      );
      if (retry.rows[0]) return toAgent(client, retry.rows[0]);
      throw error;
    }
  });
}
export async function listAgentConversations(userId: string, id: string) {
  await ownedAgent({ query }, userId, id);
  const rows = await query<{ thread_id: string }>(
    'select c.thread_id from user_agent_conversations c join arena_threads t on t.id=c.thread_id where c.agent_id=$1 and t.user_id=$2 order by t.updated_at desc, t.id desc',
    [id, userId],
  );
  return Promise.all(
    rows.rows.map(
      async (row) => (await getThreadDetail(userId, row.thread_id)).thread,
    ),
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
  return withTransaction(async (client) => {
    const agent = await ownedAgent(client, userId, id, true);
    const existing = await client.query<{ thread_id: string; purpose: string }>(
      'select thread_id, purpose from user_agent_conversations where agent_id=$1 and request_id=$2',
      [id, body.requestId],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].purpose !== purpose)
        throw new AgentWorkspaceError(
          '请求标识已用于其他对话类型',
          409,
          'IDEMPOTENCY_CONFLICT',
        );
      return (await getThreadDetail(userId, existing.rows[0].thread_id)).thread;
    }
    const bindings = agent.skills_json.filter((skill) => skill.enabled);
    if (!bindings.length)
      throw new AgentWorkspaceError('请先启用至少一个 Skill');
    const skills = await resolveSkills(client, userId, bindings, true);
    const first = skills[0]!;
    const execution: AgentExecutionSnapshot = {
      agentId: id,
      name: agent.name,
      instructions: agent.instructions,
      model: agent.model,
      skills,
    };
    const config: SkillArenaConfig = {
      mode: 'skill_arena',
      compositionMode: 'skill_only',
      surface: purpose,
      basePackageVersionId: first.packageVersionId,
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
    const result = await client.query<{ id: string }>(
      `insert into arena_threads (user_id,package_id,title,model,arena_kind,base_package_version_id,arena_config_jsonb,created_at,updated_at)
      values ($1,$2,$3,$4,'skill_arena',$5,$6,$7,$7) returning id`,
      [
        userId,
        first.packageId,
        `${agent.name} · ${purpose === 'test' ? '测试' : '对话'}`,
        agent.model || null,
        first.packageVersionId,
        JSON.stringify(config),
        now,
      ],
    );
    const threadId = result.rows[0]!.id;
    await client.query(
      "insert into arena_thread_variants (thread_id,package_id,side,skill_id,skill_version_id,created_at) values ($1,$2,'right',$3,$4,$5)",
      [threadId, first.packageId, first.skillId, first.skillVersionId, now],
    );
    await client.query(
      'insert into user_agent_conversations (agent_id,thread_id,request_id,purpose) values ($1,$2,$3,$4)',
      [id, threadId, body.requestId, purpose],
    );
    return {
      id: Number(threadId),
      packageId: Number(first.packageId),
      title: `${agent.name} · ${purpose === 'test' ? '测试' : '对话'}`,
      model: agent.model || null,
      arenaKind: 'skill_arena',
      basePackageVersionId: first.packageVersionId,
      skillArenaConfig: config,
      createdAt: now,
      updatedAt: now,
    };
  });
}
