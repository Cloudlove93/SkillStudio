import { apiFetchJson, apiPost, apiPatch } from './client';

export interface SidebarGroupItem {
  group_id: string;
  item_id: string;
  item_type: 'agent' | 'chat';
  sort_order: number;
}

export interface SidebarGroupResponse {
  id: string;
  user_id: string;
  name: string;
  icon: string;
  sort_order: number;
  created_at: string;
  items: SidebarGroupItem[];
}

export function fetchSidebarGroups(): Promise<SidebarGroupResponse[]> {
  return apiFetchJson(`/api/sidebar-groups`);
}

export function createSidebarGroup(name: string, icon: string): Promise<SidebarGroupResponse> {
  return apiPost(`/api/sidebar-groups`, { name, icon });
}

export function updateSidebarGroup(id: string, updates: { name?: string; icon?: string; sort_order?: number }): Promise<{ ok: boolean }> {
  return apiPatch(`/api/sidebar-groups/${id}`, updates);
}

export function deleteSidebarGroup(id: string): Promise<{ ok: boolean }> {
  return apiFetchJson(`/api/sidebar-groups/${id}`, { method: 'DELETE' });
}

export function addGroupItem(groupId: string, itemId: string, itemType: string): Promise<{ ok: boolean }> {
  return apiPost(`/api/sidebar-groups/${groupId}/items`, { itemId, itemType });
}

export function removeGroupItem(groupId: string, itemId: string, itemType: string): Promise<{ ok: boolean }> {
  return apiFetchJson(`/api/sidebar-groups/${groupId}/items/${itemId}/${itemType}`, { method: 'DELETE' });
}

export function moveGroupItemApi(itemId: string, itemType: string, targetGroupId: string | null): Promise<{ ok: boolean }> {
  return apiPost(`/api/sidebar-groups/move-item`, { itemId, itemType, targetGroupId });
}
