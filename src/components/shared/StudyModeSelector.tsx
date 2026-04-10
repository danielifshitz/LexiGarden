import type { createTranslator } from '../../lib/i18n';
import type { StudySelection } from '../../types';

interface StudyModeSelectorProps {
  selection: StudySelection;
  groups: string[];
  onChange: (selection: StudySelection) => void;
  t: ReturnType<typeof createTranslator>;
}

export function StudyModeSelector({ selection, groups, onChange, t }: StudyModeSelectorProps) {
  return (
    <>
      <label>
        {t('studyMode')}
        <select
          value={selection.mode}
          onChange={(event) =>
            onChange({
              mode: event.target.value as StudySelection['mode'],
              group: event.target.value === 'group' ? selection.group ?? groups[0] : undefined,
            })
          }
        >
          <option value="all">{t('studyModeAll')}</option>
          <option value="lastAdded">{t('studyModeLastAdded')}</option>
          <option value="group">{t('studyModeGroup')}</option>
          <option value="lessKnown">{t('studyModeLessKnown')}</option>
          <option value="lessSeen">{t('studyModeLessSeen')}</option>
        </select>
      </label>

      {selection.mode === 'group' ? (
        <label>
          {t('studyGroupLabel')}
          <select
            value={selection.group ?? groups[0] ?? ''}
            onChange={(event) => onChange({ mode: 'group', group: event.target.value })}
          >
            {groups.map((group) => (
              <option key={group} value={group}>
                {group}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </>
  );
}
