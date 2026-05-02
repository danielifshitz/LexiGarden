import { useState } from 'react';
import { createTranslator } from '../../lib/i18n';
import { shouldShowAudioForLanguage } from '../../lib/language-settings';
import { formatDateTime } from '../../lib/text';
import { PlayButton } from '../shared/PlayButton';
import type { CompletedRunSummary } from '../../hooks/useMarathonEngine';
import type { AppSettings, SupportedAppLanguage, MarathonDifficulty, WordEntry } from '../../types';

interface MarathonResultsProps {
  words: WordEntry[];
  settings: AppSettings;
  completedRun: CompletedRunSummary;
  appLanguage: SupportedAppLanguage;
  savingError: string;
  onPlayAgain: () => void;
  getDifficultyLabel: (difficulty: MarathonDifficulty, t: ReturnType<typeof createTranslator>) => string;
  onExplainMistake: (word: WordEntry, userAnswer: string, promptSide: 'english' | 'translation') => Promise<string>;
  aiReady: boolean;
}

export function MarathonResults({
  words,
  settings,
  completedRun,
  appLanguage,
  savingError,
  onPlayAgain,
  getDifficultyLabel,
  onExplainMistake,
  aiReady,
}: MarathonResultsProps) {
  const t = createTranslator(appLanguage);
  const audioButtonTitle = t('commonPlayAudio');
  const shouldShowAudio = (language?: string) => shouldShowAudioForLanguage(settings, language);
  
  const [explainingId, setExplainingId] = useState<string | null>(null);
  const [explanations, setExplanations] = useState<Record<string, string>>({});

  const handleExplain = async (answer: CompletedRunSummary['answers'][0]) => {
    const word = words.find((w) => w.id === answer.wordId);
    if (!word) return;
    
    setExplainingId(answer.id);
    try {
      const explanation = await onExplainMistake(word, answer.selectedOption, answer.promptSide);
      setExplanations((prev) => ({ ...prev, [answer.id]: explanation }));
    } catch (err) {
      console.error('Failed to explain mistake:', err);
      setExplanations((prev) => ({ ...prev, [answer.id]: t('aiExplainMistakeFailed') }));
    } finally {
      setExplainingId(null);
    }
  };

  const wrongAnswers = completedRun.answers.filter((a) => !a.wasCorrect && !a.timedOut);
  const timeoutAnswers = completedRun.answers.filter((a) => a.timedOut);

  const renderAnswer = (answer: CompletedRunSummary['answers'][0]) => {
    const word = words.find((w) => w.id === answer.wordId);
    if (!word) return null;
    
    const promptText = answer.promptSide === 'english' ? word.englishText : answer.translationText;
    const correctText = answer.promptSide === 'english' ? answer.translationText : word.englishText;
    const promptLanguage = answer.promptSide === 'english' ? 'English' : word.translationLanguage;
    const answerLanguage = answer.promptSide === 'english' ? word.translationLanguage : 'English';
    const showPromptAudio = shouldShowAudio(promptLanguage);
    const showAnswerAudio = shouldShowAudio(answerLanguage);
    
    return (
      <article key={answer.id} className="history-row" style={{ display: 'block' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span className={answer.promptSide === 'english' ? 'english-text' : 'translation-text'}>
                {promptText}
              </span>
              {showPromptAudio ? (
                <PlayButton
                  text={promptText}
                  language={promptLanguage}
                  title={audioButtonTitle}
                />
              ) : null}
            </strong>
            <p>
              {answer.selectedOption ? (
                <>
                  <span style={{ color: 'var(--error-text)', display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <span className={answer.promptSide === 'english' ? 'translation-text' : 'english-text'}>
                      {answer.selectedOption}
                    </span>
                    {showAnswerAudio ? (
                      <PlayButton
                        text={answer.selectedOption}
                        language={answerLanguage}
                        title={audioButtonTitle}
                      />
                    ) : null}
                  </span>
                  {' → '}
                  <span style={{ color: 'var(--success-text)', display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    <span className={answer.promptSide === 'english' ? 'translation-text' : 'english-text'}>
                      {correctText}
                    </span>
                    {showAnswerAudio ? (
                      <PlayButton
                        text={correctText}
                        language={answerLanguage}
                        title={audioButtonTitle}
                      />
                    ) : null}
                  </span>
                </>
              ) : (
                <span style={{ color: 'var(--success-text)', display: 'inline-flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <span className={answer.promptSide === 'english' ? 'translation-text' : 'english-text'}>
                    {correctText}
                  </span>
                  {showAnswerAudio ? (
                    <PlayButton
                      text={correctText}
                      language={answerLanguage}
                      title={audioButtonTitle}
                    />
                  ) : null}
                </span>
              )}
            </p>
          </div>
          {aiReady && (
            <button
              type="button"
              className="ghost-button"
              disabled={explainingId === answer.id}
              onClick={() => void handleExplain(answer)}
            >
              {explainingId === answer.id ? t('commonWriting') : t('aiFeatureExplainMistake')}
            </button>
          )}
        </div>
        {explanations[answer.id] && (
          <div className="hint-box" style={{ marginTop: '8px' }}>
            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{explanations[answer.id]}</p>
          </div>
        )}
      </article>
    );
  };

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

      {(wrongAnswers.length > 0 || timeoutAnswers.length > 0) && (
        <div style={{ marginTop: '24px' }}>
          {wrongAnswers.length > 0 && (
            <div style={{ marginBottom: '24px' }}>
              <h3 style={{ marginBottom: '12px' }}>{t('marathonWrong')}</h3>
              <div className="history-list" style={{ maxHeight: '250px', overflowY: 'auto', paddingRight: '8px' }}>
                {wrongAnswers.map(renderAnswer)}
              </div>
            </div>
          )}
          {timeoutAnswers.length > 0 && (
            <div>
              <h3 style={{ marginBottom: '12px' }}>{t('marathonTimeouts')}</h3>
              <div className="history-list" style={{ maxHeight: '250px', overflowY: 'auto', paddingRight: '8px' }}>
                {timeoutAnswers.map(renderAnswer)}
              </div>
            </div>
          )}
        </div>
      )}

      {savingError ? <p className="error-text">{savingError}</p> : null}
    </div>
  );
}
