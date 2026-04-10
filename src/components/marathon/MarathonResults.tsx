import { createTranslator } from '../../lib/i18n';
import { formatDateTime } from '../../lib/text';
import type { CompletedRunSummary } from '../../hooks/useMarathonEngine';
import type { SupportedAppLanguage, MarathonDifficulty } from '../../types';

interface MarathonResultsProps {
  completedRun: CompletedRunSummary;
  appLanguage: SupportedAppLanguage;
  savingError: string;
  onPlayAgain: () => void;
  getDifficultyLabel: (difficulty: MarathonDifficulty, t: ReturnType<typeof createTranslator>) => string;
}

export function MarathonResults({
  completedRun,
  appLanguage,
  savingError,
  onPlayAgain,
  getDifficultyLabel,
}: MarathonResultsProps) {
  const t = createTranslator(appLanguage);

  return (
    <div className="marathon-result">
      <div className="panel-heading compact">
        <div>
          <p className="eyebrow">{t('marathonFinishedEyebrow')}</p>
          <h2>{t('marathonFinishedTitle')}</h2>
        </div>
        <button type="button" className="primary-button" onClick={onPlayAgain}>
          {t('marathonPlayAgain')}
        </button>
      </div>

      <div className="summary-strip marathon-summary-grid">
        <article>
          <span>{completedRun.run.accuracy}%</span>
          <p>{t('statAccuracy')}</p>
        </article>
        <article>
          <span>{Math.round(completedRun.run.meanAnswerTimeMs / 100) / 10}s</span>
          <p>{t('marathonMeanAnswerTime')}</p>
        </article>
        <article>
          <span>{completedRun.run.correctCount}</span>
          <p>{t('commonCorrect')}</p>
        </article>
        <article>
          <span>{completedRun.run.wrongCount}</span>
          <p>{t('commonMissed')}</p>
        </article>
        <article>
          <span>{completedRun.run.timeoutCount}</span>
          <p>{t('marathonTimeouts')}</p>
        </article>
        <article>
          <span>{completedRun.run.longestStreak}</span>
          <p>{t('marathonLongestStreak')}</p>
        </article>
      </div>

      <div className="history-list compact-history">
        <article className="history-row">
          <div>
            <strong>{t('marathonRunDetails')}</strong>
            <p>{`${getDifficultyLabel(completedRun.run.difficulty, t)} · ${completedRun.run.translationLanguage}`}</p>
          </div>
          <small>{formatDateTime(completedRun.run.finishedAt)}</small>
        </article>
        <article className="history-row">
          <div>
            <strong>{t('marathonCardsPlayed')}</strong>
            <p>{`${completedRun.run.answeredCards} / ${completedRun.run.totalCards}`}</p>
          </div>
          <small>
            {completedRun.run.returnMissedCards ? t('marathonReturnMissed') : t('marathonOnePass')}
          </small>
        </article>
      </div>

      {savingError ? <p className="error-text">{savingError}</p> : null}
    </div>
  );
}
