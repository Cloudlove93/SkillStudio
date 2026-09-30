import type { Request } from "express";

export interface AuthedRequest extends Request {
  userId?: string;
}

export interface DbRowUser {
  id: string;
  username: string;
  password_hash: string;
  created_at: string;
}

export interface DbRowPackage {
  id: number;
  user_id: string;
  name: string;
  description: string;
  current_version_id: number;
  created_at: string;
  updated_at: string;
}

export interface DbRowPackageVersion {
  id: number;
  package_id: number;
  version_number: number;
  source: string;
  snapshot_json: unknown;
  note: string;
  created_at: string;
}

export interface DbRowThread {
  id: number;
  user_id: string;
  package_id: number;
  title: string;
  model: string | null;
  arena_kind?: string;
  base_package_version_id?: number | null;
  arena_config_jsonb?: unknown;
  created_at: string;
  updated_at: string;
}

export interface DbRowArenaThreadVariant {
  id: number;
  thread_id: number;
  package_id: number;
  side: string;
  skill_id: number;
  skill_version_id: number;
  created_at: string;
}

export interface DbRowMessage {
  id: number;
  thread_id: number;
  user_id: string;
  side: string;
  role: string;
  content: string;
  reasoning_content: string | null;
  created_at: string;
}

export interface DbRowArenaAnswerRun {
  id: number;
  user_id: string;
  thread_id: number;
  package_id: number;
  package_version_id: number;
  question_message_id: number;
  enhanced_answer_message_id: number;
  baseline_answer_message_id: number | null;
  used_skill_ids: unknown;
  context_message_ids: unknown | null;
  enhanced_model: string | null;
  baseline_used_skill_ids: unknown | null;
  baseline_context_message_ids: unknown | null;
  baseline_model: string | null;
  baseline_skill_version_id: number | null;
  enhanced_skill_version_id: number | null;
  created_at: string;
}

export interface DbRowAnswerSkillOptimizationRun {
  id: number;
  user_id: string;
  package_id: number;
  thread_id: number;
  base_version_id: number;
  question_message_id: number;
  enhanced_answer_message_id: number;
  baseline_answer_message_id: number | null;
  answer_side?: "baseline" | "enhanced" | null;
  answer_message_id?: number | null;
  evidence_version_id?: number | null;
  answer_skill_version_id?: number | null;
  working_skill_version_id?: number | null;
  user_feedback: string;
  target_skill_id: string | null;
  result_json: unknown;
  status: string;
  revision: number;
  create_request_key: string;
  create_request_hash: string;
  final_version_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface DbRowInteractiveOptimizationSession {
  id: number;
  user_id: string;
  package_id: number;
  thread_id: number;
  target_skill_dir_name: string | null;
  status: string;
  messages_json: unknown;
  issues_json: unknown;
  adopted_json: unknown;
  summary: string;
  version_id: number | null;
  version_number: number | null;
  created_at: string;
  updated_at: string;
}

export interface DbRowAutoEvalSpec {
  id: number;
  user_id: string;
  package_id: number;
  questions_json: unknown;
  dimensions_json: unknown;
  created_at: string;
  updated_at: string;
}

export interface DbRowAutoEvalRun {
  id: number;
  user_id: string;
  package_id: number;
  scene_name: string;
  status: string;
  questions_json: unknown;
  report_json: unknown;
  error_message: string;
  created_at: string;
  updated_at: string;
}
