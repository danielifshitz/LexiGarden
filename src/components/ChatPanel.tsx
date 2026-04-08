import { useEffect, useRef, useState } from 'react';
import type { WordDraft, WordMutationResult } from '../db';
import { createTranslator } from '../lib/i18n';
import { MarkdownText } from './MarkdownText';
import { trimToUndefined } from '../lib/text';
import { describeWordMutation } from '../lib/word-messages';
import {
  getPrimaryTranslationLanguage,
  filterWordsByTranslationLanguage,
  getSelectionLabel,
  getUniqueGroups,
  selectWordsByMode,
} from '../lib/study';
import type {
  AiSuggestion,
  AppSettings,
  ChatSession,
  PageLayoutMode,
  SupportedAppLanguage,
  StudySelection,
  WordEntry,
} from '../types';
import { WordEditorFields, type WordEditorValue } from './WordEditorFields';

interface ChatPanelProps {
  words: WordEntry[];
  settings: AppSettings;
  appLanguage: SupportedAppLanguage;
  activeTranslationLanguage: string;
  availableTranslationLanguages: string[];
  layoutMode: PageLayoutMode;
  chatSessions: ChatSession[];
  legacyChatSessions: ChatSession[];
  activeChatSession: ChatSession | null;
  aiReady: boolean;
  structuredAiReady: boolean;
  aiBusyFeature: string;
  onStartChat: (selection: StudySelection, tutorPrompt?: string) => Promise<ChatSession>;
  onSendChatMessage: (
    session: ChatSession,
    messageText: string,
    selectedWords: WordEntry[],
  ) => Promise<ChatSession | null>;
  onEditChatMessage: (
    session: ChatSession,
    messageId: string,
    messageText: string,
    selectedWords: WordEntry[],
  ) => Promise<ChatSession | null>;
  onStopChatGeneration: () => void;
  onRenameChat: (session: ChatSession, nextLabel?: string) => Promise<void>;
  onDeleteChat: (sessionId: string) => Promise<void>;
  onPrepareSelection: (
    selectedText: string,
    context: string,
    translationLanguage: string,
  ) => Promise<AiSuggestion>;
  onCreateWord: (draft: WordDraft) => Promise<WordMutationResult>;
  onSelectSession: (sessionId: string) => void;
}

interface DraftSuggestionState extends AiSuggestion {
  selectedText: string;
}

interface ManualDraftState {
  englishText: string;
  translationText: string;
  translationLanguage: string;
  group: string;
  textHint: string;
  imageHint?: WordEntry['imageHint'];
}

function buildEmptyManualDraft(defaultTranslationLanguage: string): ManualDraftState {
  return {
    englishText: '',
    translationText: '',
    translationLanguage: defaultTranslationLanguage,
    group: '',
    textHint: '',
    imageHint: undefined,
  };
}

export function ChatPanel({
  words,
  settings,
  appLanguage,
  activeTranslationLanguage,
  availableTranslationLanguages,
  layoutMode,
  chatSessions,
  legacyChatSessions,
  activeChatSession,
  aiReady,
  structuredAiReady,
  aiBusyFeature,
  onStartChat,
  onSendChatMessage,
  onEditChatMessage,
  onStopChatGeneration,
  onRenameChat,
  onDeleteChat,
  onPrepareSelection,
  onCreateWord,
  onSelectSession,
}: ChatPanelProps) {
  const t = createTranslator(appLanguage);
  const chatAreaRef = useRef<HTMLElement | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const [selection, setSelection] = useState<StudySelection>({ mode: 'lessKnown' });
  const [composer, setComposer] = useState('');
  const [selectedText, setSelectedText] = useState('');
  const [draftSuggestion, setDraftSuggestion] = useState<DraftSuggestionState | null>(null);
  const [localMessage, setLocalMessage] = useState('');
  const [localError, setLocalError] = useState('');
  const [editingMessageId, setEditingMessageId] = useState('');
  const [editingText, setEditingText] = useState('');
  const [renamingSessionId, setRenamingSessionId] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [tutorPrompt, setTutorPrompt] = useState('');
  const [manualDraft, setManualDraft] = useState<ManualDraftState>(
    buildEmptyManualDraft(activeTranslationLanguage),
  );

  const activeLanguageWords = filterWordsByTranslationLanguage(words, activeTranslationLanguage);
  const groups = getUniqueGroups(activeLanguageWords);
  const activeWords = activeChatSession
    ? words.filter((word) => activeChatSession.selectedWordIds.includes(word.id))
    : [];
  const selectableWords = selectWordsByMode(activeLanguageWords, settings, selection);
  const selectedLanguage =
    activeChatSession?.translationLanguage ||
    getPrimaryTranslationLanguage(activeWords) ||
    draftSuggestion?.translationLanguage ||
    manualDraft.translationLanguage ||
    activeTranslationLanguage;
  const tutorDisplayName = settings.tutorName.trim() || t('settingsTutorName');
  const isChatBusy = Boolean(activeChatSession && aiBusyFeature === `chat:${activeChatSession.id}`);
  const selectionDraftValue: WordEditorValue = {
    englishText: draftSuggestion?.englishText ?? manualDraft.englishText,
    translationText: draftSuggestion?.translationText ?? manualDraft.translationText,
    translationLanguage: draftSuggestion?.translationLanguage ?? manualDraft.translationLanguage,
    group: draftSuggestion?.group ?? manualDraft.group,
    textHint: draftSuggestion?.reason ?? manualDraft.textHint,
    imageHint: manualDraft.imageHint,
  };

  useEffect(() => {
    setManualDraft((current) =>
      current.translationLanguage
        ? current
        : {
            ...current,
            translationLanguage: activeTranslationLanguage,
          },
    );
  }, [activeTranslationLanguage]);

  useEffect(() => {
    if (!threadRef.current) {
      return;
    }

    threadRef.current.scrollTo({
      top: threadRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [activeChatSession?.messages.length, isChatBusy]);

  useEffect(() => {
    setLocalError('');
    setEditingMessageId('');
    setEditingText('');
    setRenamingSessionId('');
    setRenameValue('');
    clearSelectionDraft();
  }, [activeChatSession?.id]);

  useEffect(() => {
    if (selection.mode !== 'group') {
      return;
    }

    if (groups.length === 0 && !selection.group) {
      return;
    }

    if (selection.group && groups.includes(selection.group)) {
      return;
    }

    setSelection({
      mode: 'group',
      group: groups[0],
    });
  }, [groups, selection.group, selection.mode]);

  function getSessionTitle(session: ChatSession): string {
    return session.label?.trim() || getSelectionLabel(session.scope);
  }

  function clearSelectionDraft() {
    setSelectedText('');
    setDraftSuggestion(null);
    setManualDraft(buildEmptyManualDraft(activeTranslationLanguage));
  }

  function updateSelectionDraft(patch: Partial<WordEditorValue>) {
    if ('imageHint' in patch) {
      setManualDraft((current) => ({
        ...current,
        imageHint: patch.imageHint,
      }));
    }

    if (draftSuggestion) {
      setDraftSuggestion((current) =>
        current
          ? {
              ...current,
              englishText: patch.englishText ?? current.englishText,
              translationText: patch.translationText ?? current.translationText,
              translationLanguage: patch.translationLanguage ?? current.translationLanguage,
              group: patch.group ?? current.group,
              reason: patch.textHint ?? current.reason,
            }
          : current,
      );
      return;
    }

    setManualDraft((current) => ({
      ...current,
      englishText: patch.englishText ?? current.englishText,
      translationText: patch.translationText ?? current.translationText,
      translationLanguage: patch.translationLanguage ?? current.translationLanguage,
      group: patch.group ?? current.group,
      textHint: patch.textHint ?? current.textHint,
      imageHint: 'imageHint' in patch ? patch.imageHint : current.imageHint,
    }));
  }

  async function handleStartChat() {
    const session = await onStartChat(selection, tutorPrompt.trim() || undefined);
    onSelectSession(session.id);
    setLocalError('');
    setLocalMessage(
      t('chatStarted', { count: session.selectedWordIds.length }),
    );
    requestAnimationFrame(() => {
      chatAreaRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  }

  async function handleSend() {
    if (!activeChatSession || !composer.trim()) {
      return;
    }

    setLocalError('');

    try {
      const nextSession = await onSendChatMessage(activeChatSession, composer.trim(), activeWords);

      if (nextSession) {
        onSelectSession(nextSession.id);
        setComposer('');
      }
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : t('chatReplyFailed'),
      );
    }
  }

  async function handleSaveEdit() {
    if (!activeChatSession || !editingMessageId || !editingText.trim()) {
      return;
    }

    setLocalError('');

    try {
      const nextSession = await onEditChatMessage(
        activeChatSession,
        editingMessageId,
        editingText.trim(),
        activeWords,
      );

      if (nextSession) {
        onSelectSession(nextSession.id);
        setEditingMessageId('');
        setEditingText('');
      }
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : t('chatEditFailed'),
      );
    }
  }

  function captureSelection() {
    const value = window.getSelection()?.toString().trim() ?? '';

    if (value) {
      setDraftSuggestion(null);
      setSelectedText(value);
      setManualDraft((current) => ({
        ...current,
        englishText: value,
        translationText: '',
        group: '',
        textHint: '',
        translationLanguage:
          selectedLanguage || activeWords[0]?.translationLanguage || current.translationLanguage,
      }));
      return;
    }

    clearSelectionDraft();
  }

  async function handlePrepareSelectedText() {
    if (!selectedText) {
      return;
    }

    const translationLanguage =
      selectedLanguage ||
      activeWords[0]?.translationLanguage ||
      activeLanguageWords[0]?.translationLanguage ||
      activeTranslationLanguage ||
      '';

    const context =
      activeChatSession?.messages.slice(-4).map((message) => message.content).join('\n') ?? '';

    setLocalError('');

    try {
      const suggestion = await onPrepareSelection(selectedText, context, translationLanguage);
      setDraftSuggestion({
        ...suggestion,
        selectedText,
      });
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : t('chatPrepareFailed'),
      );
    }
  }

  async function handleSaveDraftSuggestion() {
    const source = draftSuggestion
      ? {
          ...draftSuggestion,
          reason: draftSuggestion.reason ?? '',
        }
      : {
          ...manualDraft,
          selectedText,
          reason: manualDraft.textHint,
        };

    if (!source.englishText.trim() || !source.translationText.trim() || !source.translationLanguage.trim()) {
      return;
    }

    try {
      const result = await onCreateWord({
        englishText: source.englishText.trim(),
        translationText: source.translationText.trim(),
        translationLanguage: source.translationLanguage.trim(),
        group: trimToUndefined(source.group ?? ''),
        textHint: trimToUndefined(source.reason ?? ''),
        imageHint: manualDraft.imageHint,
      });

      clearSelectionDraft();
      setLocalMessage(
        describeWordMutation(result, {
          activeTranslationLanguage,
          source: 'chat',
        }),
      );
      setLocalError('');
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : t('chatAddFailed'));
    }
  }

  function beginEdit(messageId: string, content: string) {
    setEditingMessageId(messageId);
    setEditingText(content);
  }

  function clearEdit() {
    setEditingMessageId('');
    setEditingText('');
  }

  function beginRename(session: ChatSession) {
    setRenamingSessionId(session.id);
    setRenameValue(getSessionTitle(session));
    setLocalError('');
  }

  function cancelRename() {
    setRenamingSessionId('');
    setRenameValue('');
  }

  async function handleRenameChat(session: ChatSession) {
    await onRenameChat(session, renameValue.trim() || undefined);
    setLocalMessage(t('appChatRenamed'));
    cancelRename();
  }

  async function handleDeleteChatRequest(session: ChatSession) {
    if (window.confirm(t('chatDeleteConfirm', { title: getSessionTitle(session) }))) {
      await onDeleteChat(session.id);
      if (activeChatSession?.id === session.id) {
        setLocalMessage(t('appChatDeleted'));
        setLocalError('');
        clearEdit();
      }
    }
  }

  return (
    <div className={`panel-grid chat-layout ${layoutMode === 'stacked' ? 'stacked-layout' : ''}`}>
      <section className="panel accent-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t('chatEyebrow')}</p>
            <h2>{t('chatTitle')}</h2>
          </div>
          <button
            type="button"
            className="primary-button"
            disabled={!aiReady || selectableWords.length === 0 || isChatBusy}
            onClick={() => void handleStartChat()}
          >
            {t('chatNew')}
          </button>
        </div>

        <div className="filter-grid">
          <label>
            {t('chatScope')}
            <select
              value={selection.mode}
              onChange={(event) =>
                setSelection({
                  mode: event.target.value as StudySelection['mode'],
                  group: event.target.value === 'group' ? selection.group ?? groups[0] : undefined,
                })
              }
            >
              <option value="all">{t('studyModeAll')}</option>
              <option value="lastAdded">{t('studyModeLastAdded')}</option>
              <option value="group">{t('studyModeGroup')}</option>
              <option value="lessKnown">{t('studyModeLessKnown')}</option>
              <option value="lessSeen">{t('studyModeLessSeen')}</option>
            </select>
          </label>

          {selection.mode === 'group' ? (
            <label>
              {t('commonGroup')}
              <select
                value={selection.group ?? groups[0] ?? ''}
                onChange={(event) => setSelection({ mode: 'group', group: event.target.value })}
              >
                {groups.map((group) => (
                  <option key={group} value={group}>
                    {group}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        <label className="full-width">
          {t('chatTutorPrompt')}
          <textarea
            rows={3}
            value={tutorPrompt}
            onChange={(event) => setTutorPrompt(event.target.value)}
            placeholder={t('chatTutorPromptPlaceholder')}
            disabled={isChatBusy}
          />
        </label>

        <div className="session-badges">
          <span>{getSelectionLabel(selection.mode, selection.group)}</span>
          <span>{activeTranslationLanguage || t('chatNoActiveLanguage')}</span>
          <span>{t('chatWordsInScope', { count: selectableWords.length })}</span>
          <span>{aiReady ? t('chatAiReady') : t('chatSetUpAi')}</span>
        </div>

        {selection.mode === 'group' && groups.length === 0 ? (
          <p className="helper-text">{t('chatGroupedWordsHelp')}</p>
        ) : null}

        {localMessage ? <p className="helper-text">{localMessage}</p> : null}

        <div className="session-list">
          <h3>{t('chatRecentChats')}</h3>
          {chatSessions.length === 0 ? (
            <p className="helper-text">
              {activeTranslationLanguage
                ? t('chatNoChatsForLanguage', { language: activeTranslationLanguage })
                : t('chatNoChats')}
            </p>
          ) : (
            chatSessions.slice(0, 6).map((session) => (
              <article
                key={session.id}
                className={activeChatSession?.id === session.id ? 'session-card active' : 'session-card'}
              >
                {renamingSessionId === session.id ? (
                  <div className="session-rename-form">
                    <input
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.target.value)}
                      placeholder={t('chatChatNamePlaceholder')}
                      autoFocus
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && renameValue.trim()) {
                          event.preventDefault();
                          void handleRenameChat(session);
                        }
                      }}
                    />
                    <div className="session-card-actions">
                      <button
                        type="button"
                        className="link-button"
                        disabled={!renameValue.trim() || isChatBusy}
                        onClick={() => void handleRenameChat(session)}
                      >
                        {t('chatSave')}
                      </button>
                      <button type="button" className="link-button" disabled={isChatBusy} onClick={cancelRename}>
                        {t('chatCancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      className="session-open-button"
                      onClick={() => onSelectSession(session.id)}
                    >
                      <strong>{getSessionTitle(session)}</strong>
                      <small>{t('chatMessagesCount', { count: session.messages.length })}</small>
                      {session.translationLanguage ? <small>{session.translationLanguage}</small> : null}
                      {session.tutorPrompt ? <span className="session-note">{t('chatCustomTutorPrompt')}</span> : null}
                    </button>
                    <div className="session-card-actions">
                      <button
                        type="button"
                        className="link-button"
                        disabled={isChatBusy}
                        onClick={() => beginRename(session)}
                      >
                        {t('chatRename')}
                      </button>
                      <button
                        type="button"
                        className="link-button danger-link"
                        disabled={isChatBusy}
                        onClick={() => void handleDeleteChatRequest(session)}
                      >
                        {t('chatDelete')}
                      </button>
                    </div>
                  </>
                )}
              </article>
            ))
          )}
        </div>

        {legacyChatSessions.length > 0 ? (
          <div className="session-list">
            <h3>{t('chatLegacyChats')}</h3>
            <p className="helper-text">{t('chatLegacyHelp')}</p>
            {legacyChatSessions.slice(0, 6).map((session) => (
              <article
                key={session.id}
                className={activeChatSession?.id === session.id ? 'session-card active' : 'session-card'}
              >
                {renamingSessionId === session.id ? (
                  <div className="session-rename-form">
                    <input
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.target.value)}
                      placeholder={t('chatChatNamePlaceholder')}
                      autoFocus
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && renameValue.trim()) {
                          event.preventDefault();
                          void handleRenameChat(session);
                        }
                      }}
                    />
                    <div className="session-card-actions">
                      <button
                        type="button"
                        className="link-button"
                        disabled={!renameValue.trim() || isChatBusy}
                        onClick={() => void handleRenameChat(session)}
                      >
                        {t('chatSave')}
                      </button>
                      <button type="button" className="link-button" disabled={isChatBusy} onClick={cancelRename}>
                        {t('chatCancel')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      className="session-open-button"
                      onClick={() => onSelectSession(session.id)}
                    >
                      <strong>{getSessionTitle(session)}</strong>
                      <small>{t('chatMessagesCount', { count: session.messages.length })}</small>
                      <span className="session-note">{t('chatLegacyTag')}</span>
                    </button>
                    <div className="session-card-actions">
                      <button
                        type="button"
                        className="link-button"
                        disabled={isChatBusy}
                        onClick={() => beginRename(session)}
                      >
                        {t('chatRename')}
                      </button>
                      <button
                        type="button"
                        className="link-button danger-link"
                        disabled={isChatBusy}
                        onClick={() => void handleDeleteChatRequest(session)}
                      >
                        {t('chatDelete')}
                      </button>
                    </div>
                  </>
                )}
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <section ref={chatAreaRef} className="panel chat-panel">
        {!activeChatSession ? (
          <div className="empty-state large">
            <p>{t('chatEmpty')}</p>
          </div>
        ) : (
          <>
            <div className="panel-heading">
              <div>
                <p className="eyebrow">{t('chatActiveTutorEyebrow')}</p>
                <h2>{getSessionTitle(activeChatSession)}</h2>
                <p className="helper-text">{t('chatTutorGuiding', { name: tutorDisplayName })}</p>
                {activeChatSession.tutorPrompt ? (
                  <p className="helper-text">
                    {t('chatTutorPromptLabel', { prompt: activeChatSession.tutorPrompt })}
                  </p>
                ) : null}
              </div>
              <div className="stats-inline">
                <span>{t('chatGuidedWords', { count: activeWords.length })}</span>
                {selectedLanguage ? <span>{selectedLanguage}</span> : null}
              </div>
            </div>

            <div ref={threadRef} className="chat-thread" onMouseUp={captureSelection}>
              {activeChatSession.messages.map((message) => (
                <article
                  key={message.id}
                  className={message.role === 'assistant' ? 'chat-bubble assistant' : 'chat-bubble user'}
                >
                  <span>{message.role === 'assistant' ? tutorDisplayName : t('chatYou')}</span>
                  {message.role === 'assistant' ? (
                    <MarkdownText content={message.content} className="chat-markdown" />
                  ) : (
                    <p>{message.content}</p>
                  )}
                  {message.role === 'user' ? (
                    <div className="bubble-actions">
                      <button
                        type="button"
                        className="link-button"
                        disabled={isChatBusy}
                        onClick={() => beginEdit(message.id, message.content)}
                      >
                        {t('commonEdit')}
                      </button>
                    </div>
                  ) : null}
                </article>
              ))}

              {isChatBusy ? (
                <article className="chat-bubble assistant typing-bubble">
                  <span>{tutorDisplayName}</span>
                  <p>{t('chatThinking')}</p>
                </article>
              ) : null}
            </div>

            {editingMessageId ? (
              <label className="full-width">
                {t('chatEditMessageLabel')}
                <textarea
                  rows={4}
                  value={editingText}
                  onChange={(event) => setEditingText(event.target.value)}
                  disabled={isChatBusy}
                />
              </label>
            ) : (
              <label className="full-width">
                {t('chatComposeLabel')}
                <textarea
                  rows={4}
                  value={composer}
                  onChange={(event) => setComposer(event.target.value)}
                  placeholder={t('chatComposePlaceholder')}
                  disabled={isChatBusy}
                />
              </label>
            )}

            <div className="action-row action-row-spacious">
              {editingMessageId ? (
                <>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={!aiReady || !editingText.trim() || isChatBusy}
                    onClick={() => void handleSaveEdit()}
                  >
                    {t('chatSaveAndContinue')}
                  </button>
                  <button type="button" className="ghost-button" disabled={isChatBusy} onClick={clearEdit}>
                    {t('commonCancel')}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="primary-button"
                  disabled={!aiReady || !composer.trim() || isChatBusy}
                  onClick={() => void handleSend()}
                >
                  {isChatBusy ? t('commonLoading') : t('chatContinue')}
                </button>
              )}

              {isChatBusy ? (
                <button type="button" className="ghost-button" onClick={onStopChatGeneration}>
                  {t('chatStop')}
                </button>
              ) : null}

              <span className="helper-text">
                {t('chatSelectionHelp')}
              </span>
            </div>

            {localError ? (
              <p className="helper-text error-text">{localError}</p>
            ) : null}
          </>
        )}
      </section>

      <section className="panel detail-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t('chatAddFromChat')}</p>
            <h2>{selectedText ? t('chatSelectedText', { text: selectedText }) : t('chatSelectionHelp')}</h2>
          </div>
          {selectedText ? (
            <button type="button" className="ghost-button" onClick={clearSelectionDraft}>
              {t('commonClose')}
            </button>
          ) : null}
        </div>

        {!selectedText ? (
          <div className="empty-state">
            <p>{t('chatSelectionHelp')}</p>
          </div>
        ) : (
          <div className="detail-stack">
            <div className="action-row">
              <button
                type="button"
                className="secondary-button"
                disabled={!aiReady || !structuredAiReady || aiBusyFeature === 'addFromSelection'}
                onClick={() => void handlePrepareSelectedText()}
              >
                {aiBusyFeature === 'addFromSelection' ? t('commonLoading') : t('chatUseAiToFill')}
              </button>
              {!structuredAiReady && aiReady ? (
                <span className="helper-text">
                  {t('vocabNextHelpStructured')}
                </span>
              ) : null}
            </div>

            <WordEditorFields
              appLanguage={appLanguage}
              value={selectionDraftValue}
              activeTranslationLanguage={selectedLanguage}
              availableTranslationLanguages={availableTranslationLanguages}
              languageDatalistId="chat-language-options"
              onChange={updateSelectionDraft}
            />

            <button type="button" className="primary-button" onClick={() => void handleSaveDraftSuggestion()}>
              {t('vocabAddWord')}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
