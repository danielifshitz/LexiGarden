import type { ImportWordsResult, WordMutationResult } from '../db';
import { tRuntime } from './i18n';

function appendVisibilityMessage(
  baseMessage: string,
  wordLanguage: string,
  activeTranslationLanguage?: string,
): string {
  if (
    !activeTranslationLanguage?.trim() ||
    wordLanguage.trim().localeCompare(activeTranslationLanguage.trim(), undefined, {
      sensitivity: 'accent',
    }) === 0
  ) {
    return baseMessage;
  }

  return tRuntime('wordMutationVisibility', {
    base: baseMessage,
    language: wordLanguage,
  });
}

export function describeWordMutation(
  result: WordMutationResult,
  options?: {
    activeTranslationLanguage?: string;
    source?: 'chat';
  },
): string {
  const label = `"${result.word.englishText}"`;
  const parts: string[] = [];
  const sourceSuffix = options?.source === 'chat' ? tRuntime('wordMutationSourceChat') : '';

  if (result.addedTranslations.length > 0) {
    parts.push(
      tRuntime('wordMutationDetailTranslations', {
        count: result.addedTranslations.length,
      }),
    );
  }

  if (result.addedGroups.length > 0) {
    parts.push(
      tRuntime('wordMutationDetailGroups', {
        count: result.addedGroups.length,
      }),
    );
  }

  if (result.filledFields.includes('textHint')) {
    parts.push(tRuntime('wordMutationDetailHint'));
  }

  if (result.filledFields.includes('imageHint')) {
    parts.push(tRuntime('wordMutationDetailImageHint'));
  }

  const sourceText = sourceSuffix;
  const detailText = parts.join(', ');
  const baseMessage =
    result.change === 'created'
      ? tRuntime('wordMutationAdded', { label, source: sourceText })
      : result.change === 'merged'
        ? parts.length > 0
          ? tRuntime('wordMutationUpdated', {
              label,
              source: sourceText,
              details: detailText,
            })
          : tRuntime('wordMutationNothingNew', { label })
        : result.change === 'noop'
          ? tRuntime('wordMutationNothingNew', { label })
          : tRuntime('wordMutationUpdatedSimple', {
              label,
              source: sourceText,
            });

  return appendVisibilityMessage(
    baseMessage,
    result.word.translationLanguage,
    options?.activeTranslationLanguage,
  );
}

export function describeImportResult(
  result: ImportWordsResult,
  options?: {
    skippedRowNumbers?: number[];
    includeImageHintNote?: boolean;
  },
): string {
  const parts: string[] = [];
  const skippedRowNumbers = [...(options?.skippedRowNumbers ?? [])].sort((left, right) => left - right);

  if (result.createdCount > 0) {
    parts.push(tRuntime('importWordsCreated', { count: result.createdCount }));
  }

  if (result.mergedCount > 0) {
    parts.push(tRuntime('importWordsUpdated', { count: result.mergedCount }));
  }

  if (result.noopCount > 0) {
    parts.push(tRuntime('importRowsNoNew', { count: result.noopCount }));
  }

  if (skippedRowNumbers.length > 0) {
    parts.push(
      tRuntime('importRowsSkipped', {
        rows: `${skippedRowNumbers.slice(0, 8).join(', ')}${skippedRowNumbers.length > 8 ? '…' : ''}`,
      }),
    );
  }

  const baseMessage = parts.length > 0 ? `${parts.join(' • ')}.` : tRuntime('importNoNewWords');

  return options?.includeImageHintNote
    ? `${baseMessage} ${tRuntime('importImageHintsSkipped')}`
    : baseMessage;
}
