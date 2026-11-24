'use client';

import { useCallback, useEffect, useState } from 'react';
import { Toggle } from '@/components/Toggle';
import { useConfirmation } from '@/components/Confirmation';
import { useT } from '@/lib/i18n';
import { lireRemplacementContacts, reglerRemplacementContacts } from '@/lib/api/offre';

/**
 * « LE PLUS ANCIEN LAISSE SA PLACE » (décision de Julien du 2026-11-24, lot 2) : en Business et en Entreprise, un espace
 * plein efface son contact le plus ancien pour faire entrer le nouveau, au lieu de le refuser. Un administrateur la coche
 * ici, après une confirmation qui dit l'irréversible ; décocher se fait sans confirmation. Rien ne s'affiche hors Business
 * et Entreprise, ni sur une API qui ne connaît pas encore la route : rien n'y serait réglable.
 */
export function RemplacementContacts({ tenantId }: { tenantId: string }) {
  const t = useT();
  const confirmer = useConfirmation();
  const [etat, setEtat] = useState<{ actif: boolean; possible: boolean } | null>(null);
  const [statut, setStatut] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    let vivant = true;
    lireRemplacementContacts(tenantId)
      .then((r) => { if (vivant) setEtat(r); })
      .catch(() => { if (vivant) setEtat(null); });
    return () => { vivant = false; };
  }, [tenantId]);

  const basculer = useCallback(async () => {
    if (etat === null) return;
    const suivant = !etat.actif;
    if (suivant) {
      const ok = await confirmer({
        titre: t('Effacer les plus anciens quand l’espace est plein', 'Delete the oldest when the workspace is full'),
        message: t(
          'Irréversible : quand votre espace est plein, chaque nouveau contact efface votre contact le plus ancien, avec sa conversation, ses messages et son analyse. Aucun contact n’est protégé, ni en plein scénario, ni visé par une campagne programmée. Un contact qui a dit STOP reste désabonné.',
          'Irreversible: once your workspace is full, each new contact deletes your oldest contact, with its conversation, messages and analysis. No contact is protected, not even in a running scenario or targeted by a scheduled campaign. A contact who said STOP stays unsubscribed.',
        ),
        confirmer: t('Activer', 'Turn on'),
      });
      if (!ok) return;
    }
    setEtat({ ...etat, actif: suivant });
    setStatut('saving');
    reglerRemplacementContacts(tenantId, suivant)
      .then(() => setStatut('saved'))
      .catch(() => { setEtat({ ...etat, actif: !suivant }); setStatut('error'); });
  }, [confirmer, etat, t, tenantId]);

  if (etat === null || !etat.possible) return null;
  const libelle = statut === 'saving' ? t('enregistrement…', 'saving…') : statut === 'saved' ? t('enregistré', 'saved') : statut === 'error' ? t('erreur', 'error') : '';

  return (
    <section className="rounded-carte border border-ink-200 bg-white p-5" data-testid="param-remplacement-contacts">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink-900">{t('Quand l’espace est plein, le contact le plus ancien laisse sa place', 'When the workspace is full, the oldest contact makes room')}</h3>
          <p className="mt-1 text-sm text-ink-500">
            {t(
              'Désactivé, un espace plein refuse les nouveaux contacts. Activé, chaque nouveau contact efface définitivement le plus ancien (sa conversation, ses messages et son analyse), imports compris : l’aperçu d’un import dit combien seront effacés.',
              'Off, a full workspace refuses new contacts. On, each new contact permanently deletes the oldest one (its conversation, messages and analysis), imports included: an import preview says how many will be deleted.',
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`text-xs ${statut === 'error' ? 'text-danger' : 'text-ink-500'}`}>{libelle}</span>
          <Toggle
            testid="param-remplacement-contacts-toggle"
            checked={etat.actif}
            onChange={() => void basculer()}
            disabled={statut === 'saving'}
            title={t('Effacer le contact le plus ancien quand l’espace est plein', 'Delete the oldest contact when the workspace is full')}
          />
        </div>
      </div>
    </section>
  );
}
