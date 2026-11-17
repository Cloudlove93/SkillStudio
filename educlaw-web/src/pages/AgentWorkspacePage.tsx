import { AssetCenter } from '../components/asset-center/AssetCenter';
import { useAuthStore } from '../stores/auth';

/** 仓库：Agent 装配与 Skill 详情。对话统一回到主页。 */
export default function AgentWorkspacePage() {
  const token = useAuthStore((state) => state.token) || '';
  return <AssetCenter token={token} />;
}
