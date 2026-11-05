'use client';

import { useState } from 'react';
import { Bouton } from '@/components/Bouton';
import { useConfirmation } from '@/components/Confirmation';
import { useT } from '@/lib/i18n';
import { erreurDeChargement } from '@/lib/http';
import { demarrerPro } from '@/lib/api/offre';

/**
 * « DÉMARRER LA FORMULE PRO MAINTENANT » (révision du Crédit WhatsApp, 2026-11-04, décision 6) : un client en essai l'arrête
 * pour que Stripe prélève tout de suite la carte prise au début de l'essai. Dans le bloc de l'abonnement Pro, et dans
 * l'onglet Crédit WhatsApp, qui enchaîne ensuite sur le paiement de l'option.
 *
 * 🔴 CONFIRMÉ AVANT TOUT PRÉLÈVEMENT : l'essai gratuit s'arrête aujourd'hui, et le prix de la formule.
 * 🔴 UN REFUS LAISSE L'ESSAI TEL QUEL : le message du serveur s'affiche (carte refusée, résiliation programmée).
 * Ce qui suit un démarrage (relire l'offre, dire qu'il est fait ou en cours, enchaîner) revient à l'écran qui le porte
 * (`onDemarre`) : `paye` faux, un prélèvement différé (SEPA), ne s'annonce pas comme fait et n'enchaîne sur rien.
 */
export function DemarrerPro({ tenantId, formule, suite, onDemarre, testid }: {
  tenantId: string;
  /** La formule et son prix (`phraseFormulePro`), dits dans la confirmation ; `null` s'ils ne sont pas connus. */
  formule: string | null;
  /** Une phrase de plus dans la confirmation, déjà traduite : ce qui suit le démarrage. */
  suite?: string;
  onDemarre: (paye: boolean) => Promise<void>;
  testid: string;
}) {
  const t = useT();
  const confirmer = useConfirmation();
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function demarrer(): Promise<void> {
    const prix = formule ? ` (${formule})` : '';
    const ensuite = suite ? `\n\n${suite}` : '';
    const ok = await confirmer({
      titre: t('Démarrer la formule Pro maintenant', 'Start the Pro plan now'),
      message: t(
        `Votre essai gratuit s’arrête aujourd’hui : votre formule Pro${prix} est prélevée tout de suite sur la carte enregistrée au début de l’essai.${ensuite}`,
        `Your free trial ends today: your Pro plan${prix} is charged right away to the card saved at the start of the trial.${ensuite}`,
      ),
      confirmer: t('Démarrer maintenant', 'Start now'),
    });
    if (!ok) return;
    setEnCours(true);
    setErreur(null);
    try {
      const { paye } = await demarrerPro(tenantId);
      await onDemarre(paye);
    } catch (err) {
      setErreur(erreurDeChargement(err, t));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="space-y-2">
      <Bouton onClick={() => void demarrer()} enCours={enCours} disabled={enCours} data-testid={testid}>
        {t('Démarrer la formule Pro maintenant', 'Start the Pro plan now')}
      </Bouton>
      {erreur && <p className="text-sm text-danger" data-testid={`${testid}-erreur`}>{erreur}</p>}
    </div>
  );
}
