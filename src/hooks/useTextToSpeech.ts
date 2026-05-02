import { useCallback, useState } from 'react';

function resolveSpeechLocale(language?: string): string {
  const normalized = language?.trim().toLowerCase();

  if (!normalized) {
    return 'en-US';
  }

  if (normalized === 'english' || normalized === 'en' || normalized.startsWith('en-')) {
    return 'en-US';
  }

  if (
    normalized === 'hebrew' ||
    normalized === 'עברית' ||
    normalized === 'he' ||
    normalized === 'iw' ||
    normalized.startsWith('he-') ||
    normalized.startsWith('iw-')
  ) {
    return 'he-IL';
  }

  if (
    normalized === 'russian' ||
    normalized === 'русский' ||
    normalized === 'ru' ||
    normalized.startsWith('ru-')
  ) {
    return 'ru-RU';
  }

  if (/^[a-z]{2,3}(-[a-z]{2,3})?$/.test(normalized)) {
    return normalized;
  }

  return 'en-US';
}

export function useTextToSpeech() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const play = useCallback((text: string, language?: string) => {
    if (!window.speechSynthesis) {
      setError('Text-to-speech is not supported in this browser.');
      return;
    }

    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = resolveSpeechLocale(language);

    utterance.onstart = () => {
      setIsPlaying(true);
      setError(null);
    };

    utterance.onend = () => {
      setIsPlaying(false);
    };

    utterance.onerror = (event) => {
      setIsPlaying(false);
      // Ignore cancellation errors
      if (event.error !== 'canceled') {
        setError('Could not play audio.');
      }
    };

    window.speechSynthesis.speak(utterance);
  }, []);

  const stop = useCallback(() => {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
      setIsPlaying(false);
    }
  }, []);

  return { play, stop, isPlaying, error };
}
