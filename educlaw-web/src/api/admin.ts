import { apiFetchJson, BASE } from './client';

export interface AdminUserOverview {
  id: string;
  username: string;
  createdAt: string;
  agents: Array<{
    id: string;
    name: string;
    description: string;
    status: string;
    createdAt: string;
    profileFileName: string;
  }>;
  profiles: Array<{
    fileName: string;
    name: string;
    description: string;
    source: string;
  }>;
  skills: Array<{
    dirName: string;
    name: string;
    description: string;
    source: string;
  }>;
  tools: Array<{
    dirName: string;
    name: string;
    description: string;
    source: string;
  }>;
}

export interface AdminOverviewResponse {
  users: AdminUserOverview[];
}

export function fetchAdminOverview(): Promise<AdminOverviewResponse> {
  return apiFetchJson<AdminOverviewResponse>(`${BASE}/admin/overview`);
}
