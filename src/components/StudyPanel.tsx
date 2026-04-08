import { useEffect, useRef, useState } from 'react';
import { createTranslator } from '../lib/i18n';
import { PromptMixPicker } from './PromptMixPicker';
import {
  areAnswersEquivalent,
  findMatchingAnswerOption,
  formatDateOnly,
  getTodayDateKey,
  isNearMiss,
  isNearMissForOptions,
  normalizeForComparison,
} from '../lib/text';
import {
  buildStudyCards,
  buildWordPrompt,
  filterWordsByTranslationLanguage,
  getSelectionLabel,
  getUniqueGroups,
  selectWordsByMode,
} from '../lib/study';
import type {
  AppSettings,
  PageLayoutMode,
  SupportedAppLanguage,
  StudyCard,
  StudySelection,
  WordEntry,
} from '../types';

interface StudyPanelProps {
  words: WordEntry[];
  settings: AppSettings;
  appLanguage: SupportedAppLanguage;
  activeTranslationLanguage: string;
  layoutMode: PageLayoutMode;
  aiReady: boolean;
  sentenceHints: Record<string, string>;
  aiBusyFeature: string;
  onRecordReview: (params: {
    wordId: string;
    promptSide: 'english' | 'translation';
    userAnswer: string;
    wasCorrect: boolean;
    usedHint: boolean;
    action: 'check' | 'dontKnow';
  }) => Promise<void>;
  onSnoozeWord: (wordId: string, promptSide: 'english' | 'translation') => Promise<void>;
  onGenerateSentence: (word: WordEntry) => Promise<string>;
}

interface FeedbackState {
  kind: 'correct' | 'incorrect' | 'revealed' | 'snoozed';
  message: string;
  answerListLabel?: string;
  answerList?: string[];
}

export function StudyPanel({
  words,
  settings,
  appLanguage,
  activeTranslationLanguage,
  layoutMode,
  aiReady,
  sentenceHints,
  aiBusyFeature,
  onRecordReview,
  onSnoozeWord,
  onGenerateSentence,
}: StudyPanelProps) {
  const t = createTranslator(appLanguage);
  const translationLabel = activeTranslationLanguage || t('commonLanguage');
  const studyAreaRef = useRef<HTMLElement | null>(null);
  const [selection, setSelection] = useState<StudySelection>({ mode: 'all' });
  const [englishPromptPercentage, setEnglishPromptPercentage] = useState(50);
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [hintVisible, setHintVisible] = useState(false);
  const [usedHint, setUsedHint] = useState(false);
  const [summary, setSummary] = useState({ correct: 0, incorrect: 0, snoozed: 0 });
  const activeLanguageWords = filterWordsByTranslationLanguage(words, activeTranslationLanguage);
  const groups = getUniqueGroups(activeLanguageWords);

  const candidateCount = selectWordsByMode(activeLanguageWords, settings, selection).filter((word) => {
    const todayKey = getTodayDateKey();
    return word.snoozedUntilDate !== todayKey;
  }).length;

  const currentCard = cards[currentIndex] ?? null;
  const promptClassName =
    currentCard?.promptSide === 'english'
      ? 'study-prompt english-display english-text'
      : 'study-prompt translation-display translation-text';
  const answerInputClassName =
    currentCard?.promptSide === 'english' ? 'translation-input' : 'english-input';
  useEffect(() => {
    if (selection.mode === 'group' && selection.group) {
      return;
    }

    if (selection.mode === 'group' && groups[0]) {
      setSelection({ mode: 'group', group: groups[0] });
    }
  }, [groups, selection.mode, selection.group]);

  function startSession() {
    const nextCards = buildStudyCards(
      activeLanguageWords,
      settings,
      selection,
      englishPromptPercentage,
    );
    setCards(nextCards);
    setCurrentIndex(0);
    setAnswer('');
    setFeedback(null);
    setHintVisible(false);
    setUsedHint(false);
    setSummary({ correct: 0, incorrect: 0, snoozed: 0 });
    requestAnimationFrame(() => {
      studyAreaRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  }

  function goToNextCard() {
    setCurrentIndex((current) => current + 1);
    setAnswer('');
    setFeedback(null);
    setHintVisible(false);
    setUsedHint(false);
  }

  function removeUpcomingCardsForWord(wordId: string) {
    setCards((current) =>
      current.filter((card, index) => index <= currentIndex || card.word.id !== wordId),
    );
  }

  async function handleCheckAnswer() {
    if (!currentCard) {
      return;
    }

    const matchedTranslation =
      currentCard.promptSide === 'english'
        ? findMatchingAnswerOption(currentCard.word.translations, answer)
        : undefined;
    const wasCorrect =
      currentCard.promptSide === 'english'
        ? Boolean(matchedTranslation)
        : areAnswersEquivalent(currentCard.word.englishText, answer);

    await onRecordReview({
      wordId: currentCard.word.id,
      promptSide: currentCard.promptSide,
      userAnswer: answer,
      wasCorrect,
      usedHint,
      action: 'check',
    });

    setSummary((current) => ({
      ...current,
      correct: current.correct + (wasCorrect ? 1 : 0),
      incorrect: current.incorrect + (wasCorrect ? 0 : 1),
    }));

    if (wasCorrect) {
      const otherAcceptedAnswers =
        currentCard.promptSide === 'english'
          ? currentCard.word.translations.filter(
              (translation) =>
                normalizeForComparison(translation) !==
                normalizeForComparison(matchedTranslation ?? ''),
            )
          : currentCard.word.translations.slice(1);

      setFeedback({
                kind: 'correct',
        message: t('studyCorrectFeedback', { word: currentCard.word.englishText }),
        answerListLabel:
          otherAcceptedAnswers.length > 0
            ? t('studyOtherAcceptedAnswers', {
                language: currentCard.word.translationLanguage,
              })
            : undefined,
        answerList: otherAcceptedAnswers,
      });
      return;
    }

    setFeedback({
      kind: 'incorrect',
      message:
        currentCard.promptSide === 'english'
          ? isNearMissForOptions(currentCard.word.translations, answer)
            ? t('studyAlmostManyAnswers', {
                word: currentCard.word.englishText,
                language: currentCard.word.translationLanguage,
              })
            : t('studyWrongManyAnswers', {
                word: currentCard.word.englishText,
                language: currentCard.word.translationLanguage,
              })
          : isNearMiss(currentCard.word.englishText, answer)
            ? t('studyAlmostEnglishWord', { word: currentCard.word.englishText })
            : t('studyWrongEnglishWord', { word: currentCard.word.englishText }),
      answerListLabel: t('studyAcceptedAnswers', {
        language: currentCard.word.translationLanguage,
      }),
      answerList: currentCard.word.translations,
    });
  }

  async function handleDontKnow() {
    if (!currentCard) {
      return;
    }

    await onRecordReview({
      wordId: currentCard.word.id,
      promptSide: currentCard.promptSide,
      userAnswer: '',
      wasCorrect: false,
      usedHint,
      action: 'dontKnow',
    });

    setSummary((current) => ({
      ...current,
      incorrect: current.incorrect + 1,
    }));

    setFeedback({
      kind: 'revealed',
      message:
        currentCard.promptSide === 'english'
          ? t('studyRevealForWord', { word: currentCard.word.englishText })
          : t('studyRevealEnglishWord', { word: currentCard.word.englishText }),
      answerListLabel: t('studyAcceptedAnswers', {
        language: currentCard.word.translationLanguage,
      }),
      answerList: currentCard.word.translations,
    });
  }

  async function handleSnooze() {
    if (!currentCard) {
      return;
    }

    await onSnoozeWord(currentCard.word.id, currentCard.promptSide);
    removeUpcomingCardsForWord(currentCard.word.id);
    setSummary((current) => ({
      ...current,
      snoozed: current.snoozed + 1,
    }));
    setFeedback({
      kind: 'snoozed',
      message: t('studyHiddenUntilMidnight'),
    });
  }

  return (
    <div className={`panel-grid study-layout ${layoutMode === 'stacked' ? 'stacked-layout' : ''}`}>
      <section className="panel accent-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t('studyEyebrow')}</p>
            <h2>{t('studyTitle')}</h2>
          </div>
          <button type="button" className="primary-button" onClick={startSession}>
            {cards.length > 0 ? t('studyReshuffle') : t('studyStartSession')}
          </button>
        </div>

        <div className="filter-grid">
          <label>
            {t('studyMode')}
            <select
              value={selection.mode}
              onChange={(event) =>
                setSelection({
                  mode: event.target.value as StudySelection['mode'],
                  group:
                    event.target.value === 'group'
                      ? selection.group ?? groups[0]
                      : undefined,
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
              {t('studyGroupLabel')}
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

          <PromptMixPicker
            value={englishPromptPercentage}
            onChange={setEnglishPromptPercentage}
            appLanguage={appLanguage}
            translationLabel={translationLabel}
          />
        </div>

        <div className="session-badges">
          <span>{getSelectionLabel(selection.mode, selection.group)}</span>
          <span>{activeTranslationLanguage || t('chatNoActiveLanguage')}</span>
          <span>{t('studyEligibleToday', { count: candidateCount })}</span>
        </div>

        <div className="summary-strip">
          <article>
            <span>{summary.correct}</span>
            <p>{t('commonCorrect')}</p>
          </article>
          <article>
            <span>{summary.incorrect}</span>
            <p>{t('commonMissed')}</p>
          </article>
          <article>
            <span>{summary.snoozed}</span>
            <p>{t('commonSnoozed')}</p>
          </article>
        </div>
      </section>

      <section ref={studyAreaRef} className="panel study-panel">
        {cards.length > 0 && currentIndex >= cards.length ? (
          <div className="empty-state large">
            <p>{t('studyComplete')}</p>
            <button type="button" className="primary-button" onClick={startSession}>
              {t('studyStartAnotherRound')}
            </button>
          </div>
        ) : !currentCard ? (
          <div className="empty-state large">
            <p>{t('studyEmpty')}</p>
          </div>
        ) : (
          <>
            <div className="study-card">
              <div className="study-meta">
                <span>
                  {t('studyCardCounter', { current: currentIndex + 1, total: cards.length })}
                </span>
                <span>
                  {t('studyShowedIn', {
                    language:
                      currentCard.promptSide === 'english'
                        ? t('commonEnglish')
                        : currentCard.word.translationLanguage,
                  })}
                </span>
              </div>

              <h2 className={promptClassName}>{buildWordPrompt(currentCard.word, currentCard.promptSide)}</h2>
              <p className="study-subtitle">
                {t('studyTypeAnswer', {
                  language:
                    currentCard.promptSide === 'english'
                      ? currentCard.word.translationLanguage
                      : t('commonEnglish'),
                })}
              </p>

              <label className="full-width study-answer-field">
                {t('studyYourAnswer')}
                <input
                  className={answerInputClassName}
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  placeholder={
                    currentCard.promptSide === 'english'
                      ? t('studyTypeAnswerPlaceholder', {
                          language: currentCard.word.translationLanguage,
                        })
                      : t('studyTypeEnglishPlaceholder')
                  }
                  disabled={Boolean(feedback)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && answer.trim() && !feedback) {
                      event.preventDefault();
                      void handleCheckAnswer();
                    }
                  }}
                />
              </label>

              <div className="action-row action-row-spacious study-actions">
                <button
                  type="button"
                  className="primary-button"
                  disabled={!answer.trim() || Boolean(feedback)}
                  onClick={() => void handleCheckAnswer()}
                >
                  {t('studyCheck')}
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={Boolean(feedback)}
                  onClick={() => void handleSnooze()}
                >
                  {t('studyDontShowToday')}
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={Boolean(feedback)}
                  onClick={() => void handleDontKnow()}
                >
                  {t('studyDontKnow')}
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={Boolean(feedback)}
                  onClick={() => {
                    setHintVisible((current) => !current);
                    setUsedHint(true);
                  }}
                >
                  {t('commonHint')}
                </button>
              </div>

              {hintVisible ? (
                <div className="hint-box study-hint-box">
                  {currentCard.word.textHint ? (
                    <p className="study-hint-copy">{currentCard.word.textHint}</p>
                  ) : (
                    <p className="study-hint-copy">{t('studyNoTextHint')}</p>
                  )}
                  {currentCard.word.imageHint ? (
                    <img
                      src={currentCard.word.imageHint.dataUrl}
                      alt={currentCard.word.imageHint.name}
                      className="study-image"
                    />
                  ) : null}

                  {aiReady ? (
                    <div className="ai-inline study-ai-inline">
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={aiBusyFeature === `sentence:${currentCard.word.id}`}
                        onClick={() => void onGenerateSentence(currentCard.word)}
                      >
                        {aiBusyFeature === `sentence:${currentCard.word.id}`
                          ? t('commonWriting')
                          : t('studyCreateSentence')}
                      </button>
                      {sentenceHints[currentCard.word.id] ? <p className="study-hint-copy">{sentenceHints[currentCard.word.id]}</p> : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {feedback ? (
                <div className={`feedback-box ${feedback.kind}`}>
                  <p>{feedback.message}</p>
                  {feedback.answerListLabel && feedback.answerList && feedback.answerList.length > 0 ? (
                    <div className="feedback-answer-stack">
                      <strong>{feedback.answerListLabel}</strong>
                      <div className="value-chip-row">
                        {feedback.answerList.map((acceptedAnswer) => (
                          <span
                            key={acceptedAnswer}
                            className="value-chip translation-text"
                          >
                            {acceptedAnswer}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="action-row">
                    <button type="button" className="secondary-button" onClick={goToNextCard}>
                      {t('studyNextWord')}
                    </button>
                    {aiReady ? (
                      <button
                        type="button"
                        className="ghost-button"
                        disabled={aiBusyFeature === `sentence:${currentCard.word.id}`}
                        onClick={() => void onGenerateSentence(currentCard.word)}
                      >
                        {aiBusyFeature === `sentence:${currentCard.word.id}`
                          ? t('commonWriting')
                          : t('studyCreateSentence')}
                      </button>
                    ) : null}
                  </div>
                  {sentenceHints[currentCard.word.id] ? (
                    <p className="study-hint-copy">{sentenceHints[currentCard.word.id]}</p>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="study-footer">
              <p>
                {t('studyHiddenFooter', {
                  date: formatDateOnly(getTodayDateKey()),
                })}
              </p>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
