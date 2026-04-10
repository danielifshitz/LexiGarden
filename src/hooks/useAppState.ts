import { startTransition, useEffect, useState } from 'react';
import { getPersistedState } from '../db';
import type {
  AppSettings,
  ChatSession,
  MarathonAnswer,
  MarathonRun,
  PersistedState,
  ReviewAttempt,
  WordEntry,
  WordStatusTransition,
} from '../types';

export type FlashMessage =
  | {
      kind: 'success' | 'error';
      text: string;
    }
  | undefined;

export function useAppState() {
  const [loading, setLoading] = useState(true);
  const [words, setWords] = useState<WordEntry[]>([]);
  const [reviewAttempts, setReviewAttempts] = useState<ReviewAttempt[]>([]);
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([]);
  const [aiUsageLogs, setAiUsageLogs] = useState<PersistedState['aiUsageLogs']>([]);
  const [statusTransitions, setStatusTransitions] = useState<WordStatusTransition[]>([]);
  const [marathonRuns, setMarathonRuns] = useState<MarathonRun[]>([]);
  const [marathonAnswers, setMarathonAnswers] = useState<MarathonAnswer[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [activeChatSessionId, setActiveChatSessionId] = useState<string | null>(null);
  const [flashMessage, setFlashMessage] = useState<FlashMessage>();

  async function refreshState(keys?: Array<keyof PersistedState>) {
    const nextState = await getPersistedState(keys);

    startTransition(() => {
      if (!keys || keys.includes('words')) setWords(nextState.words);
      if (!keys || keys.includes('reviewAttempts')) setReviewAttempts(nextState.reviewAttempts);
      if (!keys || keys.includes('chatSessions')) {
        setChatSessions(nextState.chatSessions);
        if (nextState.chatSessions.length === 0) {
          setActiveChatSessionId(null);
        } else if (
          !activeChatSessionId ||
          !nextState.chatSessions.some((session) => session.id === activeChatSessionId)
        ) {
          setActiveChatSessionId(nextState.chatSessions[0].id);
        }
      }
      if (!keys || keys.includes('aiUsageLogs')) setAiUsageLogs(nextState.aiUsageLogs);
      if (!keys || keys.includes('statusTransitions')) setStatusTransitions(nextState.statusTransitions);
      if (!keys || keys.includes('marathonRuns')) setMarathonRuns(nextState.marathonRuns);
      if (!keys || keys.includes('marathonAnswers')) setMarathonAnswers(nextState.marathonAnswers);
      if (!keys || keys.includes('settings')) setSettings(nextState.settings);
    });
  }

  useEffect(() => {
    if (!flashMessage) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      setFlashMessage(undefined);
    }, 4200);

    return () => window.clearTimeout(timeout);
  }, [flashMessage]);

  return {
    state: {
      loading,
      words,
      reviewAttempts,
      chatSessions,
      aiUsageLogs,
      statusTransitions,
      marathonRuns,
      marathonAnswers,
      settings,
      activeChatSessionId,
      flashMessage,
    },
    setters: {
      setLoading,
      setSettings,
      setActiveChatSessionId,
      setFlashMessage,
    },
    refreshState,
  };
}
