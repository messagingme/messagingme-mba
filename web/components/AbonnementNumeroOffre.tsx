'use client';

import { useEffect, useState } from 'react';
import { Bouton } from '@/components/Bouton';
import { useLocale, useT } from '@/lib/i18n';
import { erreurDeChargement } from '@/lib/http';
import { lireAbonnementNumero, type EtatAbonnementNumero } from '@/lib/api/abonnement-numero';
import { apiDeLaSession } from '@/lib/api/connexion-numero';

/**
 * L'ABONNEMENT DU NUMÉRO FOURNI SUR LA PAGE OFFRE (2026-11-16) : un client Free qui veut résilier son numéro va à la
 * facturation, donc ici. Il y voyait ses factures du numéro, sans aucun bouton pour l'arrêter : le seul était sur
 * « Connecter WhatsApp ». La carte ouvre le MÊME portail de Stripe (`/numero-fourni/portail`).
 *
 * Seulement quand l'abonnement court (`actif`, `fin_prevue`) : en retard ou suspendu, le bandeau de chaque page porte déjà
 * le geste. Une API sans la route, ou une lecture qui échoue : rien.
 */
export function AbonnementNumeroOffre({ tenantId }: { tenantId: string }) {
  const t = useT();
  const { locale } = useLocale();
  const [e, setE] = useState<EtatAbonnementNumero | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let vivant = true;
    lireAbonnementNumero(tenantId).then((r) => { if (vivant) setE(r); }).catch(() => {});
    return () => { vivant = false; };
  }, [tenantId]);

  if (e === null || (e.etat !== 'actif' && e.etat !== 'fin_prevue')) return null;

  async function ouvrir(): Promise<void> {
    setEnCours(true);
    setErreur(null);
    try {
      window.location.assign((await apiDeLaSession(tenantId).portail!()).url);
    } catch (err) {
      setEnCours(false);
      setErreur(erreurDeChargement(err, t));
    }
  }

  const fin = e.etat === 'fin_prevue' && e.finPrevueLe
    ? new Date(e.finPrevueLe).toLocaleDateString(locale === 'en' ? 'en-GB' : 'fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  return (
    <section className="flex flex-wrap items-center gap-3 rounded-carte border border-ink-200 bg-white p-5" data-testid="offre-numero-fourni">
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-ink-900">{t('Votre numéro WhatsApp fourni', 'Your provided WhatsApp number')}</h2>
        <p className="mt-1 text-sm text-ink-500">
          {fin
            ? t(`Résiliation programmée : l’abonnement s’arrête le ${fin}. Vous pouvez encore l’annuler sur la page de Stripe.`,
              `Cancellation scheduled: the subscription ends on ${fin}. You can still undo it on Stripe’s page.`)
            : t('Changer de carte, retrouver vos factures ou résilier : tout se fait sur la page de Stripe. Une résiliation prend effet à la fin du mois déjà payé.',
              'Change your card, find your invoices or cancel: it all happens on Stripe’s page. A cancellation takes effect at the end of the month already paid.')}
        </p>
      </div>
      <Bouton variante="secondaire" onClick={() => void ouvrir()} enCours={enCours} disabled={enCours} data-testid="offre-numero-portail">
        {t('Gérer l’abonnement du numéro', 'Manage the number subscription')}
      </Bouton>
      {erreur && <p className="w-full text-sm text-danger" data-testid="offre-numero-erreur">{erreur}</p>}
    </section>
  );
}
