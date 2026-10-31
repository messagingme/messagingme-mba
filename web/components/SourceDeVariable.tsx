'use client';

import type { UserFieldDef } from '@/lib/api';
import { SYSTEM_FIELDS, customFieldsOnly } from '@/lib/fields';
import { useT } from '@/lib/i18n';
import type { VarRow } from '@/lib/variables-template';

/**
 * D'où vient une variable `{{n}}` d'un template : un champ du contact, la date du jour ou un texte fixe. Le même
 * sélecteur à l'étape Contenu d'une campagne et dans le bloc « Envoi template » d'un scénario : les options se
 * traduisent en source par `web/lib/variables-template.ts`, une seule sémantique pour les deux écrans.
 * `avecAucun` ajoute l'option vide (le bloc : une variable reliée à rien, que l'envoi refusera).
 */
export function SourceDeVariable({ position, ligne, champs, onChange, testId, avecAucun = false }: {
  position: number;
  ligne: VarRow;
  champs: UserFieldDef[];
  onChange: (patch: Partial<VarRow>) => void;
  testId: string;
  avecAucun?: boolean;
}) {
  const t = useT();
  const perso = customFieldsOnly(champs);
  return (
    <div className="flex w-full items-center gap-1.5">
      <span className="w-10 shrink-0 text-xs text-ink-500">{`{{${position}}}`}</span>
      <select
        value={ligne.sel}
        onChange={(e) => onChange({ sel: e.target.value })}
        data-testid={testId}
        aria-label={t(`Variable ${position}`, `Variable ${position}`)}
        className={`min-w-0 flex-1 rounded-controle border bg-white px-3 py-2 text-sm outline-none focus:border-brand-400 ${ligne.sel === '' ? 'border-danger text-danger' : 'border-ink-200'}`}
      >
        {avecAucun && <option value="">{t('Aucun champ', 'No field')}</option>}
        <optgroup label={t('Champs de base', 'Base fields')}>
          {SYSTEM_FIELDS.map((f) => <option key={f.key} value={`sys:${f.key}`}>{t(...f.label)}</option>)}
        </optgroup>
        {perso.length > 0 && (
          <optgroup label={t('Mes champs', 'My fields')}>
            {perso.map((f) => <option key={f.key} value={`field:${f.key}`}>{f.label}</option>)}
          </optgroup>
        )}
        <optgroup label={t('Autre', 'Other')}>
          <option value="now">{t('Date du jour (auto)', "Today's date (auto)")}</option>
          <option value="literal">{t('Texte fixe', 'Fixed text')}</option>
        </optgroup>
      </select>
      {ligne.sel === 'literal' && (
        <input
          value={ligne.value}
          onChange={(e) => onChange({ value: e.target.value })}
          data-testid={`${testId}-texte`}
          aria-label={t(`Texte fixe de la variable ${position}`, `Fixed text of variable ${position}`)}
          placeholder={t('valeur', 'value')}
          className="w-28 min-w-0 shrink rounded-controle border border-ink-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
        />
      )}
    </div>
  );
}
