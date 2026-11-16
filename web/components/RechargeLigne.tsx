'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bouton } from '@/components/Bouton';
import { eurosDepuisMicro } from '@/lib/agent-solde';
import { estPageDePaiement, retenirDepartPaiement } from '@/lib/api-credit';
import { getCreditWhatsapp, ouvrirAchatWhatsapp, type OffreWhatsapp, type VueCreditWhatsapp } from '@/lib/api-credit-whatsapp';
import { fmtNum } from '@/lib/format';
import { erreurDeChargement } from '@/lib/http';
import { useLocale, useT } from '@/lib/i18n';

/**
 * LE NUMÉRO CONNECTÉ SUR LA LIGNE DE CRÉDIT, LA SUITE EST DE LA RECHARGER (essai 263, Julien, 2026-11-16 : « la logique
 * voudrait que tu me donnes les choix de recharger au lieu de me reparler de l'option que j'ai payée »). Le solde, et les
 * mêmes recharges que l'onglet Ligne de crédit (`ouvrirAchatWhatsapp`, la page de Stripe, retour sur l'onglet) ; une
 * Entreprise, illimitée, n'a rien à recharger. Une lecture en panne renvoie à l'onglet, sans rien inventer.
 */
export function RechargeLigne({ tenantId, admin, surVue }: {
  tenantId: string; admin: boolean;
  /** La vue lue (ou `null`, illisible) : le fil des étapes en tire le solde (`FilLigne`). */
  surVue?: (v: VueCreditWhatsapp | null) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [vue, setVue] = useState<VueCreditWhatsapp | null | undefined>(undefined);
  const [enCours, setEnCours] = useState<OffreWhatsapp | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    let vivant = true;
    getCreditWhatsapp(tenantId).then((v) => { if (vivant) setVue(v); }).catch(() => { if (vivant) setVue(null); });
    return () => { vivant = false; };
  }, [tenantId]);
  useEffect(() => { if (vue !== undefined) surVue?.(vue); }, [vue, surVue]);

  async function payer(offre: OffreWhatsapp): Promise<void> {
    setEnCours(offre);
    setErreur(null);
    try {
      const r = await ouvrirAchatWhatsapp(tenantId, offre);
      if ('indisponible' in r) { setVue(null); setEnCours(null); return; }
      if (!estPageDePaiement(r.url)) throw new Error(t('Adresse de paiement invalide.', 'Invalid payment address.'));
      retenirDepartPaiement(Date.now());
      window.location.assign(r.url);
    } catch (err) {
      setErreur(erreurDeChargement(err, t));
      setEnCours(null);
    }
  }

  const onglet = (
    <Link href="/offre?tab=whatsapp" className="font-semibold text-ink-900 underline" data-testid="recharge-ligne-onglet">
      {t('Offre, onglet Ligne de crédit', 'Plan, Credit line tab')}
    </Link>
  );
  if (vue === undefined) return null;
  const solde = vue ? new Intl.NumberFormat(locale === 'en' ? 'en-GB' : 'fr-FR', { style: 'currency', currency: 'EUR' }).format(eurosDepuisMicro(vue.soldeMicroEur)) : '';
  const ouvert = vue !== null && !vue.illimite && vue.achat.disponible && vue.achat.permis === 'ok';

  return (
    // Dans l'étape 3 du fil (`FilLigne`), qui porte déjà le titre et la règle du solde à zéro : le solde, puis les recharges.
    <div data-testid="recharge-ligne">
      {vue === null ? (
        <p className="mt-1 text-sm text-ink-700">{t('Rechargez-la depuis ', 'Top it up from ')}{onglet}.</p>
      ) : vue.illimite ? (
        <p className="mt-1 text-sm text-ink-700">{t('Illimitée : vos messages sont facturés selon votre contrat, rien à recharger.', 'Unlimited: your messages are billed under your contract, nothing to top up.')}</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-ink-700" data-testid="recharge-ligne-solde">
            {t(`Solde : ${solde}.`, `Balance: ${solde}.`)}
          </p>
          {ouvert && admin ? (
            <>
              <div className="mt-3 flex flex-wrap gap-2">
                {vue.achat.offres.map(({ offre, htCentimes }) => (
                  <Bouton key={offre} data-testid={`recharge-ligne-${offre}`} onClick={() => { void payer(offre); }} disabled={enCours !== null} enCours={enCours === offre}>
                    {t(`Recharger ${fmtNum(htCentimes / 100, 'fr')} € HT`, `Top up €${fmtNum(htCentimes / 100, 'en')} excl. VAT`)}
                  </Bouton>
                ))}
              </div>
              <p className="mt-2 text-xs text-ink-500">
                {t('Montants hors taxe, TVA en sus, payés sur la page sécurisée de Stripe. Le détail et l’historique : ', 'Amounts exclude VAT, paid on Stripe’s secure page. Details and history: ')}{onglet}.
              </p>
            </>
          ) : (
            <p className="mt-2 text-sm text-ink-700">{admin ? <>{t('Rechargez-la depuis ', 'Top it up from ')}{onglet}.</> : t('Un administrateur de votre espace peut la recharger.', 'An administrator of your workspace can top it up.')}</p>
          )}
          {erreur && <p className="mt-2 text-sm text-danger" data-testid="recharge-ligne-erreur">{erreur}</p>}
        </>
      )}
    </div>
  );
}
