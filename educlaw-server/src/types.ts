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
  id: string;
  user_id: string;
  name: string;
  description: string;
  current_version_id: string;
  created_at: string;
  updated_at: string;
}

export interface DbRowPackageVersion {
  id: string;
  package_id: string;
  version_number: number;
  source: string;
  snapshot_json: string;
  note: string;
  created_at: string;
}

export interface DbRowThread {
  id: string;
  user_id: string;
  package_id: string;
  title: string;
  model: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbRowMessage {
  id: string;
  thread_id: string;
  user_id: string;
  side: string;
  role: string;
  content: string;
  created_at: string;
}

export interface DbRowInteractiveOptimizationSession {
  id: string;
  user_id: string;
  package_id: string;
  thread_id: string;
  status: string;
  messages_json: string;
  issues_json: string;
  adopted_json: string;
  summary: string;
  version_id: string | null;
  version_number: number | null;
  created_at: string;
  updated_at: string;
}

export interface DbRowAutoEvalSpec {
  user_id: string;
  package_id: string;
  questions_json: string;
  dimensions_json: string;
  created_at: string;
  updated_at: string;
}

export interface DbRowAutoEvalRun {
  id: string;
  user_id: string;
  package_id: string;
  scene_name: string;
  status: string;
  questions_json: string;
  report_json: string;
  error_message: string;
  created_at: string;
  updated_at: string;
}
