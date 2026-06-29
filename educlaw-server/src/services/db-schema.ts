import { checkDbConnection, query } from "./db.js";

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
      version_number integer not null,
      source text not null,
      snapshot_json text not null,
      note text not null default '',
      created_at timestamptz not null
    )
  `,
  `
    create index if not exists idx_agent_package_versions_package_id on agent_package_versions (package_id)
  `,
  `
    alter table agent_package_versions add column if not exists note text not null default ''
  `,
  `
    create table if not exists arena_threads (
      id bigserial primary key,
      user_id text not null,
      package_id bigint not null,
      title text not null,
      model text,
      created_at timestamptz not null,
      updated_at timestamptz not null
    )
  `,
  `
    create index if not exists idx_arena_threads_user_id on arena_threads (user_id)
  `,
  `
    create index if not exists idx_arena_threads_package_id on arena_threads (package_id)
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
      report_json text not null default '{}',
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
      result_json text not null default '{}',
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
      messages_json text not null default '[]',
      issues_json text not null default '[]',
      adopted_json text not null default '[]',
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
      questions_json text not null default '[]',
      dimensions_json text not null default '[]',
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
      questions_json text not null default '[]',
      report_json text not null default '{}',
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
 * Migrate existing text timestamp columns to TIMESTAMPTZ.
 * These statements are idempotent — they only run when the column is still `text`.
 */
export const migrationStatements = [
  // agent_packages
  `alter table agent_packages alter column created_at type timestamptz using created_at::timestamptz`,
  `alter table agent_packages alter column updated_at type timestamptz using updated_at::timestamptz`,
  // agent_package_versions
  `alter table agent_package_versions alter column created_at type timestamptz using created_at::timestamptz`,
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

  // Migrate text columns to TIMESTAMPTZ — safe to re-run; ALTER TYPE is a no-op when already timestamptz.
  for (const statement of migrationStatements) {
    try {
      await query(statement);
    } catch {
      // column already timestamptz or table does not exist yet — skip
    }
  }
}
