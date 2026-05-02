import { Fragment, useEffect } from 'react';
import { createTranslator } from '../../lib/i18n';
import { shouldShowAudioForLanguage } from '../../lib/language-settings';
import { normalizeForComparison } from '../../lib/text';
import { MarathonScene } from './MarathonScene';
import { PlayButton } from '../shared/PlayButton';
import type { MarathonFeedbackKind } from '../../hooks/useMarathonEngine';
import type { AppSettings, MarathonCard, MarathonDifficulty, SupportedAppLanguage, WordEntry, MarathonAnswer } from '../../types';

interface MarathonRunnerProps {
  currentCard: MarathonCard;
  currentOptions: string[];
  correctOption: string;
  difficulty: MarathonDifficulty;
  currentStreak: number;
  longestStreak: number;
  progressCurrent: number;
  progressTotal: number;
  feedbackKind: MarathonFeedbackKind | null;
  selectedOption: string;
  roundStartedAt: number;
  elapsedBeforePause: number;
  roundDurationMs: number;
  isPaused: boolean;
  isSavingRun: boolean;
  showingFeedback: boolean;
  appLanguage: SupportedAppLanguage;
  settings: AppSettings;
  words: WordEntry[];
  answers: MarathonAnswer[];
  onResolveAnswer: (option: string, timedOut: boolean) => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  getDifficultyLabel: (difficulty: MarathonDifficulty, t: ReturnType<typeof createTranslator>) => string;
}

export function MarathonRunner({
  currentCard,
  currentOptions,
  correctOption,
  difficulty,
  currentStreak,
  longestStreak,
  progressCurrent,
  progressTotal,
  feedbackKind,
  selectedOption,
  roundStartedAt,
  elapsedBeforePause,
  roundDurationMs,
  isPaused,
  isSavingRun,
  showingFeedback,
  appLanguage,
  settings,
  words,
  answers,
  onResolveAnswer,
  onPause,
  onResume,
  onStop,
  getDifficultyLabel,
}: MarathonRunnerProps) {
  const t = createTranslator(appLanguage);
  const audioButtonTitle = t('commonPlayAudio');
  const shouldShowAudio = (language?: string) => shouldShowAudioForLanguage(settings, language);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        (event.target as HTMLElement).isContentEditable
      ) {
        return;
      }

      if (isSavingRun) {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === 'escape') {
        event.preventDefault();
        onStop();
        return;
      }

      if (key === 'p') {
        event.preventDefault();
        if (!showingFeedback) {
          if (isPaused) {
            onResume();
          } else {
            onPause();
          }
        }
        return;
      }

      if (!isPaused && !showingFeedback) {
        const optionIndex = parseInt(key, 10) - 1;
        if (!isNaN(optionIndex) && optionIndex >= 0 && optionIndex < currentOptions.length) {
          event.preventDefault();
          onResolveAnswer(currentOptions[optionIndex], false);
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSavingRun, isPaused, showingFeedback, currentOptions, onStop, onPause, onResume, onResolveAnswer]);

  function renderAnswerHistory(historyClassName = '') {
    if (answers.length === 0) {
      return null;
    }

    return (
      <div className={['marathon-history', historyClassName].filter(Boolean).join(' ')}>
        {answers.slice().reverse().map((answer) => {
          const word = words.find((item) => item.id === answer.wordId);
          if (!word) return null;

          const promptText = answer.promptSide === 'english' ? word.englishText : answer.translationText;
          const correctText = answer.promptSide === 'english' ? answer.translationText : word.englishText;
          const promptLanguage = answer.promptSide === 'english' ? 'English' : word.translationLanguage;
          const answerLanguage = answer.promptSide === 'english' ? word.translationLanguage : 'English';
          const showPromptAudio = shouldShowAudio(promptLanguage);
          const showAnswerAudio = shouldShowAudio(answerLanguage);

          return (
            <div key={answer.id} className={`marathon-history-card animate-slide-in-up ${answer.wasCorrect ? 'correct' : 'incorrect'}`}>
              <div className="marathon-history-main">
                <span className="marathon-history-token">
                  <span
                    className={`marathon-history-prompt ${answer.promptSide === 'english' ? 'english-text' : 'translation-text'}`}
                  >
                    {promptText}
                  </span>
                  {showPromptAudio ? (
                    <PlayButton
                      text={promptText}
                      language={promptLanguage}
                      className="marathon-history-inline-audio-button"
                      title={audioButtonTitle}
                    />
                  ) : null}
                </span>
                <span className="marathon-history-arrow">→</span>
                <span className="marathon-history-token">
                  <span
                    className={`marathon-history-correct ${answer.promptSide === 'english' ? 'translation-text' : 'english-text'}`}
                  >
                    {correctText}
                  </span>
                  {showAnswerAudio ? (
                    <PlayButton
                      text={correctText}
                      language={answerLanguage}
                      className="marathon-history-inline-audio-button"
                      title={audioButtonTitle}
                    />
                  ) : null}
                </span>
              </div>
              {!answer.wasCorrect && answer.selectedOption && (
                <div className="marathon-history-side">
                  <span className="marathon-history-token marathon-history-selected-token">
                    <span
                      className={`marathon-history-selected ${answer.promptSide === 'english' ? 'translation-text' : 'english-text'}`}
                    >
                      {answer.selectedOption}
                    </span>
                    {showAnswerAudio ? (
                      <PlayButton
                        text={answer.selectedOption}
                        language={answerLanguage}
                        className="marathon-history-inline-audio-button"
                        title={audioButtonTitle}
                      />
                    ) : null}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="marathon-runner">
      <div className="panel-heading compact marathon-run-header">
        <div className="marathon-meta">
          <span>{t('marathonCardCounter', { current: progressCurrent, total: progressTotal })}</span>
          <span>{getDifficultyLabel(difficulty, t)}</span>
          <span key={`streak-${currentStreak}`} className={currentStreak > 0 ? 'streak-active' : ''}>
            {t('marathonStreakNow', { count: currentStreak })}
          </span>
          <span>{t('marathonLongestStreakNow', { count: longestStreak })}</span>
        </div>
        <div className="marathon-run-actions">
          <button
            type="button"
            className="ghost-button"
            disabled={showingFeedback || isSavingRun}
            onClick={isPaused ? onResume : onPause}
          >
            {isPaused ? t('marathonResume') : t('marathonPause')}
          </button>
          <button
            type="button"
            className="ghost-button danger-button"
            disabled={isSavingRun}
            onClick={onStop}
          >
            {t('marathonStop')}
          </button>
        </div>
      </div>

      {isPaused ? (
        <article className="marathon-paused-state">
          <div className="marathon-paused-state-header">
            <h2>{t('marathonPaused')}</h2>
            {answers.length > 0 ? (
              <p className="eyebrow">{t('marathonPreviousAnswers')}</p>
            ) : (
              <p className="helper-text">{t('commonNoDataYet')}</p>
            )}
          </div>
          {renderAnswerHistory('expanded')}
        </article>
      ) : (
        <Fragment key={currentCard.id}>
          <article className={`marathon-card animate-slide-in-right ${feedbackKind ? `marathon-card-${feedbackKind}` : ''}`}>
            <p className="eyebrow">
              {currentCard.promptSide === 'english'
                ? t('marathonShowedInEnglish')
                : t('marathonShowedInLanguage', { language: currentCard.translationLanguage })}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px' }}>
              <h2
                className={
                  currentCard.promptSide === 'english'
                    ? 'study-prompt english-display english-text'
                    : 'study-prompt translation-display translation-text'
                }
                style={{ margin: 0 }}
              >
                {currentCard.promptSide === 'english'
                  ? currentCard.englishText
                  : currentCard.translationText}
              </h2>
              {currentCard.promptSide === 'english' ? (
                <PlayButton text={currentCard.englishText} title={audioButtonTitle} />
              ) : null}
            </div>
          </article>

          <div className="marathon-options animate-slide-in-up">
            {currentOptions.map((option, index) => {
              const isCorrect = normalizeForComparison(option) === normalizeForComparison(correctOption);
              const isSelected = normalizeForComparison(option) === normalizeForComparison(selectedOption);
              const className = [
                'marathon-option',
                feedbackKind ? 'revealed-state' : '',
                feedbackKind === 'correct' && isSelected ? 'correct' : '',
                feedbackKind === 'wrong' && isSelected ? 'wrong' : '',
                (feedbackKind === 'wrong' || feedbackKind === 'timeout') && isCorrect ? 'reveal' : '',
              ]
                .filter(Boolean)
                .join(' ');

              return (
                <button
                  key={`${currentCard.id}-${option}`}
                  type="button"
                  className={className}
                  disabled={showingFeedback || isSavingRun}
                  onClick={() => onResolveAnswer(option, false)}
                >
                  <span className="marathon-option-index">{index + 1}</span>
                  <span
                    className={
                      currentCard.promptSide === 'english'
                        ? 'translation-text'
                        : 'english-text'
                    }
                  >
                    {option}
                  </span>
                </button>
              );
            })}
          </div>

          <MarathonScene
            roundStartedAt={roundStartedAt}
            elapsedBeforePause={elapsedBeforePause}
            roundDurationMs={roundDurationMs}
            isPaused={isPaused}
            showingFeedback={showingFeedback}
          />

          {feedbackKind ? (
            <div className={`feedback-box ${feedbackKind === 'timeout' ? 'revealed' : feedbackKind === 'wrong' ? 'incorrect' : 'correct'}`}>
              <p>
                {feedbackKind === 'correct'
                  ? t('marathonCorrect')
                  : feedbackKind === 'timeout'
                    ? t('marathonTimeUp')
                    : t('marathonWrong')}
              </p>
            </div>
          ) : null}

          {renderAnswerHistory()}
        </Fragment>
      )}
    </div>
  );
}
