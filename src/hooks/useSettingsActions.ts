import { deleteTranslationLanguage, exportBackup, importBackup, saveSettings, type DeleteLanguageResult } from '../db';
import { downloadTextFile } from '../lib/text';
import type { createTranslator } from '../lib/i18n';
import type { AppSettings, PersistedState } from '../types';
import type { FlashMessage } from './useAppState';

interface UseSettingsActionsProps {
  settings: AppSettings | null;
  refreshState: (keys?: Array<keyof PersistedState>) => Promise<void>;
  setSettings: (settings: AppSettings) => void;
  setFlashMessage: (message: FlashMessage) => void;
  setModelsError: (error: string) => void;
  t: ReturnType<typeof createTranslator>;
}

export function useSettingsActions({
  settings,
  refreshState,
  setSettings,
  setFlashMessage,
  setModelsError,
  t,
}: UseSettingsActionsProps) {
  async function handleDeleteLanguage(language: string): Promise<DeleteLanguageResult> {
    const result = await deleteTranslationLanguage(language);
    await refreshState(['words', 'chatSessions', 'marathonRuns', 'marathonAnswers', 'settings']);
    setFlashMessage({
      kind: 'success',
      text:
        result.deletedWordCount > 0 ||
        result.deletedChatCount > 0 ||
        result.deletedMarathonRunCount > 0
          ? t('appDeletedLanguageDetailed', {
              language,
              words: result.deletedWordCount,
              chats: result.deletedChatCount,
              runs: result.deletedMarathonRunCount,
            })
          : t('appDeletedLanguageSimple', { language }),
    });
    return result;
  }

  async function handleSaveSettings(nextSettings: AppSettings) {
    const savedSettings = await saveSettings(nextSettings);
    setSettings(savedSettings);
    setModelsError('');
    setFlashMessage({
      kind: 'success',
      text: t('appSettingsSaved'),
    });
  }

  async function handleSetActiveTranslationLanguage(nextLanguage: string) {
    if (!settings) {
      return;
    }

    try {
      const savedSettings = await saveSettings({
        ...settings,
        activeTranslationLanguage: nextLanguage,
      });
      setSettings(savedSettings);
    } catch (error) {
      setFlashMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : t('appCouldNotChangeLanguage'),
      });
    }
  }

  async function handleExportBackup() {
    const backup = await exportBackup(false);
    const timestamp = new Date().toISOString().replaceAll(':', '-');
    downloadTextFile(`lexigarden-backup-${timestamp}.json`, JSON.stringify(backup, null, 2));
    setFlashMessage({
      kind: 'success',
      text: t('appBackupDownloaded'),
    });
  }

  async function handleImportBackup(file: File) {
    const text = await file.text();
    const parsed = JSON.parse(text) as ReturnType<typeof JSON.parse>;
    await importBackup(parsed as Awaited<ReturnType<typeof exportBackup>>);
    await refreshState();
    setFlashMessage({
      kind: 'success',
      text: t('appBackupImported'),
    });
  }

  return {
    actions: {
      handleDeleteLanguage,
      handleSaveSettings,
      handleSetActiveTranslationLanguage,
      handleExportBackup,
      handleImportBackup,
    },
  };
}
