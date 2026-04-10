import { createTranslator } from '../../lib/i18n';
import { normalizeForComparison } from '../../lib/text';
import { MarathonScene } from './MarathonScene';
import type { MarathonFeedbackKind } from '../../hooks/useMarathonEngine';
import type { MarathonCard, MarathonDifficulty, SupportedAppLanguage } from '../../types';

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
  onResolveAnswer,
  onPause,
  onResume,
  onStop,
  getDifficultyLabel,
}: MarathonRunnerProps) {
  const t = createTranslator(appLanguage);

  return (
    <div className="marathon-runner">
      <div className="panel-heading compact marathon-run-header">
        <div className="marathon-meta">
          <span>{t('marathonCardCounter', { current: progressCurrent, total: progressTotal })}</span>
          <span>{getDifficultyLabel(difficulty, t)}</span>
          <span>{t('marathonStreakNow', { count: currentStreak })}</span>
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
          <h2>{t('marathonPaused')}</h2>
        </article>
      ) : (
        <>
          <article className={`marathon-card ${feedbackKind ? `marathon-card-${feedbackKind}` : ''}`}>
            <p className="eyebrow">
              {currentCard.promptSide === 'english'
                ? t('marathonShowedInEnglish')
                : t('marathonShowedInLanguage', { language: currentCard.translationLanguage })}
            </p>
            <h2
              className={
                currentCard.promptSide === 'english'
                  ? 'study-prompt english-display english-text'
                  : 'study-prompt translation-display translation-text'
              }
            >
              {currentCard.promptSide === 'english'
                ? currentCard.englishText
                : currentCard.translationText}
            </h2>
          </article>

          <div className="marathon-options">
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
        </>
      )}
    </div>
  );
}
