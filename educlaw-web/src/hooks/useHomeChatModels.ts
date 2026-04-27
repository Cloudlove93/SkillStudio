import { useEffect, useState } from 'react';
import { apiFetchJson, API_BASE } from '../api/client';

export interface HomeChatModelOption {
  name: string;
  modelName: string;
}

export function useHomeChatModels() {
  const [models, setModels] = useState<HomeChatModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState('');

  useEffect(() => {
    let cancelled = false;

    apiFetchJson<HomeChatModelOption[]>(`${API_BASE}/llm/models`)
      .then((list) => {
        if (cancelled) return;
        setModels(list);
        setSelectedModel((current) => current || list[0]?.name || '');
      })
      .catch(() => {
        if (cancelled) return;
        setModels([]);
        setSelectedModel('');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return {
    models,
    selectedModel,
    setSelectedModel,
    hasModels: models.length > 0,
  };
}
