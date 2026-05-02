import { useTextToSpeech } from '../../hooks/useTextToSpeech';

interface PlayButtonProps {
  text: string;
  language?: string;
  className?: string;
  title?: string;
}

export function PlayButton({ text, language, className = '', title = 'Play audio' }: PlayButtonProps) {
  const { play, isPlaying, error } = useTextToSpeech();

  return (
    <button
      type="button"
      className={`ghost-button icon-button ${className} ${isPlaying ? 'playing' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        play(text, language);
      }}
      title={error || title}
      aria-label={title}
      disabled={isPlaying}
      style={{ padding: '4px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      </svg>
    </button>
  );
}
