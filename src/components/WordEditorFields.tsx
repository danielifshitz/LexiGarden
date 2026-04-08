import { useEffect, useRef, useState } from 'react';
import { createTranslator } from '../lib/i18n';
import {
  fileToDataUrl,
  getVocabularyPlaceholders,
  normalizeForComparison,
  parseSlashSeparatedValues,
  trimToUndefined,
} from '../lib/text';
import type { SupportedAppLanguage, WordEntry } from '../types';

export interface WordEditorValue {
  englishText: string;
  translationText: string;
  translationLanguage: string;
  group: string;
  textHint: string;
  imageHint?: WordEntry['imageHint'];
}

interface WordEditorFieldsProps {
  appLanguage: SupportedAppLanguage;
  value: WordEditorValue;
  activeTranslationLanguage: string;
  availableTranslationLanguages: string[];
  languageDatalistId: string;
  onChange: (patch: Partial<WordEditorValue>) => void;
  required?: boolean;
}

export function WordEditorFields({
  appLanguage,
  value,
  activeTranslationLanguage,
  availableTranslationLanguages,
  languageDatalistId,
  onChange,
  required = false,
}: WordEditorFieldsProps) {
  const t = createTranslator(appLanguage);
  const translationLanguageInputRef = useRef<HTMLInputElement | null>(null);
  const [showCustomTranslationLanguageInput, setShowCustomTranslationLanguageInput] = useState(
    availableTranslationLanguages.length === 0,
  );
  const vocabularyPlaceholders = getVocabularyPlaceholders(
    value.translationLanguage || activeTranslationLanguage,
  );
  const translationFieldLabel =
    trimToUndefined(value.translationLanguage) ||
    trimToUndefined(activeTranslationLanguage) ||
    t('fieldTranslationFallback');
  const parsedTranslationPreview = parseSlashSeparatedValues(value.translationText);
  const parsedGroupPreview = parseSlashSeparatedValues(value.group);
  const isCustomTranslationLanguage =
    Boolean(value.translationLanguage.trim()) &&
    !availableTranslationLanguages.some(
      (language) =>
        normalizeForComparison(language) === normalizeForComparison(value.translationLanguage),
    );

  useEffect(() => {
    if (availableTranslationLanguages.length === 0 || isCustomTranslationLanguage) {
      setShowCustomTranslationLanguageInput(true);
      return;
    }

    if (value.translationLanguage.trim()) {
      setShowCustomTranslationLanguageInput(false);
    }
  }, [
    availableTranslationLanguages.length,
    isCustomTranslationLanguage,
    value.translationLanguage,
  ]);

  async function handleImageChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const dataUrl = await fileToDataUrl(file);
    onChange({
      imageHint: {
        name: file.name,
        dataUrl,
        mimeType: file.type,
      },
    });
  }

  return (
    <>
      <label>
        {t('fieldEnglish')}
        <input
          className="english-input"
          value={value.englishText}
          onChange={(event) => onChange({ englishText: event.target.value })}
          placeholder={vocabularyPlaceholders.english}
          required={required}
        />
      </label>

      <label>
        {t('fieldLanguage')}
        <div className="value-chip-row compact">
          {availableTranslationLanguages.map((language) => (
            <button
              key={language}
              type="button"
              className={
                normalizeForComparison(value.translationLanguage) ===
                normalizeForComparison(language)
                  ? 'ghost-button value-choice-button active'
                  : 'ghost-button value-choice-button'
              }
              onClick={() => {
                setShowCustomTranslationLanguageInput(false);
                onChange({ translationLanguage: language });
              }}
            >
              {language}
            </button>
          ))}
          <button
            type="button"
            className={
              isCustomTranslationLanguage
                ? 'ghost-button value-choice-button active'
                : 'ghost-button value-choice-button'
            }
            onClick={() => {
              setShowCustomTranslationLanguageInput(true);
              onChange({ translationLanguage: '' });
              requestAnimationFrame(() => {
                translationLanguageInputRef.current?.focus();
              });
            }}
            aria-label={t('fieldTypeNewLanguage')}
            title={t('fieldTypeNewLanguage')}
          >
            +
          </button>
        </div>
        {showCustomTranslationLanguageInput ? (
          <input
            ref={translationLanguageInputRef}
            list={languageDatalistId}
            value={value.translationLanguage}
            aria-label={t('fieldNewLanguage')}
            onChange={(event) => onChange({ translationLanguage: event.target.value })}
            placeholder={t('fieldNewLanguagePlaceholder', {
              activeLanguage: activeTranslationLanguage || undefined,
            })}
            required={required}
          />
        ) : null}
      </label>

      <div className="field-shell" role="group" aria-label={translationFieldLabel}>
        <span className="helper-text">{t('fieldUseSlashTranslations')}</span>
        <input
          className="translation-input"
          aria-label={translationFieldLabel}
          value={value.translationText}
          onChange={(event) => onChange({ translationText: event.target.value })}
          placeholder={vocabularyPlaceholders.translation}
          required={required}
        />
        {parsedTranslationPreview.length > 0 ? (
          <div className="value-chip-row">
            {parsedTranslationPreview.map((translation) => (
              <span key={translation} className="value-chip translation-text">
                {translation}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <label>
        {t('fieldGroup')}
        <span className="helper-text">{t('fieldUseSlashGroups')}</span>
        <input
          value={value.group}
          onChange={(event) => onChange({ group: event.target.value })}
          placeholder={t('fieldGroupPlaceholder')}
        />
        {parsedGroupPreview.length > 0 ? (
          <div className="value-chip-row">
            {parsedGroupPreview.map((group) => (
              <span key={group} className="value-chip">
                {group}
              </span>
            ))}
          </div>
        ) : null}
      </label>

      <label className="full-width">
        {t('fieldTextHint')}
        <textarea
          rows={4}
          value={value.textHint}
          onChange={(event) => onChange({ textHint: event.target.value })}
          placeholder={t('fieldTextHintPlaceholder')}
        />
      </label>

      <label className="full-width">
        {t('fieldImageHint')}
        <input type="file" accept="image/*" onChange={handleImageChange} />
      </label>

      {value.imageHint ? (
        <div className="image-preview">
          <img src={value.imageHint.dataUrl} alt={value.imageHint.name} />
          <button
            type="button"
            className="ghost-button"
            onClick={() => onChange({ imageHint: undefined })}
          >
            {t('fieldRemoveImage')}
          </button>
        </div>
      ) : null}

      {availableTranslationLanguages.length > 0 ? (
        <datalist id={languageDatalistId}>
          {availableTranslationLanguages.map((language) => (
            <option key={language} value={language} />
          ))}
        </datalist>
      ) : null}
    </>
  );
}
