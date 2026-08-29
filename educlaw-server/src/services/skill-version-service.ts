import { createHash } from 'node:crypto';
import type {
  AgentPackageSnapshot,
  PackageSkill,
  PackageVersion,
} from '@educlaw/shared';
import { withTransaction, type Queryable } from './db.js';
import type { DbRowPackage, DbRowPackageVersion } from '../types.js';
import { parseDbJson } from '../utils/json.js';

type SkillVersionSource = PackageVersion['source'];

interface SyncPackageVersionSkillsCommand {
  packageId: string | number;
  packageVersionId: string | number;
  packageVersionNumber?: number;
  source: SkillVersionSource;
  snapshot: AgentPackageSnapshot;
  note?: string;
  forcedSkillVersions?: Map<
    string,
    {
      source: SkillVersionSource;
      basedOnVersionId?: string | number;
      note?: string;
    }
  >;
}

interface DbSkillRow {
  id: string;
  package_id: string;
  skill_uid: string;
  dir_name: string;
  name: string;
  display_name: string | null;
  description: string;
  status: 'active' | 'removed';
  next_version_number: number;
  created_at: string;
  updated_at: string;
}

interface DbSkillVersionRow {
  id: string;
  skill_id: string;
  package_id: string;
  created_in_package_version_id: string;
  version_number: number;
  source: SkillVersionSource;
  based_on_version_id: string | null;
  skill_snapshot_json: unknown;
  content_hash: string;
  status: 'active' | 'discarded';
  note: string;
  created_at: string;
  discarded_at: string | null;
  discarded_by: string | null;
  discard_reason: string | null;
  restored_at: string | null;
  restored_by: string | null;
}

export class SkillVersionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

function emptySnapshot(): AgentPackageSnapshot {
  return {
    name: '',
    description: '',
    versionLabel: '',
    agentMd: '',
    rubricMd: '',
    skills: [],
  };
}

function positiveId(value: string | number, fieldName: string): string {
  const text = String(value).trim();
  if (!/^[1-9]\d*$/.test(text)) {
    throw new SkillVersionError(
      'INVALID_ARGUMENT',
      `${fieldName} must be a positive integer string`,
      422,
    );
  }
  return text;
}

function normalizeBatchSkillIds(values: unknown): string[] {
  if (!Array.isArray(values)) {
    throw new SkillVersionError(
      'INVALID_ARGUMENT',
      'skillIds must be an array',
      400,
    );
  }
  if (values.some((value) => typeof value !== 'string' || !/^[1-9]\d*$/.test(value))) {
    throw new SkillVersionError(
      'INVALID_ARGUMENT',
      'skillIds must contain positive integer strings',
      400,
    );
  }
  const ids = [...new Set(values as string[])];
  if (ids.length === 0 || ids.length > 100) {
    throw new SkillVersionError(
      'INVALID_ARGUMENT',
      'skillIds must contain between 1 and 100 unique ids',
      400,
    );
  }
  return ids.sort((left, right) => {
    const leftId = BigInt(left);
    const rightId = BigInt(right);
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  });
}

function validateSkillUid(value: string): string {
  const text = String(value || '').trim();
  if (!text) {
    throw new SkillVersionError(
      'INVALID_ARGUMENT',
      'Skill id is required',
      422,
    );
  }
  return text;
}

function slugifySkillUid(value: string): string {
  return (
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'skill'
  );
}

function assertSafeDirName(dirName: string) {
  const value = String(dirName || '').trim();
  const hasControlChar = Array.from(value).some((char) => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127;
  });
  if (
    !value ||
    value.includes('/') ||
    value.includes('\\') ||
    value.includes('..') ||
    /^[a-zA-Z]:/.test(value) ||
    value.startsWith('.') ||
    value.startsWith('~') ||
    hasControlChar
  ) {
    throw new SkillVersionError(
      'INVALID_ARGUMENT',
      'Skill dirName is invalid',
      422,
    );
  }
}

function normalizeSkillSnapshot(
  skill: PackageSkill,
  resolvedSkillUid?: string,
): PackageSkill {
  const skillUid = validateSkillUid(resolvedSkillUid ?? skill.id);
  assertSafeDirName(skill.dirName);
  return {
    id: skillUid,
    dirName: String(skill.dirName || '').trim(),
    name: String(skill.name || '').trim(),
    description: String(skill.description || '').trim(),
    skillMd: String(skill.skillMd || '').trim(),
  };
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function hashSkill(skill: PackageSkill): string {
  return createHash('sha256')
    .update(stableJson(normalizeSkillSnapshot(skill)))
    .digest('hex');
}

function toSkillVersion(row: DbSkillVersionRow) {
  return {
    id: String(row.id),
    skillId: String(row.skill_id),
    packageId: String(row.package_id),
    createdInPackageVersionId: String(row.created_in_package_version_id),
    versionNumber: row.version_number,
    source: row.source,
    basedOnVersionId: row.based_on_version_id
      ? String(row.based_on_version_id)
      : null,
    skill: parseDbJson<PackageSkill>(row.skill_snapshot_json, {
      id: '',
      dirName: '',
      name: '',
      description: '',
      skillMd: '',
    }),
    contentHash: row.content_hash,
    status: row.status,
    note: row.note || '',
    createdAt: row.created_at,
    discardedAt: row.discarded_at,
    discardedBy: row.discarded_by,
    discardReason: row.discard_reason,
    restoredAt: row.restored_at,
    restoredBy: row.restored_by,
  };
}

function buildRequestHash(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

async function getOwnedPackage(
  client: Queryable,
  authUserId: string,
  packageId: string | number,
  lock = false,
) {
  const result = await client.query<DbRowPackage>(
    `select * from agent_packages where id = $1 and user_id = $2${lock ? ' for update' : ''}`,
    [packageId, authUserId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new SkillVersionError('PACKAGE_NOT_FOUND', 'Package not found', 404);
  }
  return row;
}

async function getOwnedSkill(
  client: Queryable,
  authUserId: string,
  packageId: string | number,
  skillId: string | number,
) {
  const result = await client.query<DbSkillRow>(
    `select s.*
     from agent_package_skills s
     join agent_packages p on p.id = s.package_id
     where s.id = $1 and s.package_id = $2 and p.user_id = $3`,
    [skillId, packageId, authUserId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new SkillVersionError('SKILL_NOT_FOUND', 'Skill not found', 404);
  }
  return row;
}

async function getPackageVersion(
  client: Queryable,
  packageId: string | number,
  versionId: string | number,
) {
  const result = await client.query<DbRowPackageVersion>(
    'select * from agent_package_versions where id = $1 and package_id = $2',
    [versionId, packageId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new SkillVersionError(
      'PACKAGE_VERSION_NOT_FOUND',
      'Package version not found',
      404,
    );
  }
  return row;
}

async function getOwnedSkillVersion(
  client: Queryable,
  input: {
    authUserId: string;
    packageId: string | number;
    versionId: string | number;
    skillId?: string | number;
    lock?: boolean;
  },
) {
  const params: Array<string | number> = [
    input.versionId,
    input.packageId,
    input.authUserId,
  ];
  let sql = `select sv.*
    from agent_skill_versions sv
    join agent_package_skills s
      on s.id = sv.skill_id
     and s.package_id = sv.package_id
    join agent_packages p
      on p.id = s.package_id
    where sv.id = $1
      and sv.package_id = $2
      and p.user_id = $3`;
  if (input.skillId !== undefined) {
    params.push(input.skillId);
    sql += ` and s.id = $${params.length}`;
  }
  if (input.lock) {
    sql += ' for update of sv';
  }
  const result = await client.query<DbSkillVersionRow>(sql, params);
  const row = result.rows[0];
  if (!row) {
    throw new SkillVersionError(
      'SKILL_VERSION_NOT_FOUND',
      'Skill version not found',
      404,
    );
  }
  return row;
}

async function resolveSnapshotSkills(
  client: Queryable,
  packageId: string,
  skills: PackageSkill[],
) {
  const existing = await client.query<{ skill_uid: string; dir_name: string }>(
    `select skill_uid, dir_name
     from agent_package_skills
     where package_id = $1
     order by id asc`,
    [packageId],
  );
  const skillUidByDirName = new Map<string, string>();
  const usedSkillUids = new Set<string>();
  for (const row of existing.rows) {
    const dirKey = String(row.dir_name || '').trim().toLocaleLowerCase();
    if (dirKey && !skillUidByDirName.has(dirKey)) {
      skillUidByDirName.set(dirKey, row.skill_uid);
    }
    usedSkillUids.add(row.skill_uid);
  }

  const seenSkillUids = new Set<string>();
  const seenDirNames = new Set<string>();
  return skills.map((skill) => {
    const dirName = String(skill.dirName || '').trim();
    assertSafeDirName(dirName);
    const dirKey = dirName.toLocaleLowerCase();
    let skillUid = String(skill.id || '').trim();
    if (!skillUid) {
      skillUid = skillUidByDirName.get(dirKey) || slugifySkillUid(dirName);
      if (usedSkillUids.has(skillUid) && skillUidByDirName.get(dirKey) !== skillUid) {
        let suffix = 2;
        const base = skillUid;
        while (usedSkillUids.has(`${base}-${suffix}`)) {
          suffix += 1;
        }
        skillUid = `${base}-${suffix}`;
      }
    }
    skillUid = validateSkillUid(skillUid);
    if (seenSkillUids.has(skillUid)) {
      throw new SkillVersionError(
        'INVALID_ARGUMENT',
        'Duplicate skill id in package snapshot',
        422,
      );
    }
    if (seenDirNames.has(dirKey)) {
      throw new SkillVersionError(
        'INVALID_ARGUMENT',
        'Duplicate skill dirName in package snapshot',
        422,
      );
    }
    seenSkillUids.add(skillUid);
    seenDirNames.add(dirKey);
    usedSkillUids.add(skillUid);
    if (!skillUidByDirName.has(dirKey)) {
      skillUidByDirName.set(dirKey, skillUid);
    }
    return normalizeSkillSnapshot(
      {
        ...skill,
        id: skillUid,
        dirName,
      },
      skillUid,
    );
  });
}

async function getOrCreateSkillRow(
  client: Queryable,
  packageId: string | number,
  skill: PackageSkill,
  now: string,
) {
  const normalized = normalizeSkillSnapshot(skill);
  const result = await client.query<DbSkillRow>(
    `insert into agent_package_skills
      (package_id, skill_uid, dir_name, name, description, status, created_at, updated_at)
     values ($1, $2, $3, $4, $5, 'active', $6, $6)
     on conflict (package_id, skill_uid) do update set
      dir_name = excluded.dir_name,
      name = excluded.name,
      description = excluded.description,
      status = 'active',
      updated_at = excluded.updated_at,
      removed_at = null,
      removed_by = null,
      remove_reason = null
     returning *`,
    [
      packageId,
      normalized.id,
      normalized.dirName,
      normalized.name,
      normalized.description,
      now,
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new SkillVersionError('SKILL_NOT_FOUND', 'Skill not found', 404);
  }
  return row;
}

async function allocateSkillVersionNumber(
  client: Queryable,
  skillId: string | number,
) {
  const result = await client.query<{ version_number: number }>(
    `update agent_package_skills
     set next_version_number = next_version_number + 1
     where id = $1
     returning next_version_number - 1 as version_number`,
    [skillId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new SkillVersionError('SKILL_NOT_FOUND', 'Skill not found', 404);
  }
  return row.version_number;
}

async function findReusableSkillVersion(
  client: Queryable,
  skillId: string | number,
  contentHash: string,
  packageId: string,
  packageVersionNumber?: number,
) {
  const result = await client.query<{ id: string; version_number: number }>(
    `select sv.id, sv.version_number
     from agent_skill_versions sv
     join agent_package_versions pv
       on pv.id = sv.created_in_package_version_id
     where sv.skill_id = $1
       and sv.content_hash = $2
       and sv.status = 'active'
       and pv.package_id = $3
       and ($4::integer is null or pv.version_number <= $4::integer)
     order by sv.version_number desc
     limit 1`,
    [skillId, contentHash, packageId, packageVersionNumber ?? null],
  );
  return result.rows[0];
}

async function createSkillVersion(
  client: Queryable,
  command: {
    skillId: string | number;
    packageId: string | number;
    packageVersionId: string | number;
    versionNumber: number;
    source: SkillVersionSource;
    skill: PackageSkill;
    contentHash: string;
    now: string;
    note?: string;
    basedOnVersionId?: string | number;
  },
) {
  const result = await client.query<{ id: string }>(
    `insert into agent_skill_versions
      (skill_id, package_id, created_in_package_version_id, version_number, source,
       based_on_version_id, skill_snapshot_json, content_hash, status, note, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, $10)
     returning id`,
    [
      command.skillId,
      command.packageId,
      command.packageVersionId,
      command.versionNumber,
      command.source,
      command.basedOnVersionId || null,
      JSON.stringify(normalizeSkillSnapshot(command.skill)),
      command.contentHash,
      command.note || '',
      command.now,
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new SkillVersionError(
      'SKILL_VERSION_NOT_FOUND',
      'Skill version not created',
      500,
    );
  }
  return row.id;
}

export async function syncPackageVersionSkillsFromSnapshot(
  client: Queryable,
  command: SyncPackageVersionSkillsCommand,
) {
  const packageId = positiveId(command.packageId, 'packageId');
  const packageVersionId = positiveId(
    command.packageVersionId,
    'packageVersionId',
  );
  const now = new Date().toISOString();
  const normalizedSkills = await resolveSnapshotSkills(
    client,
    packageId,
    command.snapshot.skills,
  );
  const syncedVersions = new Map<string, { id: string; versionNumber: number }>();

  for (let index = 0; index < normalizedSkills.length; index += 1) {
    const skill = normalizedSkills[index]!;
    const skillRow = await getOrCreateSkillRow(client, packageId, skill, now);
    const forced = command.forcedSkillVersions?.get(skill.id);
    const contentHash = hashSkill(skill);
    const reusableVersion = !forced
      ? await findReusableSkillVersion(
          client,
          skillRow.id,
          contentHash,
          packageId,
          command.packageVersionNumber,
        )
      : undefined;
    let skillVersionId = reusableVersion?.id;
    let skillVersionNumber = reusableVersion?.version_number;

    if (!skillVersionId) {
      const versionNumber = await allocateSkillVersionNumber(
        client,
        skillRow.id,
      );
      skillVersionId = await createSkillVersion(client, {
        skillId: skillRow.id,
        packageId,
        packageVersionId,
        versionNumber,
        source: forced?.source || command.source,
        basedOnVersionId: forced?.basedOnVersionId,
        skill,
        contentHash,
        now,
        note: forced?.note || command.note,
      });
      skillVersionNumber = versionNumber;
    }
    syncedVersions.set(skill.id, {
      id: String(skillVersionId),
      versionNumber: Number(skillVersionNumber),
    });

    await client.query(
      `insert into agent_package_version_skills
        (package_version_id, package_id, skill_id, skill_version_id, sort_order)
       values ($1, $2, $3, $4, $5)
       on conflict (package_version_id, skill_id) do update set
        skill_version_id = excluded.skill_version_id,
        sort_order = excluded.sort_order`,
      [packageVersionId, packageId, skillRow.id, skillVersionId, index],
    );
  }

  await client.query(
    `update agent_package_skills set status = 'removed', removed_at = $3, remove_reason = 'removed from current package', updated_at = $3
     where package_id = $1 and not (skill_uid = any($2::text[])) and status = 'active'`,
    [packageId, normalizedSkills.map((skill) => skill.id), now],
  );
  return syncedVersions;
}

function toSkillSummary(row: DbSkillRow) {
  return {
    id: String(row.id),
    packageId: String(row.package_id),
    skillUid: row.skill_uid,
    dirName: row.dir_name,
    name: row.display_name?.trim() || row.name,
    description: row.description,
    status: row.status,
    updatedAt: row.updated_at,
  };
}

interface DbRepositorySkillRow extends DbSkillRow {
  package_name: string;
  package_description: string;
}

function decodeRepositoryCursor(cursor: string | undefined) {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as { updatedAt?: unknown; id?: unknown };
    if (
      typeof parsed.updatedAt !== 'string' ||
      Number.isNaN(Date.parse(parsed.updatedAt)) ||
      typeof parsed.id !== 'string' ||
      !/^[1-9]\d*$/.test(parsed.id)
    ) {
      throw new Error('invalid cursor');
    }
    return { updatedAt: parsed.updatedAt, id: parsed.id };
  } catch {
    throw new SkillVersionError(
      'INVALID_ARGUMENT',
      'Repository cursor is invalid',
      422,
    );
  }
}

function encodeRepositoryCursor(row: DbRepositorySkillRow) {
  return Buffer.from(
    JSON.stringify({ updatedAt: row.updated_at, id: String(row.id) }),
    'utf8',
  ).toString('base64url');
}

export async function listRepositorySkills(input: {
  authUserId: string;
  cursor?: string;
  limit?: number;
}) {
  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new SkillVersionError(
      'INVALID_ARGUMENT',
      'limit must be an integer from 1 to 100',
      422,
    );
  }
  const cursor = decodeRepositoryCursor(input.cursor);

  return withTransaction(async (client) => {
    const result = await client.query<DbRepositorySkillRow>(
      `select s.*, p.name as package_name, p.description as package_description
       from agent_package_skills s
       join agent_packages p on p.id = s.package_id
       where p.user_id = $1
         and s.status = 'active'
         and (
           $2::timestamptz is null
           or (s.updated_at, s.id) < ($2::timestamptz, $3::bigint)
         )
       order by s.updated_at desc, s.id desc
       limit $4`,
      [input.authUserId, cursor?.updatedAt ?? null, cursor?.id ?? null, limit + 1],
    );
    const hasMore = result.rows.length > limit;
    const pageRows = result.rows.slice(0, limit);
    return {
      items: pageRows.map((row) => ({
        id: String(row.id),
        packageId: String(row.package_id),
        skillUid: row.skill_uid,
        dirName: row.dir_name,
        name: row.display_name?.trim() || row.name,
        description: row.description,
        updatedAt: row.updated_at,
        packageName: row.package_name,
        packageDescription: row.package_description,
      })),
      nextCursor:
        hasMore && pageRows.length > 0
          ? encodeRepositoryCursor(pageRows[pageRows.length - 1]!)
          : null,
    };
  });
}

async function ensurePackageSkillHistory(client: Queryable, pkg: DbRowPackage) {
  const versions = await client.query<DbRowPackageVersion>(
    `select * from agent_package_versions
     where package_id = $1
     order by version_number asc`,
    [pkg.id],
  );
  if (versions.rows.length === 0) {
    return;
  }

  const mappings = await client.query<{ package_version_id: string }>(
    `select distinct package_version_id
     from agent_package_version_skills
     where package_id = $1`,
    [pkg.id],
  );
  const mappedVersionIds = new Set(
    mappings.rows.map((row) => String(row.package_version_id)),
  );
  let backfilled = false;

  for (const version of versions.rows) {
    if (mappedVersionIds.has(String(version.id))) {
      continue;
    }
    await syncPackageVersionSkillsFromSnapshot(client, {
      packageId: pkg.id,
      packageVersionId: version.id,
      packageVersionNumber: version.version_number,
      source: version.source as SkillVersionSource,
      snapshot: parseDbJson<AgentPackageSnapshot>(
        version.snapshot_json,
        emptySnapshot(),
      ),
    });
    backfilled = true;
  }

  if (!backfilled) {
    return;
  }
  const currentVersion = versions.rows.find(
    (version) => String(version.id) === String(pkg.current_version_id),
  );
  if (!currentVersion) {
    return;
  }
  await syncPackageVersionSkillsFromSnapshot(client, {
    packageId: pkg.id,
    packageVersionId: currentVersion.id,
    packageVersionNumber: currentVersion.version_number,
    source: currentVersion.source as SkillVersionSource,
    snapshot: parseDbJson<AgentPackageSnapshot>(
      currentVersion.snapshot_json,
      emptySnapshot(),
    ),
  });
}

export async function listPackageSkills(input: {
  authUserId: string;
  packageId: string;
  includeRemoved?: boolean;
}) {
  const packageId = positiveId(input.packageId, 'packageId');
  return withTransaction(async (client) => {
    const pkg = await getOwnedPackage(client, input.authUserId, packageId);
    await ensurePackageSkillHistory(client, pkg);
    const result = await client.query<DbSkillRow>(
      `select * from agent_package_skills
       where package_id = $1 and ($2::boolean or status = 'active')
       order by id asc`,
      [packageId, Boolean(input.includeRemoved)],
    );
    return result.rows.map(toSkillSummary);
  });
}

export async function renameSkill(input: {
  authUserId: string;
  packageId: string;
  skillId: string;
  displayName: string;
}) {
  const packageId = positiveId(input.packageId, 'packageId');
  const skillId = positiveId(input.skillId, 'skillId');
  const displayName = input.displayName.trim();
  if (!displayName || displayName.length > 80) {
    throw new SkillVersionError(
      'INVALID_ARGUMENT',
      displayName ? 'Skill name must not exceed 80 characters' : 'Skill name is required',
      422,
    );
  }

  return withTransaction(async (client) => {
    const now = new Date().toISOString();
    const result = await client.query<DbSkillRow>(
      `update agent_package_skills s
       set display_name = $1, updated_at = $2
       from agent_packages p
       where s.id = $3
         and s.package_id = $4
         and s.status = 'active'
         and p.id = s.package_id
         and p.user_id = $5
       returning s.*`,
      [displayName, now, skillId, packageId, input.authUserId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new SkillVersionError('SKILL_NOT_FOUND', 'Skill not found', 404);
    }
    return toSkillSummary(row);
  });
}

export async function batchDeleteSkills(input: {
  authUserId: string;
  skillIds: string[];
}): Promise<{ deletedSkillIds: string[]; deletedCount: number }> {
  const skillIds = normalizeBatchSkillIds(input.skillIds);

  return withTransaction(async (client) => {
    const ownershipResult = await client.query<DbSkillRow>(
      `select s.*
       from agent_package_skills s
       join agent_packages p on p.id = s.package_id
       where s.id = any($1::bigint[]) and p.user_id = $2
       order by s.id asc`,
      [skillIds, input.authUserId],
    );
    const foundIds = new Set(ownershipResult.rows.map((row) => String(row.id)));
    if (skillIds.some((skillId) => !foundIds.has(skillId))) {
      throw new SkillVersionError(
        'SKILL_NOT_FOUND',
        'Skill not found',
        404,
      );
    }

    const packageIds = [...new Set(
      ownershipResult.rows.map((row) => String(row.package_id)),
    )].sort((left, right) => {
      const leftId = BigInt(left);
      const rightId = BigInt(right);
      return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
    });
    const packagesResult = await client.query<DbRowPackage>(
      `select * from agent_packages
       where user_id = $1 and id = any($2::bigint[])
       order by id asc
       for update`,
      [input.authUserId, packageIds],
    );
    if (packagesResult.rows.length !== packageIds.length) {
      throw new SkillVersionError(
        'SKILL_NOT_FOUND',
        'Skill not found',
        404,
      );
    }

    const targetResult = await client.query<DbSkillRow>(
      `select s.*
       from agent_package_skills s
       join agent_packages p on p.id = s.package_id
       where s.id = any($1::bigint[]) and p.user_id = $2
       order by s.id asc
       for update of s`,
      [skillIds, input.authUserId],
    );
    const lockedIds = new Set(targetResult.rows.map((row) => String(row.id)));
    if (skillIds.some((skillId) => !lockedIds.has(skillId))) {
      throw new SkillVersionError(
        'SKILL_NOT_FOUND',
        'Skill not found',
        404,
      );
    }
    const activeTargets = targetResult.rows.filter(
      (row) => row.status === 'active',
    );
    if (activeTargets.length === 0) {
      return { deletedSkillIds: skillIds, deletedCount: skillIds.length };
    }

    const targetsByPackage = new Map<string, DbSkillRow[]>();
    for (const target of activeTargets) {
      const packageId = String(target.package_id);
      const grouped = targetsByPackage.get(packageId) || [];
      grouped.push(target);
      targetsByPackage.set(packageId, grouped);
    }
    const activePackageIds = new Set(targetsByPackage.keys());

    const now = new Date().toISOString();
    for (const pkg of packagesResult.rows.filter((row) => (
      activePackageIds.has(String(row.id))
    ))) {
      const packageId = String(pkg.id);
      const currentVersionResult = await client.query<DbRowPackageVersion>(
        `select * from agent_package_versions
         where id = $1 and package_id = $2`,
        [pkg.current_version_id, packageId],
      );
      const currentVersion = currentVersionResult.rows[0];
      if (!currentVersion) {
        throw new SkillVersionError(
          'SKILL_DELETE_CONFLICT',
          'Skill has changed. Refresh before retrying.',
          409,
        );
      }
      const currentSnapshot = parseDbJson<AgentPackageSnapshot>(
        currentVersion.snapshot_json,
        emptySnapshot(),
      );
      const removedSkillUids = new Set(
        targetsByPackage.get(packageId)?.map((row) => row.skill_uid) || [],
      );
      const nextVersionNumber = currentVersion.version_number + 1;
      const nextSnapshot: AgentPackageSnapshot = {
        ...currentSnapshot,
        versionLabel: `v${nextVersionNumber}`,
        skills: currentSnapshot.skills.filter(
          (skill) => !removedSkillUids.has(skill.id),
        ),
      };
      const packageVersionResult = await client.query<{ id: string }>(
        `insert into agent_package_versions
          (package_id, version_number, source, snapshot_json, note, created_at)
         values ($1, $2, 'manual', $3, $4, $5)
         returning id`,
        [
          packageId,
          nextVersionNumber,
          JSON.stringify(nextSnapshot),
          `Deleted ${removedSkillUids.size} Skills`,
          now,
        ],
      );
      const nextPackageVersionId = packageVersionResult.rows[0]?.id;
      if (!nextPackageVersionId) {
        throw new SkillVersionError(
          'SKILL_DELETE_FAILED',
          'Skill deletion failed',
          500,
        );
      }

      await syncPackageVersionSkillsFromSnapshot(client, {
        packageId,
        packageVersionId: nextPackageVersionId,
        packageVersionNumber: nextVersionNumber,
        source: 'manual',
        snapshot: nextSnapshot,
        note: `Deleted ${removedSkillUids.size} Skills`,
      });

      const packageUpdate = await client.query(
        `update agent_packages
         set current_version_id = $1, updated_at = $2
         where id = $3 and user_id = $4 and current_version_id = $5`,
        [
          nextPackageVersionId,
          now,
          packageId,
          input.authUserId,
          pkg.current_version_id,
        ],
      );
      if ((packageUpdate.rowCount || 0) !== 1) {
        throw new SkillVersionError(
          'SKILL_DELETE_CONFLICT',
          'Skill has changed. Refresh before retrying.',
          409,
        );
      }
    }

    await client.query(
      `update agent_package_skills
       set status = 'removed',
           removed_at = $2,
           removed_by = $3,
           remove_reason = 'deleted by user',
           updated_at = $2
       where id = any($1::bigint[])`,
      [activeTargets.map((row) => String(row.id)), now, input.authUserId],
    );

    return { deletedSkillIds: skillIds, deletedCount: skillIds.length };
  });
}

export async function listSkillVersions(input: {
  authUserId: string;
  packageId: string;
  skillId: string;
  includeDiscarded?: boolean;
  cursor?: string;
  limit?: number;
}) {
  const packageId = positiveId(input.packageId, 'packageId');
  const skillId = positiveId(input.skillId, 'skillId');
  const limit = Math.min(Math.max(input.limit || 50, 1), 100);
  const cursor = input.cursor ? positiveId(input.cursor, 'cursor') : null;
  return withTransaction(async (client) => {
    const pkg = await getOwnedPackage(client, input.authUserId, packageId);
    await ensurePackageSkillHistory(client, pkg);
    await getOwnedSkill(client, input.authUserId, packageId, skillId);
    const result = await client.query<DbSkillVersionRow>(
      `select sv.* from agent_skill_versions sv
       join agent_package_skills s on s.id = sv.skill_id
       where s.id = $1 and s.package_id = $2
         and ($3::boolean or sv.status = 'active')
         and ($4::integer is null or sv.version_number < $4::integer)
       order by sv.version_number desc
       limit $5`,
      [skillId, packageId, Boolean(input.includeDiscarded), cursor, limit],
    );
    const currentVersion = await client.query<{ skill_version_id: string }>(
      `select skill_version_id
       from agent_package_version_skills
       where package_version_id = $1 and skill_id = $2
       limit 1`,
      [pkg.current_version_id, skillId],
    );
    const items = result.rows.map(toSkillVersion);
    const nextCursor =
      items.length === limit
        ? String(items[items.length - 1]!.versionNumber)
        : null;
    return {
      items,
      nextCursor,
      currentVersionId: currentVersion.rows[0]
        ? String(currentVersion.rows[0].skill_version_id)
        : null,
    };
  });
}

export async function getSkillVersionDetail(input: {
  authUserId: string;
  packageId: string;
  versionId: string;
}) {
  const packageId = positiveId(input.packageId, 'packageId');
  const versionId = positiveId(input.versionId, 'versionId');
  return withTransaction(async (client) => {
    const pkg = await getOwnedPackage(client, input.authUserId, packageId);
    await ensurePackageSkillHistory(client, pkg);
    return toSkillVersion(
      await getOwnedSkillVersion(client, {
        authUserId: input.authUserId,
        packageId,
        versionId,
      }),
    );
  });
}

export async function discardSkillVersion(input: {
  authUserId: string;
  packageId: string;
  versionId: string;
  reason: string;
}) {
  const packageId = positiveId(input.packageId, 'packageId');
  const versionId = positiveId(input.versionId, 'versionId');
  const reason = String(input.reason || '').trim();
  if (!reason) {
    throw new SkillVersionError(
      'INVALID_ARGUMENT',
      'Discard reason is required',
      422,
    );
  }
  return withTransaction(async (client) => {
    const pkg = await getOwnedPackage(
      client,
      input.authUserId,
      packageId,
      true,
    );
    await ensurePackageSkillHistory(client, pkg);
    const sourceVersion = await getOwnedSkillVersion(client, {
      authUserId: input.authUserId,
      packageId,
      versionId,
      lock: true,
    });
    const currentUse = await client.query(
      `select 1 from agent_package_version_skills
       where package_version_id = $1 and skill_id = $2 and skill_version_id = $3
       limit 1`,
      [pkg.current_version_id, sourceVersion.skill_id, versionId],
    );
    if (currentUse.rows.length > 0) {
      throw new SkillVersionError(
        'CURRENT_VERSION_CANNOT_BE_DISCARDED',
        'Current package skill version cannot be discarded',
        409,
      );
    }
    const result = await client.query<DbSkillVersionRow>(
      `update agent_skill_versions
       set status = 'discarded', discarded_at = $3, discarded_by = $4, discard_reason = $5
       where id = $1 and package_id = $2 and status = 'active'
       returning *`,
      [
        versionId,
        packageId,
        new Date().toISOString(),
        input.authUserId,
        reason,
      ],
    );
    return toSkillVersion(
      result.rows[0] ||
        (await getOwnedSkillVersion(client, {
          authUserId: input.authUserId,
          packageId,
          versionId,
        })),
    );
  });
}

export async function undiscardSkillVersion(input: {
  authUserId: string;
  packageId: string;
  versionId: string;
}) {
  const packageId = positiveId(input.packageId, 'packageId');
  const versionId = positiveId(input.versionId, 'versionId');
  return withTransaction(async (client) => {
    const pkg = await getOwnedPackage(client, input.authUserId, packageId, true);
    await ensurePackageSkillHistory(client, pkg);
    const result = await client.query<DbSkillVersionRow>(
      `update agent_skill_versions
       set status = 'active', discarded_at = null, discarded_by = null, discard_reason = null,
           restored_at = $3, restored_by = $4
       where id = $1 and package_id = $2 and status = 'discarded'
       returning *`,
      [versionId, packageId, new Date().toISOString(), input.authUserId],
    );
    return toSkillVersion(
      result.rows[0] ||
        (await getOwnedSkillVersion(client, {
          authUserId: input.authUserId,
          packageId,
          versionId,
        })),
    );
  });
}

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

async function claimIdempotencyKey(
  client: Queryable,
  input: {
    authUserId: string;
    action: string;
    packageId: string;
    idempotencyKey: string;
    requestHash: string;
  },
) {
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + IDEMPOTENCY_TTL_MS).toISOString();
  await client.query(
    `delete from api_idempotency_keys
     where user_id = $1
       and action = $2
       and package_id = $3
       and status = 'pending'
       and expires_at < $4`,
    [input.authUserId, input.action, input.packageId, nowIso],
  );
  const insertResult = await client.query<{ id: string }>(
    `insert into api_idempotency_keys
      (user_id, action, package_id, idempotency_key, request_hash, status,
       response_status, response_json, created_at, expires_at)
     values ($1, $2, $3, $4, $5, 'pending', null, null, $6, $7)
     on conflict (user_id, action, package_id, idempotency_key) do nothing
     returning id`,
    [
      input.authUserId,
      input.action,
      input.packageId,
      input.idempotencyKey,
      input.requestHash,
      nowIso,
      expiresAt,
    ],
  );
  if (insertResult.rows[0]) {
    return { kind: 'claimed' as const };
  }
  const result = await client.query<{
    request_hash: string;
    status: 'pending' | 'completed';
    response_status: number | null;
    response_json: unknown;
    expires_at: string;
  }>(
    `select request_hash, status, response_status, response_json, expires_at
     from api_idempotency_keys
     where user_id = $1 and action = $2 and package_id = $3 and idempotency_key = $4
     for update`,
    [input.authUserId, input.action, input.packageId, input.idempotencyKey],
  );
  const row = result.rows[0];
  if (!row) {
    return { kind: 'claimed' as const };
  }
  if (row.request_hash !== input.requestHash) {
    throw new SkillVersionError(
      'IDEMPOTENCY_CONFLICT',
      'Idempotency key was reused with different request data',
      409,
    );
  }
  if (row.status === 'completed' && row.response_json) {
    return {
      kind: 'replayed' as const,
      responseStatus: row.response_status || 200,
      responseJson: row.response_json,
    };
  }
  if (new Date(row.expires_at).getTime() > now.getTime()) {
    throw new SkillVersionError(
      'IDEMPOTENCY_IN_PROGRESS',
      'Idempotency request is already in progress',
      409,
    );
  }
  await client.query(
    `update api_idempotency_keys
     set request_hash = $5,
         status = 'pending',
         response_status = null,
         response_json = null,
         created_at = $6,
         expires_at = $7
     where user_id = $1 and action = $2 and package_id = $3 and idempotency_key = $4`,
    [
      input.authUserId,
      input.action,
      input.packageId,
      input.idempotencyKey,
      input.requestHash,
      nowIso,
      expiresAt,
    ],
  );
  return { kind: 'claimed' as const };
}

async function completeIdempotencyKey(
  client: Queryable,
  input: {
    authUserId: string;
    action: string;
    packageId: string;
    idempotencyKey: string;
    requestHash: string;
    responseStatus: number;
    responseJson: unknown;
  },
) {
  await client.query(
    `update api_idempotency_keys
     set request_hash = $5,
         status = 'completed',
         response_status = $6,
         response_json = $7
     where user_id = $1 and action = $2 and package_id = $3 and idempotency_key = $4`,
    [
      input.authUserId,
      input.action,
      input.packageId,
      input.idempotencyKey,
      input.requestHash,
      input.responseStatus,
      JSON.stringify(input.responseJson),
    ],
  );
}

export async function rollbackSkillVersion(input: {
  authUserId: string;
  packageId: string;
  skillId: string;
  versionId: string;
  expectedPackageVersionId: string;
  idempotencyKey: string;
  note?: string;
}) {
  const packageId = positiveId(input.packageId, 'packageId');
  const skillId = positiveId(input.skillId, 'skillId');
  const versionId = positiveId(input.versionId, 'versionId');
  const expectedPackageVersionId = positiveId(
    input.expectedPackageVersionId,
    'expectedPackageVersionId',
  );
  const idempotencyKey = String(input.idempotencyKey || '').trim();
  if (!idempotencyKey || idempotencyKey.length > 120) {
    throw new SkillVersionError(
      'INVALID_ARGUMENT',
      'idempotencyKey is required',
      422,
    );
  }
  const requestHash = buildRequestHash({
    packageId,
    skillId,
    versionId,
    expectedPackageVersionId,
    note: input.note || '',
  });

  return withTransaction(async (client) => {
    const idempotency = await claimIdempotencyKey(client, {
      authUserId: input.authUserId,
      action: 'skill.version.rollback',
      packageId,
      idempotencyKey,
      requestHash,
    });
    if (idempotency.kind === 'replayed') {
      return parseDbJson<Record<string, unknown>>(idempotency.responseJson, {});
    }

    const pkg = await getOwnedPackage(
      client,
      input.authUserId,
      packageId,
      true,
    );
    await ensurePackageSkillHistory(client, pkg);
    if (String(pkg.current_version_id) !== expectedPackageVersionId) {
      throw new SkillVersionError(
        'PACKAGE_VERSION_CONFLICT',
        'Package has changed. Refresh before retrying.',
        409,
        {
          currentPackageVersionId: String(pkg.current_version_id),
        },
      );
    }

    await getOwnedSkill(client, input.authUserId, packageId, skillId);
    const sourceVersion = await getOwnedSkillVersion(client, {
      authUserId: input.authUserId,
      packageId,
      versionId,
      skillId,
      lock: true,
    });
    if (sourceVersion.status === 'discarded') {
      throw new SkillVersionError(
        'SKILL_VERSION_DISCARDED',
        'Skill version is discarded',
        409,
      );
    }

    const currentVersion = await getPackageVersion(
      client,
      packageId,
      pkg.current_version_id,
    );
    const currentSnapshot = parseDbJson<AgentPackageSnapshot>(
      currentVersion.snapshot_json,
      emptySnapshot(),
    );
    const rollbackSkill = normalizeSkillSnapshot(
      parseDbJson<PackageSkill>(sourceVersion.skill_snapshot_json, {
        id: '',
        dirName: '',
        name: '',
        description: '',
        skillMd: '',
      }),
    );
    const nextVersionNumber = currentVersion.version_number + 1;
    const nextSkills = currentSnapshot.skills.map((skill) => ({ ...skill }));
    const targetIndex = nextSkills.findIndex(
      (skill) => skill.id === rollbackSkill.id,
    );
    if (targetIndex === -1) nextSkills.push(rollbackSkill);
    else nextSkills[targetIndex] = rollbackSkill;
    const nextSnapshot: AgentPackageSnapshot = {
      ...currentSnapshot,
      versionLabel: `v${nextVersionNumber}`,
      skills: nextSkills,
    };
    const now = new Date().toISOString();
    const packageVersionResult = await client.query<{ id: string }>(
      `insert into agent_package_versions
        (package_id, version_number, source, snapshot_json, note, created_at)
       values ($1, $2, 'rollback', $3, $4, $5)
       returning id`,
      [
        packageId,
        nextVersionNumber,
        JSON.stringify(nextSnapshot),
        input.note || 'Skill version rollback',
        now,
      ],
    );
    const nextPackageVersionId = packageVersionResult.rows[0]!.id;

    await syncPackageVersionSkillsFromSnapshot(client, {
      packageId,
      packageVersionId: nextPackageVersionId,
      packageVersionNumber: nextVersionNumber,
      source: 'rollback',
      snapshot: nextSnapshot,
      forcedSkillVersions: new Map([
        [
          rollbackSkill.id,
          {
            source: 'rollback',
            basedOnVersionId: versionId,
            note: input.note || 'Skill version rollback',
          },
        ],
      ]),
    });

    const packageUpdate = await client.query(
      `update agent_packages
       set current_version_id = $1, updated_at = $2
       where id = $3 and user_id = $4 and current_version_id = $5`,
      [
        nextPackageVersionId,
        now,
        packageId,
        input.authUserId,
        expectedPackageVersionId,
      ],
    );
    if ((packageUpdate.rowCount || 0) !== 1) {
      throw new SkillVersionError(
        'PACKAGE_VERSION_CONFLICT',
        'Package has changed. Refresh before retrying.',
        409,
      );
    }

    const response = {
      packageId,
      packageVersionId: String(nextPackageVersionId),
      versionNumber: nextVersionNumber,
      rolledBackSkillVersionId: versionId,
      snapshot: nextSnapshot,
    };
    await completeIdempotencyKey(client, {
      authUserId: input.authUserId,
      action: 'skill.version.rollback',
      packageId,
      idempotencyKey,
      requestHash,
      responseStatus: 200,
      responseJson: response,
    });
    return response;
  });
}

export async function rollbackPackageVersion(input: {
  authUserId: string;
  packageId: string;
  versionId: string;
  expectedPackageVersionId: string;
  idempotencyKey: string;
  note?: string;
}) {
  const packageId = positiveId(input.packageId, 'packageId');
  const versionId = positiveId(input.versionId, 'versionId');
  const expectedPackageVersionId = positiveId(
    input.expectedPackageVersionId,
    'expectedPackageVersionId',
  );
  const idempotencyKey = String(input.idempotencyKey || '').trim();
  if (!idempotencyKey || idempotencyKey.length > 120) {
    throw new SkillVersionError(
      'INVALID_ARGUMENT',
      'idempotencyKey is required',
      422,
    );
  }
  const requestHash = buildRequestHash({
    packageId,
    versionId,
    expectedPackageVersionId,
    note: input.note || '',
  });

  return withTransaction(async (client) => {
    const idempotency = await claimIdempotencyKey(client, {
      authUserId: input.authUserId,
      action: 'package.version.rollback',
      packageId,
      idempotencyKey,
      requestHash,
    });
    if (idempotency.kind === 'replayed') {
      return parseDbJson<Record<string, unknown>>(idempotency.responseJson, {});
    }

    const pkg = await getOwnedPackage(
      client,
      input.authUserId,
      packageId,
      true,
    );
    await ensurePackageSkillHistory(client, pkg);
    if (String(pkg.current_version_id) !== expectedPackageVersionId) {
      throw new SkillVersionError(
        'PACKAGE_VERSION_CONFLICT',
        'Package has changed. Refresh before retrying.',
        409,
        {
          currentPackageVersionId: String(pkg.current_version_id),
        },
      );
    }

    if (String(versionId) === String(pkg.current_version_id)) {
      throw new SkillVersionError(
        'INVALID_ARGUMENT',
        'Cannot rollback to current version',
        422,
      );
    }

    const sourceVersion = await getPackageVersion(client, packageId, versionId);
    const sourceSnapshot = parseDbJson<AgentPackageSnapshot>(
      sourceVersion.snapshot_json,
      emptySnapshot(),
    );
    const currentVersion = await getPackageVersion(
      client,
      packageId,
      pkg.current_version_id,
    );
    const nextVersionNumber = currentVersion.version_number + 1;
    const nextSnapshot: AgentPackageSnapshot = {
      ...sourceSnapshot,
      versionLabel: `v${nextVersionNumber}`,
    };
    const now = new Date().toISOString();
    const noteText =
      (input.note && input.note.trim()) ||
      `Rollback to v${sourceVersion.version_number}`;
    const packageVersionResult = await client.query<{ id: string }>(
      `insert into agent_package_versions
        (package_id, version_number, source, snapshot_json, note, created_at)
       values ($1, $2, 'rollback', $3, $4, $5)
       returning id`,
      [
        packageId,
        nextVersionNumber,
        JSON.stringify(nextSnapshot),
        noteText,
        now,
      ],
    );
    const nextPackageVersionId = packageVersionResult.rows[0]!.id;

    await syncPackageVersionSkillsFromSnapshot(client, {
      packageId,
      packageVersionId: nextPackageVersionId,
      packageVersionNumber: nextVersionNumber,
      source: 'rollback',
      snapshot: nextSnapshot,
      note: noteText,
    });

    const packageUpdate = await client.query(
      `update agent_packages
       set current_version_id = $1, updated_at = $2
       where id = $3 and user_id = $4 and current_version_id = $5`,
      [
        nextPackageVersionId,
        now,
        packageId,
        input.authUserId,
        expectedPackageVersionId,
      ],
    );
    if ((packageUpdate.rowCount || 0) !== 1) {
      throw new SkillVersionError(
        'PACKAGE_VERSION_CONFLICT',
        'Package has changed. Refresh before retrying.',
        409,
      );
    }

    const response = {
      packageId,
      packageVersionId: String(nextPackageVersionId),
      versionNumber: nextVersionNumber,
      rolledBackPackageVersionId: versionId,
      rolledBackFromVersionNumber: sourceVersion.version_number,
      snapshot: nextSnapshot,
    };
    await completeIdempotencyKey(client, {
      authUserId: input.authUserId,
      action: 'package.version.rollback',
      packageId,
      idempotencyKey,
      requestHash,
      responseStatus: 200,
      responseJson: response,
    });
    return response;
  });
}
