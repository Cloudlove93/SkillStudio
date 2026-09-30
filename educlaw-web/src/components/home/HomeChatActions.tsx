import { useState } from 'react';
import { BookOpen, Check, Loader2, GraduationCap } from 'lucide-react';
import { getOpenAgentMessageText, toLegacyOpenAgentMessages } from '@openagent/core/messages';
import type { OpenAgentMessage } from '@openagent/core/types';
import { useT } from '../../i18n';
import { apiPost, matchProfiles, API_BASE } from '../../api/client';
import { useDiaryStore } from '../../stores/diary';
import { useHomeChatStore } from '../../stores/home-chat';

export function useDiaryAction(sessionId: string, getMessages: () => OpenAgentMessage[]) {
  const diaryStatus = useHomeChatStore((s) => s.diaryStatusMap.get(sessionId) ?? 'idle');
  const setDiaryStatus = useHomeChatStore((s) => s.setDiaryStatus);

  async function handleSaveToDiary() {
    const messages = getMessages();
    if (diaryStatus === 'loading' || messages.length === 0) return;
    setDiaryStatus(sessionId, 'loading');
    try {
      const res = await apiPost<{ ok: boolean; date: string }>(`${API_BASE}/api/chat/summarize-to-diary`, {
        messages: toLegacyOpenAgentMessages(messages).map((message) => ({
          role: message.role,
          content: message.content,
        })),
        sessionId,
      });
      const diaryStore = useDiaryStore.getState();
      if (diaryStore.selectedDate !== res.date) {
        useDiaryStore.setState({ selectedDate: res.date, autoSaveStatus: 'idle' });
      }
      diaryStore.loadDiary(res.date);
      setDiaryStatus(sessionId, 'success');
      setTimeout(() => setDiaryStatus(sessionId, 'idle'), 3000);
    } catch {
      setDiaryStatus(sessionId, 'error');
      setTimeout(() => setDiaryStatus(sessionId, 'idle'), 3000);
    }
  }

  function resetDiaryStatus() { setDiaryStatus(sessionId, 'idle'); }

  return { diaryStatus, handleSaveToDiary, resetDiaryStatus };
}

export function useDeepStudyAction(getMessages: () => OpenAgentMessage[]) {
  const [deepStudyOpen, setDeepStudyOpen] = useState(false);
  const [deepStudyLoading, setDeepStudyLoading] = useState(false);
  const [deepStudyProfiles, setDeepStudyProfiles] = useState<{ fileName: string; name: string; description: string; score: number }[]>([]);
  const [deepStudyChatText, setDeepStudyChatText] = useState('');

  async function handleDeepStudy() {
    const chatText = getMessages().map((message) => getOpenAgentMessageText(message)).join('\n');
    if (!chatText.trim()) return;
    setDeepStudyChatText(chatText);
    setDeepStudyOpen(true);
    setDeepStudyLoading(true);
    setDeepStudyProfiles([]);
    try {
      const res = await matchProfiles(chatText);
      setDeepStudyProfiles(res.profiles);
    } catch {
      setDeepStudyProfiles([]);
    } finally {
      setDeepStudyLoading(false);
    }
  }

  return { deepStudyOpen, setDeepStudyOpen, deepStudyLoading, deepStudyProfiles, deepStudyChatText, handleDeepStudy };
}

export function HomeChatActionButtons({
  diaryStatus,
  onSaveToDiary,
  onDeepStudy,
}: {
  diaryStatus: 'idle' | 'loading' | 'success' | 'error';
  onSaveToDiary: () => void;
  onDeepStudy: () => void;
}) {
  const t = useT();

  return (
    <div className="flex justify-center gap-3 mt-8 mb-2">
      <button
        onClick={onDeepStudy}
        className="group relative flex items-center gap-3 px-5 py-3 rounded-2xl bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-pink-500/10 border border-indigo-500/20 hover:border-indigo-500/40 hover:from-indigo-500/20 hover:via-purple-500/20 hover:to-pink-500/20 transition-all duration-300 overflow-hidden"
      >
        <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 bg-[radial-gradient(circle_at_50%_50%,rgba(99,102,241,0.18),transparent_70%)]" />
        <div className="relative flex items-center justify-center size-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/25 group-hover:shadow-indigo-500/50 group-hover:scale-110 transition-all duration-300">
          <GraduationCap className="size-6 text-white drop-shadow" />
        </div>
        <div className="relative text-left">
          <p className="text-sm font-semibold bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent">{t('home.deepStudy')}</p>
          <p className="text-[10px] text-muted-foreground/60">{t('home.deepStudyDesc')}</p>
        </div>
      </button>

      <button
        onClick={onSaveToDiary}
        disabled={diaryStatus === 'loading'}
        className="group relative flex items-center gap-3 px-5 py-3 rounded-2xl border border-rose-500/20 bg-gradient-to-r from-rose-500/10 via-rose-500/8 to-orange-500/10 transition-all duration-300 overflow-hidden disabled:cursor-not-allowed disabled:opacity-60 hover:border-rose-500/40 hover:from-rose-500/20 hover:via-rose-500/14 hover:to-orange-500/18"
      >
        <div className="absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100 bg-[radial-gradient(circle_at_50%_50%,rgba(244,63,94,0.2),transparent_70%)]" />
        <div className="relative flex items-center justify-center size-10 rounded-xl bg-gradient-to-br from-rose-500 to-red-600 shadow-lg shadow-rose-500/25 transition-all duration-300 group-hover:scale-110 group-hover:shadow-rose-500/45">
          {diaryStatus === 'loading' ? <Loader2 className="size-5 text-white animate-spin" />
            : diaryStatus === 'success' ? <Check className="size-5 text-white" />
            : <BookOpen className="size-5 text-white drop-shadow" />}
        </div>
        <div className="relative text-left">
          <p className="bg-gradient-to-r from-rose-500 to-orange-500 bg-clip-text text-sm font-semibold text-transparent">
            {diaryStatus === 'loading' ? t('home.savingToDiary')
              : diaryStatus === 'success' ? t('home.saveToDiarySuccess')
              : diaryStatus === 'error' ? t('home.saveToDiaryFail')
              : t('home.saveToDiary')}
          </p>
          <p className="text-[10px] text-muted-foreground/60">{t('home.saveToDiaryDesc')}</p>
        </div>
      </button>
    </div>
  );
}
