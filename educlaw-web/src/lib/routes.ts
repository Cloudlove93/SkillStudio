/**
 * 两个区域的页面地址集中在这里：
 * - 主页 `/`：新建 Agent、草稿、生成结果，以及与 Agent 对话
 * - 仓库 `/agents`：Agent 装配与 Skill 详情
 */
export type AssetTab = 'agents' | 'skills';

const ASSETS_PATH = '/agents';

function withQuery(
  path: string,
  entries: Record<string, string | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(entries)) {
    if (value) params.set(key, value);
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

export const routes = {
  home: '/',
  create: '/?view=create',
  repository: '/?view=my-skills',

  assets: (tab: AssetTab = 'agents') => withQuery(ASSETS_PATH, { tab }),

  agent: (agentId: string, tab: AssetTab = 'agents') =>
    withQuery(ASSETS_PATH, { tab, agentId }),

  /** 创作工作台里的 Skill 详情，skillKey 形如 `packageId:skillId`。 */
  workspaceSkill: (skillKey: string, view = 'overview') =>
    withQuery('/', { view, skill: skillKey }),

  skill: (packageId: string, skillId: string, versionId?: string) =>
    withQuery(ASSETS_PATH, {
      tab: 'skills',
      previewPackage: packageId,
      previewSkill: skillId,
      skillVersion: versionId,
    }),

  /** 主页里的 Agent 对话。 */
  chat: (agentId: string, conversationId?: string) =>
    withQuery('/', { agent: agentId, conversation: conversationId }),
};

export { ASSETS_PATH };
