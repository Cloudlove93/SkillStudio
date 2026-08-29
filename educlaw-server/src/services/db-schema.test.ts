import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.hoisted(() => vi.fn());
const checkDbConnectionMock = vi.hoisted(() => vi.fn());

vi.mock('./db.js', () => ({
  checkDbConnection: checkDbConnectionMock,
  query: queryMock,
}));

describe('db schema initialization', () => {
  beforeEach(() => {
    queryMock.mockReset();
    checkDbConnectionMock.mockReset();
  });

  it('checks the database connection before running schema and migration statements', async () => {
    const { initDbSchema, schemaStatements, migrationStatements } =
      await import('./db-schema.js');

    await initDbSchema();

    expect(checkDbConnectionMock).toHaveBeenCalledOnce();
    const totalExpected = schemaStatements.length + migrationStatements.length;
    expect(queryMock).toHaveBeenCalledTimes(totalExpected);

    // First N calls are schema statements
    const schemaCalls = queryMock.mock.calls
      .slice(0, schemaStatements.length)
      .map((call) => call[0]);
    expect(schemaCalls).toEqual(schemaStatements);

    // Remaining calls are migration statements
    const migrationCalls = queryMock.mock.calls
      .slice(schemaStatements.length)
      .map((call) => call[0]);
    expect(migrationCalls).toEqual(migrationStatements);
  });

  it('keeps all existing application tables in the manual schema script', async () => {
    const { schemaStatements } = await import('./db-schema.js');
    const schemaSql = schemaStatements.join('\n').toLowerCase();

    expect(schemaSql).toContain('create table if not exists agent_packages');
    expect(schemaSql).toContain(
      'create table if not exists agent_package_versions',
    );
    expect(schemaSql).toContain('create table if not exists arena_threads');
    expect(schemaSql).toContain('create table if not exists arena_thread_variants');
    expect(schemaSql).toContain('create table if not exists arena_messages');
    expect(schemaSql).toContain('create table if not exists arena_runs');
    expect(schemaSql).toContain('create table if not exists optimization_runs');
    expect(schemaSql).toContain(
      'create table if not exists interactive_optimization_sessions',
    );
    expect(schemaSql).toContain('create table if not exists auto_eval_specs');
    expect(schemaSql).toContain('create table if not exists auto_eval_runs');
    expect(schemaSql).toContain(
      'alter table agent_package_versions add column if not exists note',
    );
  });

  it('defines independent skill version tables with relationship constraints', async () => {
    const { schemaStatements } = await import('./db-schema.js');
    const schemaSql = schemaStatements.join('\n').toLowerCase();

    expect(schemaSql).toContain(
      'create table if not exists agent_package_skills',
    );
    expect(schemaSql).toContain(
      'create table if not exists agent_skill_versions',
    );
    expect(schemaSql).toContain(
      'create table if not exists agent_package_version_skills',
    );
    expect(schemaSql).toContain(
      'references agent_packages(id) on delete cascade',
    );
    expect(schemaSql).toContain(
      'references agent_package_versions(id, package_id) on delete cascade',
    );
    expect(schemaSql).toContain(
      'references agent_package_skills(id, package_id) on delete cascade',
    );
    expect(schemaSql).toContain("check (status in ('active', 'removed'))");
    expect(schemaSql).toContain("check (status in ('active', 'discarded'))");
    expect(schemaSql).toContain(
      "check (jsonb_typeof(skill_snapshot_json) = 'object')",
    );
    expect(schemaSql).toContain('unique (package_id, skill_uid)');
    expect(schemaSql).toContain('unique (skill_id, version_number)');
    expect(schemaSql).toContain('unique (package_id, version_number)');
    expect(schemaSql).toContain('foreign key (based_on_version_id, skill_id)');
    expect(schemaSql).toContain(
      'references agent_skill_versions(id, skill_id)',
    );
    expect(schemaSql).toContain(
      'foreign key (skill_version_id, skill_id, package_id)',
    );
  });

  it('defines API idempotency storage for action based writes', async () => {
    const { schemaStatements } = await import('./db-schema.js');
    const schemaSql = schemaStatements.join('\n').toLowerCase();

    expect(schemaSql).toContain(
      'create table if not exists api_idempotency_keys',
    );
    expect(schemaSql).toContain(
      "status text not null default 'pending' check (status in ('pending', 'completed'))",
    );
    expect(schemaSql).toContain('response_status integer');
    expect(schemaSql).toContain('response_json jsonb');
    expect(schemaSql).toContain('expires_at timestamptz not null');
    expect(schemaSql).toContain(
      'unique (user_id, action, package_id, idempotency_key)',
    );
  });

  it('defines persisted guided Skill creation sessions and messages', async () => {
    const { schemaStatements } = await import('./db-schema.js');
    const schemaSql = schemaStatements.join('\n').toLowerCase();
    const compactSchemaSql = schemaSql.replace(/\s+/g, ' ');

    expect(schemaSql).toContain(
      'create table if not exists skill_guided_creation_sessions',
    );
    expect(schemaSql).toContain(
      'create table if not exists skill_guided_creation_messages',
    );
    expect(schemaSql).toContain("status text not null default 'collecting'");
    expect(schemaSql).toContain("'ready_for_confirmation'");
    expect(schemaSql).toContain("'finalizing'");
    expect(schemaSql).toContain("'completed'");
    expect(schemaSql).toContain("'failed'");
    expect(schemaSql).toContain("'cancelled'");
    expect(schemaSql).toContain("documents_json jsonb not null default '[]'::jsonb");
    expect(schemaSql).toContain("draft_json jsonb not null default '{}'::jsonb");
    expect(schemaSql).toContain(
      "field_states_json jsonb not null default '{}'::jsonb",
    );
    expect(schemaSql).toContain('flow_version integer not null default 1');
    expect(schemaSql).toContain(
      "confirmed_stages_json jsonb not null default '[]'::jsonb",
    );
    expect(schemaSql).toContain('display_name varchar(200)');
    expect(schemaSql).toContain('deleted_at timestamptz');
    expect(schemaSql).toContain(
      "jsonb_typeof(confirmed_stages_json) = 'array'",
    );
    expect(schemaSql).toContain('package_id bigint');
    expect(schemaSql).toContain('skill_id bigint');
    expect(schemaSql).toContain('skill_version_id bigint');
    expect(schemaSql).toContain('start_client_message_id text');
    expect(schemaSql).toContain(
      'on skill_guided_creation_sessions (user_id, start_client_message_id)',
    );
    expect(schemaSql).toContain('unique (session_id, message_no)');
    expect(schemaSql).toContain('where package_id is not null');
    expect(schemaSql).toContain('where skill_id is not null');
    expect(schemaSql).toContain('where client_message_id is not null');
    expect(compactSchemaSql).toContain(
      'alter table skill_guided_creation_sessions add column if not exists flow_version integer not null default 1',
    );
    expect(compactSchemaSql).toContain(
      "alter table skill_guided_creation_sessions add column if not exists confirmed_stages_json jsonb not null default '[]'::jsonb",
    );
    expect(compactSchemaSql).toContain(
      'alter table skill_guided_creation_sessions add column if not exists display_name varchar(200)',
    );
    expect(compactSchemaSql).toContain(
      'alter table skill_guided_creation_sessions add column if not exists deleted_at timestamptz',
    );
  });

  it('exports multimodal schema statements with only the approved additions', async () => {
    const { multimodalSchemaStatements } = await import('./db-schema.js');
    const schemaSql = multimodalSchemaStatements.join('\n').toLowerCase();

    expect(schemaSql).toContain(
      'add column if not exists creation_mode text not null default \'guided\'',
    );
    expect(schemaSql).toContain(
      'add column if not exists start_request_hash text',
    );
    expect(schemaSql).toContain('add column if not exists media_stage text');
    expect(schemaSql).toContain(
      "add column if not exists media_state_json jsonb not null default '{}'::jsonb",
    );
    expect(schemaSql).toContain(
      'add column if not exists package_version_id bigint',
    );
    expect(schemaSql).toContain(
      'add column if not exists finalize_request_hash text',
    );
    expect(schemaSql).toContain(
      'create table if not exists skill_media_jobs',
    );
    expect(schemaSql).toContain(
      'create unique index if not exists uq_skill_media_jobs_idempotency',
    );
    expect(schemaSql).toContain(
      'create index if not exists idx_skill_media_jobs_claimable',
    );
    expect(schemaSql).toContain(
      'create index if not exists idx_skill_media_jobs_lease_expiry',
    );
    expect(schemaSql).toContain(
      'create index if not exists idx_skill_media_jobs_session_history',
    );
    expect(schemaSql).toContain(
      'create index if not exists idx_guided_sessions_multimodal_listing',
    );
    expect(schemaSql).not.toContain('references ');
    expect(schemaSql).not.toContain(' foreign key ');
    expect(schemaSql).not.toContain(' check ');
    expect(schemaSql).not.toContain('trigger');
    expect(schemaSql).not.toContain('procedure');
    expect(schemaSql).not.toContain('checkpoint');
    expect(schemaSql).not.toContain('current_job_id');
    expect(schemaSql).not.toContain('current_run_id');
  });

  it('defines stored JSON columns as jsonb with jsonb defaults', async () => {
    const { schemaStatements, migrationStatements } =
      await import('./db-schema.js');
    const schemaSql = schemaStatements.join('\n').toLowerCase();
    const migrationSql = migrationStatements.join('\n').toLowerCase();

    expect(schemaSql).toContain('snapshot_json jsonb not null');
    expect(schemaSql).toContain(
      "arena_config_jsonb jsonb not null default '{}'::jsonb",
    );
    expect(schemaSql).toContain(
      "report_json jsonb not null default '{}'::jsonb",
    );
    expect(schemaSql).toContain(
      "result_json jsonb not null default '{}'::jsonb",
    );
    expect(schemaSql).toContain(
      "messages_json jsonb not null default '[]'::jsonb",
    );
    expect(schemaSql).toContain(
      "issues_json jsonb not null default '[]'::jsonb",
    );
    expect(schemaSql).toContain(
      "adopted_json jsonb not null default '[]'::jsonb",
    );
    expect(schemaSql).toContain(
      "questions_json jsonb not null default '[]'::jsonb",
    );
    expect(schemaSql).toContain(
      "dimensions_json jsonb not null default '[]'::jsonb",
    );

    expect(schemaSql).not.toContain('_json text');
    expect(migrationSql).toContain(
      'alter column snapshot_json type jsonb using snapshot_json::jsonb',
    );
    expect(migrationSql).toContain(
      'alter column report_json type jsonb using report_json::jsonb',
    );
    expect(migrationSql).toContain(
      'alter column questions_json type jsonb using questions_json::jsonb',
    );
  });

  it('adds nullable message reasoning without forbidden constraints', async () => {
    const { schemaStatements, migrationStatements } =
      await import('./db-schema.js');
    const schemaSql = schemaStatements.join('\n').toLowerCase();
    const migrationSql = migrationStatements.join('\n').toLowerCase();

    expect(schemaSql).toMatch(
      /create table if not exists arena_messages[\s\S]*reasoning_content text/,
    );
    expect(migrationSql).toContain(
      'alter table arena_messages add column if not exists reasoning_content text',
    );
    const reasoningMigrations = migrationStatements.filter((statement) =>
      statement.toLowerCase().includes('reasoning_content'),
    );
    expect(reasoningMigrations).toHaveLength(1);
    expect(reasoningMigrations[0]?.toLowerCase()).not.toMatch(
      /references|foreign key|check\s*\(/,
    );
  });

  it('defines skill arena thread metadata and relational variant links', async () => {
    const { schemaStatements, migrationStatements } =
      await import('./db-schema.js');
    const schemaSql = schemaStatements.join('\n').toLowerCase();
    const migrationSql = migrationStatements.join('\n').toLowerCase();

    expect(schemaSql).toContain(
      "arena_kind text not null default 'package_arena'",
    );
    expect(schemaSql).toContain('base_package_version_id bigint');
    expect(schemaSql).toContain('arena_config_jsonb jsonb not null');
    expect(schemaSql).toContain('create table if not exists arena_thread_variants');
    expect(schemaSql).toContain("side text not null check (side in ('left', 'right'))");
    expect(schemaSql).toContain('foreign key (thread_id, package_id)');
    expect(schemaSql).toContain(
      'references arena_threads(id, package_id) on delete cascade',
    );
    expect(schemaSql).toContain('foreign key (skill_id, package_id)');
    expect(schemaSql).toContain(
      'references agent_package_skills(id, package_id) on delete cascade',
    );
    expect(schemaSql).toContain(
      'foreign key (skill_version_id, skill_id, package_id)',
    );
    expect(schemaSql).toContain(
      'references agent_skill_versions(id, skill_id, package_id)',
    );
    expect(schemaSql).toContain('unique (thread_id, side)');
    expect(schemaSql).toContain('target_skill_dir_name text');

    expect(migrationSql).toContain(
      "alter table arena_threads add column if not exists arena_kind text not null default 'package_arena'",
    );
    expect(migrationSql).toContain(
      'alter table interactive_optimization_sessions add column if not exists target_skill_dir_name text',
    );
    expect(migrationSql).toContain(
      'alter table arena_threads add column if not exists base_package_version_id bigint',
    );
    expect(migrationSql).toContain(
      "alter table arena_threads add column if not exists arena_config_jsonb jsonb not null default '{}'::jsonb",
    );
  });
});
