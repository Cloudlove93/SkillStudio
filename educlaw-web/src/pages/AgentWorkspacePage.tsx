import { AssetCenter } from '../components/asset-center/AssetCenter';
import { useAuthStore } from '../stores/auth';
export default function AgentWorkspacePage() {
  const token = useAuthStore((state) => state.token) || '';
  return <AssetCenter token={token} />;
}
