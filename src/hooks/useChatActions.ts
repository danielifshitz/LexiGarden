import { useRef } from 'react';
import { continueVocabularyChat } from '../ai';
import { buildAiUsageLogEntry, createChatSession, deleteChatSession, logAiUsage, upsertChatSession } from '../db';
import { getLanguageProfile } from '../lib/language-settings';
import { filterWordsByTranslationLanguage, getPrimaryTranslationLanguage, getSelectionLabel, selectWordsByMode } from '../lib/study';
import type { createTranslator } from '../lib/i18n';
import type { AppSettings, ChatMessage, ChatSession, PersistedState, StudySelection, WordEntry } from '../types';
import type { FlashMessage } from './useAppState';

interface UseChatActionsProps {
  settings: AppSettings | null;
  words: WordEntry[];
  currentActiveTranslationLanguage: string;
  refreshState: (keys?: Array<keyof PersistedState>) => Promise<void>;
  setActiveChatSessionId: (id: string | null) => void;
  setAiBusyFeature: React.Dispatch<React.SetStateAction<string>>;
  setFlashMessage: (message: FlashMessage) => void;
  t: ReturnType<typeof createTranslator>;
}

export function useChatActions({
  settings,
  words,
  currentActiveTranslationLanguage,
  refreshState,
  setActiveChatSessionId,
  setAiBusyFeature,
  setFlashMessage,
  t,
}: UseChatActionsProps) {
  const chatRequestRef = useRef<{
    controller: AbortController;
    sessionId: string;
    rollbackSession: ChatSession;
  } | null>(null);

  async function handleStartChat(selection: StudySelection, tutorPrompt?: string) {
    if (!settings) {
      throw new Error(t('appSettingsNotReady'));
    }

    const scopedChatSettings = {
      ...settings,
      ...getLanguageProfile(settings, currentActiveTranslationLanguage),
    };
    const selectedWords = selectWordsByMode(
      filterWordsByTranslationLanguage(words, currentActiveTranslationLanguage),
      scopedChatSettings,
      selection,
    );
    const selectedWordIds = selectedWords.map((word) => word.id);

    const sessionLabel =
      selection.mode === 'group' && selection.group
        ? `Group: ${selection.group}`
        : getSelectionLabel(selection.mode);
    const session = await createChatSession(
      selection.mode,
      selectedWordIds,
      sessionLabel,
      tutorPrompt,
      currentActiveTranslationLanguage,
    );
    await refreshState(['chatSessions']);
    setActiveChatSessionId(session.id);
    return session;
  }

  function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
  }

  async function requestAssistantReply(
    pendingSession: ChatSession,
    selectedWords: WordEntry[],
    rollbackSession: ChatSession,
  ): Promise<ChatSession | null> {
    if (!settings) {
      return pendingSession;
    }

    setAiBusyFeature((current) => current ? current : `chat:${pendingSession.id}`);
    const controller = new AbortController();
    chatRequestRef.current = {
      controller,
      sessionId: pendingSession.id,
      rollbackSession,
    };

    try {
      const activeLanguageProfile = getLanguageProfile(
        settings,
        pendingSession.translationLanguage ?? currentActiveTranslationLanguage,
      );
      const response = await continueVocabularyChat(
        settings,
        pendingSession.messages,
        selectedWords,
        pendingSession.translationLanguage ??
          getPrimaryTranslationLanguage(selectedWords) ??
          currentActiveTranslationLanguage,
        activeLanguageProfile.learnerName,
        activeLanguageProfile.tutorName,
        pendingSession.tutorPrompt,
        controller.signal,
      );

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: response.assistantMessage,
        createdAt: new Date().toISOString(),
      };

      const completedSession: ChatSession = {
        ...pendingSession,
        messages: [...pendingSession.messages, assistantMessage],
        updatedAt: assistantMessage.createdAt,
      };

      await upsertChatSession(completedSession);
      await logAiUsage(buildAiUsageLogEntry('chat', response.model, response.usage, true));
      await refreshState(['chatSessions', 'aiUsageLogs']);
      return completedSession;
    } catch (error) {
      if (isAbortError(error)) {
        await upsertChatSession(rollbackSession);
        await logAiUsage(
          buildAiUsageLogEntry('chat', settings.openRouterModel, undefined, false, t('aiLogCanceled')),
        );
        await refreshState(['chatSessions', 'aiUsageLogs']);
        return null;
      }

      await upsertChatSession(rollbackSession);
        await logAiUsage(
          buildAiUsageLogEntry(
            'chat',
            settings.openRouterModel,
            undefined,
            false,
            error instanceof Error ? error.message : t('aiLogChatFailed'),
          ),
        );
        await refreshState(['chatSessions', 'aiUsageLogs']);
      setFlashMessage({
        kind: 'error',
        text:
          error instanceof Error
            ? error.message
            : t('chatReplyFailed'),
      });
      throw error;
    } finally {
      if (chatRequestRef.current?.sessionId === pendingSession.id) {
        chatRequestRef.current = null;
      }

      setAiBusyFeature((current) => (current === `chat:${pendingSession.id}` ? '' : current));
    }
  }

  async function handleSendChatMessage(session: ChatSession, messageText: string, selectedWords: WordEntry[]) {
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: messageText,
      createdAt: new Date().toISOString(),
    };

    const pendingSession: ChatSession = {
      ...session,
      messages: [...session.messages, userMessage],
      updatedAt: userMessage.createdAt,
    };

    await upsertChatSession(pendingSession);
    await refreshState(['chatSessions']);

    return requestAssistantReply(pendingSession, selectedWords, session);
  }

  async function handleEditChatMessage(
    session: ChatSession,
    messageId: string,
    messageText: string,
    selectedWords: WordEntry[],
  ) {
    const messageIndex = session.messages.findIndex(
      (message) => message.id === messageId && message.role === 'user',
    );

    if (messageIndex === -1) {
      throw new Error(t('appUserMessageNotFound'));
    }

    const editedAt = new Date().toISOString();
    const trimmedText = messageText.trim();

    const updatedMessages = session.messages.slice(0, messageIndex + 1).map((message) =>
      message.id === messageId ? { ...message, content: trimmedText, createdAt: editedAt } : message,
    );

    const pendingSession: ChatSession = {
      ...session,
      messages: updatedMessages,
      updatedAt: editedAt,
    };

    await upsertChatSession(pendingSession);
    await refreshState(['chatSessions']);

    return requestAssistantReply(pendingSession, selectedWords, session);
  }

  function handleStopChatGeneration() {
    chatRequestRef.current?.controller.abort();
  }

  async function handleRenameChat(session: ChatSession, nextLabel?: string) {
    const updatedSession: ChatSession = {
      ...session,
      label: nextLabel,
      updatedAt: new Date().toISOString(),
    };

    await upsertChatSession(updatedSession);
    await refreshState(['chatSessions']);
    setFlashMessage({
      kind: 'success',
      text: t('appChatRenamed'),
    });
  }

  async function handleDeleteChat(sessionId: string) {
    await deleteChatSession(sessionId);
    await refreshState(['chatSessions']);
    setFlashMessage({
      kind: 'success',
      text: t('appChatDeleted'),
    });
  }

  return {
    actions: {
      handleStartChat,
      handleSendChatMessage,
      handleEditChatMessage,
      handleStopChatGeneration,
      handleRenameChat,
      handleDeleteChat,
    },
  };
}
