import { checkDbConnection, query } from './db.js';

export const schemaStatements = [
  `
    create table if not exists agent_packages (
      id bigserial primary key,
      user_id text not null,
      name text not null,
      description text not null default '',
      current_version_id bigint not null,
      created_at timestamptz not null,
      updated_at timestamptz not null
    )
  `,
  `
    create index if not exists idx_agent_packages_user_id on agent_packages (user_id)
  `,
  `
    create table if not exists agent_package_versions (
      id bigserial primary key,
      package_id bigint not null,
      version_number integer not null check (version_number > 0),
      source text not null,
      snapshot_json jsonb not null,
      note text not null default '',
      created_at timestamptz not null,
      unique (package_id, version_number),
      unique (id, package_id)
    )
  `,
  `
    create index if not exists idx_agent_package_versions_package_id on agent_package_versions (package_id)
  `,
  `
    alter table agent_package_versions add column if not exists note text not null default ''
  `,
  `
    create table if not exists agent_package_skills (
      id bigserial primary key,
      package_id bigint not null references agent_packages(id) on delete cascade,
      skill_uid text not null,
      dir_name text not null,
      name text not null,
      description text not null default '',
      status text not null default 'active' check (status in ('active', 'removed')),
      next_version_number integer not null default 1 check (next_version_number > 0),
      created_at timestamptz not null,
      updated_at timestamptz not null,
      removed_at timestamptz,
      removed_by text,
      remove_reason text,
      unique (package_id, skill_uid),
      unique (id, package_id),
      check (
        (status = 'active' and removed_at is null and remove_reason is null)
        or
        (status = 'removed' and removed_at is not null and remove_reason is not null)
      )
    )
  `,
  `
    create index if not exists idx_agent_package_skills_package_status
      on agent_package_skills (package_id, status, id)
  `,
  `
    create table if not exists agent_skill_versions (
      id bigserial primary key,
      skill_id bigint not null references agent_package_skills(id) on delete cascade,
      package_id bigint not null references agent_packages(id) on delete cascade,
      created_in_package_version_id bigint not null,
      version_number integer not null check (version_number > 0),
      source text not null check (source in ('generated', 'imported', 'optimized', 'manual', 'interactive', 'rollback')),
      based_on_version_id bigint,
      skill_snapshot_json jsonb not null check (jsonb_typeof(skill_snapshot_json) = 'object'),
      content_hash text not null,
      status text not null default 'active' check (status in ('active', 'discarded')),
      note text not null default '',
      created_at timestamptz not null,
      discarded_at timestamptz,
      discarded_by text,
      discard_reason text,
      restored_at timestamptz,
      restored_by text,
      unique (skill_id, version_number),
      unique (id, skill_id),
      unique (id, skill_id, package_id),
      foreign key (created_in_package_version_id, package_id)
        references agent_package_versions(id, package_id) on delete cascade,
      foreign key (based_on_version_id, skill_id)
        references agent_skill_versions(id, skill_id),
      check (
        (status = 'active' and discarded_at is null and discard_reason is null)
        or
        (status = 'discarded' and discarded_at is not null and discard_reason is not null)
      )
    )
  `,
  `
    create index if not exists idx_agent_skill_versions_skill_status_number
      on agent_skill_versions (skill_id, status, version_number desc)
  `,
  `
    create index if not exists idx_agent_skill_versions_package_version
      on agent_skill_versions (created_in_package_version_id)
  `,
  `
    create table if not exists agent_package_version_skills (
      package_version_id bigint not null,
      package_id bigint not null references agent_packages(id) on delete cascade,
      skill_id bigint not null,
      skill_version_id bigint not null,
      sort_order integer not null check (sort_order >= 0),
      foreign key (package_version_id, package_id)
        references agent_package_versions(id, package_id) on delete cascade,
      foreign key (skill_id, package_id)
        references agent_package_skills(id, package_id) on delete cascade,
      foreign key (skill_version_id, skill_id, package_id)
        references agent_skill_versions(id, skill_id, package_id),
      primary key (package_version_id, skill_id)
    )
  `,
  `
    create index if not exists idx_agent_package_version_skills_version
      on agent_package_version_skills (skill_version_id)
  `,
  `
    create index if not exists idx_agent_package_version_skills_package_version
      on agent_package_version_skills (package_version_id, sort_order)
  `,
  `
    create table if not exists api_idempotency_keys (
      id bigserial primary key,
      user_id text not null,
      action text not null,
      package_id bigint not null references agent_packages(id) on delete cascade,
      idempotency_key text not null,
      request_hash text not null,
      status text not null default 'pending' check (status in ('pending', 'completed')),
      response_status integer,
      response_json jsonb,
      created_at timestamptz not null,
      expires_at timestamptz not null,
      unique (user_id, action, package_id, idempotency_key)
    )
  `,
  `
    create table if not exists arena_threads (
      id bigserial primary key,
      user_id text not null,
      package_id bigint not null references agent_packages(id) on delete cascade,
      title text not null,
      model text,
      arena_kind text not null default 'package_arena' check (arena_kind in ('package_arena', 'skill_arena')),
      base_package_version_id bigint,
      arena_config_jsonb jsonb not null default '{}'::jsonb,
      created_at timestamptz not null,
      updated_at timestamptz not null,
      unique (id, package_id),
      foreign key (base_package_version_id, package_id)
        references agent_package_versions(id, package_id)
    )
  `,
  `
    create index if not exists idx_arena_threads_user_id on arena_threads (user_id)
  `,
  `
    create index if not exists idx_arena_threads_package_id on arena_threads (package_id)
  `,
  `
    create table if not exists arena_thread_variants (
      id bigserial primary key,
      thread_id bigint not null,
      package_id bigint not null references agent_packages(id) on delete cascade,
      side text not null check (side in ('left', 'right')),
      skill_id bigint not null,
      skill_version_id bigint not null,
      created_at timestamptz not null default now(),
      foreign key (thread_id, package_id)
        references arena_threads(id, package_id) on delete cascade,
      foreign key (skill_id, package_id)
        references agent_package_skills(id, package_id) on delete cascade,
      foreign key (skill_version_id, skill_id, package_id)
        references agent_skill_versions(id, skill_id, package_id),
      unique (thread_id, side)
    )
  `,
  `
    create index if not exists idx_arena_thread_variants_thread_side
      on arena_thread_variants (thread_id, side)
  `,
  `
    create table if not exists arena_messages (
      id bigserial primary key,
      thread_id bigint not null,
      user_id text not null,
      side text not null,
      role text not null,
      content text not null,
      created_at timestamptz not null
    )
  `,
  `
    create index if not exists idx_arena_messages_user_id on arena_messages (user_id)
  `,
  `
    create table if not exists arena_runs (
      id bigserial primary key,
      session_id text not null,
      package_id bigint not null,
      target_kind text not null default 'profile',
      target_ref text not null,
      model text,
      state smallint not null default 1,
      report_json jsonb not null default '{}'::jsonb,
      created_at timestamptz not null,
      updated_at timestamptz not null
    )
  `,
  `
    create index if not exists idx_arena_runs_session_id on arena_runs (session_id)
  `,
  `
    create index if not exists idx_arena_runs_package_id on arena_runs (package_id)
  `,
  `
    create table if not exists optimization_runs (
      id bigserial primary key,
      package_id bigint not null,
      thread_id bigint not null,
      target_kind text not null default 'profile',
      target_ref text not null,
      model text,
      status text not null default 'pending',
      result_json jsonb not null default '{}'::jsonb,
      created_at timestamptz not null,
      updated_at timestamptz not null
    )
  `,
  `
    create index if not exists idx_optimization_runs_package_id on optimization_runs (package_id)
  `,
  `
    create table if not exists interactive_optimization_sessions (
      id bigserial primary key,
      user_id text not null,
      package_id bigint not null,
      thread_id bigint not null,
      status text not null default 'active',
      messages_json jsonb not null default '[]'::jsonb,
      issues_json jsonb not null default '[]'::jsonb,
      adopted_json jsonb not null default '[]'::jsonb,
      summary text not null default '',
      version_id bigint,
      version_number integer,
      created_at timestamptz not null,
      updated_at timestamptz not null
    )
  `,
  `
    create index if not exists idx_interactive_optimization_sessions_user_id on interactive_optimization_sessions (user_id)
  `,
  `
    create index if not exists idx_interactive_optimization_sessions_package_id on interactive_optimization_sessions (package_id)
  `,
  `
    create table if not exists auto_eval_specs (
      id bigserial primary key,
      user_id text not null,
      package_id bigint not null,
      questions_json jsonb not null default '[]'::jsonb,
      dimensions_json jsonb not null default '[]'::jsonb,
      created_at timestamptz not null,
      updated_at timestamptz not null,
      unique (user_id, package_id)
    )
  `,
  `
    create index if not exists idx_auto_eval_specs_user_id on auto_eval_specs (user_id)
  `,
  `
    create table if not exists auto_eval_runs (
      id bigserial primary key,
      user_id text not null,
      package_id bigint not null,
      scene_name text not null,
      status text not null default 'pending',
      questions_json jsonb not null default '[]'::jsonb,
      report_json jsonb not null default '{}'::jsonb,
      error_message text not null default '',
      created_at timestamptz not null,
      updated_at timestamptz not null
    )
  `,
  `
    create index if not exists idx_auto_eval_runs_user_id on auto_eval_runs (user_id)
  `,
];

/**
 * Migrate existing columns to the current schema shape.
 * Statements are run independently so an already-migrated column does not block later migrations.
 */
export const migrationStatements = [
  // JSON text columns to JSONB.
  `alter table agent_package_versions alter column snapshot_json type jsonb using snapshot_json::jsonb`,
  `alter table api_idempotency_keys add column if not exists status text not null default 'pending'`,
  `alter table api_idempotency_keys add column if not exists response_status integer`,
  `alter table api_idempotency_keys add column if not exists response_json jsonb`,
  `alter table api_idempotency_keys add column if not exists expires_at timestamptz`,
  `update api_idempotency_keys
   set status = 'completed'
   where status is null or status = ''`,
  `update api_idempotency_keys
   set expires_at = created_at + interval '1 day'
   where expires_at is null`,
  `alter table arena_runs alter column report_json drop default`,
  `alter table arena_runs alter column report_json type jsonb using report_json::jsonb`,
  `alter table arena_runs alter column report_json set default '{}'::jsonb`,
  `alter table optimization_runs alter column result_json drop default`,
  `alter table optimization_runs alter column result_json type jsonb using result_json::jsonb`,
  `alter table optimization_runs alter column result_json set default '{}'::jsonb`,
  `alter table interactive_optimization_sessions alter column messages_json drop default`,
  `alter table interactive_optimization_sessions alter column messages_json type jsonb using messages_json::jsonb`,
  `alter table interactive_optimization_sessions alter column messages_json set default '[]'::jsonb`,
  `alter table interactive_optimization_sessions alter column issues_json drop default`,
  `alter table interactive_optimization_sessions alter column issues_json type jsonb using issues_json::jsonb`,
  `alter table interactive_optimization_sessions alter column issues_json set default '[]'::jsonb`,
  `alter table interactive_optimization_sessions alter column adopted_json drop default`,
  `alter table interactive_optimization_sessions alter column adopted_json type jsonb using adopted_json::jsonb`,
  `alter table interactive_optimization_sessions alter column adopted_json set default '[]'::jsonb`,
  `alter table auto_eval_specs alter column questions_json drop default`,
  `alter table auto_eval_specs alter column questions_json type jsonb using questions_json::jsonb`,
  `alter table auto_eval_specs alter column questions_json set default '[]'::jsonb`,
  `alter table auto_eval_specs alter column dimensions_json drop default`,
  `alter table auto_eval_specs alter column dimensions_json type jsonb using dimensions_json::jsonb`,
  `alter table auto_eval_specs alter column dimensions_json set default '[]'::jsonb`,
  `alter table auto_eval_runs alter column questions_json drop default`,
  `alter table auto_eval_runs alter column questions_json type jsonb using questions_json::jsonb`,
  `alter table auto_eval_runs alter column questions_json set default '[]'::jsonb`,
  `alter table auto_eval_runs alter column report_json drop default`,
  `alter table auto_eval_runs alter column report_json type jsonb using report_json::jsonb`,
  `alter table auto_eval_runs alter column report_json set default '{}'::jsonb`,
  // agent_packages
  `alter table agent_packages alter column created_at type timestamptz using created_at::timestamptz`,
  `alter table agent_packages alter column updated_at type timestamptz using updated_at::timestamptz`,
  // agent_package_versions
  `alter table agent_package_versions alter column created_at type timestamptz using created_at::timestamptz`,
  `do $$ begin
     if not exists (
       select 1 from pg_constraint where conname = 'uq_agent_package_versions_package_version'
     ) then
       alter table agent_package_versions
         add constraint uq_agent_package_versions_package_version
         unique (package_id, version_number);
     end if;
   end $$`,
  `do $$ begin
     if not exists (
       select 1 from pg_constraint where conname = 'uq_agent_package_versions_id_package'
     ) then
       alter table agent_package_versions
         add constraint uq_agent_package_versions_id_package
         unique (id, package_id);
     end if;
   end $$`,
  `do $$ begin
     if not exists (
       select 1 from pg_constraint where conname = 'uq_agent_package_skills_id_package'
     ) then
       alter table agent_package_skills
         add constraint uq_agent_package_skills_id_package
         unique (id, package_id);
     end if;
   end $$`,
  `do $$ begin
     if not exists (
       select 1 from pg_constraint where conname = 'uq_agent_skill_versions_id_skill'
     ) then
       alter table agent_skill_versions
         add constraint uq_agent_skill_versions_id_skill
         unique (id, skill_id);
     end if;
   end $$`,
  `do $$ begin
     if not exists (
       select 1 from pg_constraint where conname = 'uq_agent_skill_versions_id_skill_package'
     ) then
       alter table agent_skill_versions
         add constraint uq_agent_skill_versions_id_skill_package
         unique (id, skill_id, package_id);
     end if;
   end $$`,
  `do $$ begin
     if not exists (
       select 1 from pg_constraint where conname = 'fk_agent_skill_versions_created_in_package'
     ) then
       alter table agent_skill_versions
         add constraint fk_agent_skill_versions_created_in_package
         foreign key (created_in_package_version_id, package_id)
         references agent_package_versions(id, package_id) on delete cascade;
     end if;
   end $$`,
  `do $$ begin
     if not exists (
       select 1 from pg_constraint where conname = 'fk_agent_skill_versions_based_on_same_skill'
     ) then
       alter table agent_skill_versions
         add constraint fk_agent_skill_versions_based_on_same_skill
         foreign key (based_on_version_id, skill_id)
         references agent_skill_versions(id, skill_id);
     end if;
   end $$`,
  `do $$ begin
     if not exists (
       select 1 from pg_constraint where conname = 'fk_agent_package_version_skills_version_package'
     ) then
       alter table agent_package_version_skills
         add constraint fk_agent_package_version_skills_version_package
         foreign key (package_version_id, package_id)
         references agent_package_versions(id, package_id) on delete cascade;
     end if;
   end $$`,
  `do $$ begin
     if not exists (
       select 1 from pg_constraint where conname = 'fk_agent_package_version_skills_skill_package'
     ) then
       alter table agent_package_version_skills
         add constraint fk_agent_package_version_skills_skill_package
         foreign key (skill_id, package_id)
         references agent_package_skills(id, package_id) on delete cascade;
     end if;
   end $$`,
  `do $$ begin
     if not exists (
       select 1 from pg_constraint where conname = 'fk_agent_package_version_skills_skill_version'
     ) then
       alter table agent_package_version_skills
         add constraint fk_agent_package_version_skills_skill_version
         foreign key (skill_version_id, skill_id, package_id)
         references agent_skill_versions(id, skill_id, package_id);
     end if;
   end $$`,
  `alter table arena_threads add column if not exists arena_kind text not null default 'package_arena'`,
  `alter table arena_threads add column if not exists base_package_version_id bigint`,
  `alter table arena_threads add column if not exists arena_config_jsonb jsonb not null default '{}'::jsonb`,
  `do $$ begin
     if not exists (
       select 1 from pg_constraint where conname = 'chk_arena_threads_kind'
     ) then
       alter table arena_threads
         add constraint chk_arena_threads_kind
         check (arena_kind in ('package_arena', 'skill_arena'));
     end if;
   end $$`,
  `do $$ begin
     if not exists (
       select 1 from pg_constraint where conname = 'uq_arena_threads_id_package'
     ) then
       alter table arena_threads
         add constraint uq_arena_threads_id_package
         unique (id, package_id);
     end if;
   end $$`,
  `do $$ begin
     if not exists (
       select 1 from pg_constraint where conname = 'fk_arena_threads_base_package_version'
     ) then
       alter table arena_threads
         add constraint fk_arena_threads_base_package_version
         foreign key (base_package_version_id, package_id)
         references agent_package_versions(id, package_id);
     end if;
   end $$`,
  `create table if not exists arena_thread_variants (
      id bigserial primary key,
      thread_id bigint not null,
      package_id bigint not null references agent_packages(id) on delete cascade,
      side text not null check (side in ('left', 'right')),
      skill_id bigint not null,
      skill_version_id bigint not null,
      created_at timestamptz not null default now(),
      unique (thread_id, side)
    )`,
  `do $$ begin
     if not exists (
       select 1 from pg_constraint where conname = 'fk_arena_thread_variants_thread_package'
     ) then
       alter table arena_thread_variants
         add constraint fk_arena_thread_variants_thread_package
         foreign key (thread_id, package_id)
         references arena_threads(id, package_id) on delete cascade;
     end if;
   end $$`,
  `do $$ begin
     if not exists (
       select 1 from pg_constraint where conname = 'fk_arena_thread_variants_skill_package'
     ) then
       alter table arena_thread_variants
         add constraint fk_arena_thread_variants_skill_package
         foreign key (skill_id, package_id)
         references agent_package_skills(id, package_id) on delete cascade;
     end if;
   end $$`,
  `do $$ begin
     if not exists (
       select 1 from pg_constraint where conname = 'fk_arena_thread_variants_skill_version'
     ) then
       alter table arena_thread_variants
         add constraint fk_arena_thread_variants_skill_version
         foreign key (skill_version_id, skill_id, package_id)
         references agent_skill_versions(id, skill_id, package_id);
     end if;
   end $$`,
  `create index if not exists idx_arena_thread_variants_thread_side
     on arena_thread_variants (thread_id, side)`,
  // arena_threads
  `alter table arena_threads alter column created_at type timestamptz using created_at::timestamptz`,
  `alter table arena_threads alter column updated_at type timestamptz using updated_at::timestamptz`,
  // arena_messages
  `alter table arena_messages alter column created_at type timestamptz using created_at::timestamptz`,
  // arena_runs
  `alter table arena_runs alter column created_at type timestamptz using created_at::timestamptz`,
  `alter table arena_runs alter column updated_at type timestamptz using updated_at::timestamptz`,
  // optimization_runs
  `alter table optimization_runs alter column created_at type timestamptz using created_at::timestamptz`,
  `alter table optimization_runs alter column updated_at type timestamptz using updated_at::timestamptz`,
  // interactive_optimization_sessions
  `alter table interactive_optimization_sessions alter column created_at type timestamptz using created_at::timestamptz`,
  `alter table interactive_optimization_sessions alter column updated_at type timestamptz using updated_at::timestamptz`,
  // auto_eval_specs
  `alter table auto_eval_specs alter column created_at type timestamptz using created_at::timestamptz`,
  `alter table auto_eval_specs alter column updated_at type timestamptz using updated_at::timestamptz`,
  // auto_eval_runs
  `alter table auto_eval_runs alter column created_at type timestamptz using created_at::timestamptz`,
  `alter table auto_eval_runs alter column updated_at type timestamptz using updated_at::timestamptz`,
];

export async function initDbSchema() {
  await checkDbConnection();

  for (const statement of schemaStatements) {
    await query(statement);
  }

  // Migrations are safe to re-run; already-applied statements are skipped individually.
  for (const statement of migrationStatements) {
    try {
      await query(statement);
    } catch {
      // column already timestamptz or table does not exist yet — skip
    }
  }
}
