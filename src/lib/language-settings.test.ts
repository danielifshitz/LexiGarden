import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../db';
import { getLanguageProfile, shouldShowAudioForLanguage } from './language-settings';

describe('language audio settings', () => {
  it('keeps English audio available even when a language profile hides audio', () => {
    const settings = {
      ...defaultSettings,
      translationLanguages: ['Russian'],
      languageProfiles: {
        Russian: {
          ...getLanguageProfile(defaultSettings, 'Russian'),
          showAudioButtons: false,
        },
      },
    };

    expect(shouldShowAudioForLanguage(settings, 'English')).toBe(true);
    expect(shouldShowAudioForLanguage(settings, 'en-US')).toBe(true);
    expect(shouldShowAudioForLanguage(settings, 'Russian')).toBe(false);
  });

  it('defaults translation audio to visible for existing languages', () => {
    const settings = {
      ...defaultSettings,
      translationLanguages: ['Hebrew'],
      languageProfiles: {
        Hebrew: getLanguageProfile(defaultSettings, 'Hebrew'),
      },
    };

    expect(shouldShowAudioForLanguage(settings, 'Hebrew')).toBe(true);
  });
});
