import type { CSSProperties } from 'react';
import { createTranslator } from '../lib/i18n';
import type { SupportedAppLanguage } from '../types';

function getPromptMixSummary(
  englishPromptPercentage: number,
  translationLanguageLabel: string,
  t: ReturnType<typeof createTranslator>,
): string {
  if (englishPromptPercentage === 100) {
    return t('studyPromptEnglishOnly');
  }

  if (englishPromptPercentage === 0) {
    return t('studyPromptTranslationOnly', { language: translationLanguageLabel });
  }

  if (englishPromptPercentage >= 75) {
    return t('studyPromptMostlyEnglish');
  }

  if (englishPromptPercentage > 50) {
    return t('studyPromptMoreEnglish');
  }

  if (englishPromptPercentage === 50) {
    return t('studyPromptBalanced');
  }

  if (englishPromptPercentage <= 25) {
    return t('studyPromptMostlyTranslation', { language: translationLanguageLabel });
  }

  return t('studyPromptMoreTranslation', { language: translationLanguageLabel });
}

interface PromptMixPickerProps {
  value: number;
  onChange: (value: number) => void;
  appLanguage: SupportedAppLanguage;
  translationLabel: string;
}

export function PromptMixPicker({
  value,
  onChange,
  appLanguage,
  translationLabel,
}: PromptMixPickerProps) {
  const t = createTranslator(appLanguage);
  const englishPromptPercentage = Math.max(0, Math.min(100, Math.round(value)));
  const translationPromptPercentage = 100 - englishPromptPercentage;
  const dividerPosition = Math.min(98, Math.max(2, englishPromptPercentage));
  const promptMixVisualStyle = {
    '--prompt-english': `${englishPromptPercentage}%`,
    '--prompt-translation': `${translationPromptPercentage}%`,
    '--prompt-english-shift': `${(englishPromptPercentage - 50) * 0.24}px`,
    '--prompt-translation-shift': `${(50 - englishPromptPercentage) * 0.24}px`,
  } as CSSProperties;

  return (
    <div className="prompt-mix-field full-width">
      <div className="prompt-mix-head">
        <strong>{t('studyWordBalance')}</strong>
      </div>
      <div
        className="prompt-mix-visual"
        role="group"
        aria-label={t('studyWordBalance')}
        style={promptMixVisualStyle}
      >
        <div className="prompt-mix-layer prompt-mix-layer-english" aria-hidden="true">
          <div className="prompt-mix-scene prompt-mix-scene-english" />
          <span className="prompt-mix-watermark english-text">{t('commonEnglish')}</span>
        </div>
        <div className="prompt-mix-layer prompt-mix-layer-translation" aria-hidden="true">
          <div className="prompt-mix-scene prompt-mix-scene-translation" />
          <span className="prompt-mix-watermark translation-text">{translationLabel}</span>
        </div>

        <div className="prompt-mix-side prompt-mix-side-english" aria-hidden="true">
          <strong>{englishPromptPercentage}%</strong>
          <span>{t('commonEnglish')}</span>
        </div>
        <div className="prompt-mix-side prompt-mix-side-translation" aria-hidden="true">
          <strong>{translationPromptPercentage}%</strong>
          <span>{translationLabel}</span>
        </div>

        <div className="prompt-mix-divider" style={{ left: `${dividerPosition}%` }} aria-hidden="true">
          <span className="prompt-mix-handle" />
        </div>

        <input
          type="range"
          min={0}
          max={100}
          value={englishPromptPercentage}
          onChange={(event) => onChange(Number(event.target.value))}
          className="prompt-mix-slider"
          aria-label={`${translationLabel} / ${t('commonEnglish')}`}
          aria-valuetext={getPromptMixSummary(englishPromptPercentage, translationLabel, t)}
        />
      </div>
      <div className="prompt-mix-presets" role="group" aria-label={t('studyWordBalance')}>
        {[0, 50, 100].map((preset) => (
          <button
            key={preset}
            type="button"
            className={[
              'prompt-mix-preset',
              englishPromptPercentage === preset ? 'active' : '',
              preset === 50 ? 'prompt-mix-preset-balanced' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => onChange(preset)}
          >
            {preset === 0 ? translationLabel : preset === 100 ? t('commonEnglish') : `${preset}/${100 - preset}`}
          </button>
        ))}
      </div>
    </div>
  );
}
