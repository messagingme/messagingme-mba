'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Bouton } from '@/components/Bouton';
import { useConfirmation } from '@/components/Confirmation';
import { useLocale, useT } from '@/lib/i18n';
import { changerPacksContacts } from '@/lib/api/offre';
import { ApiError, erreurDeChargement } from '@/lib/http';
import { relireOffre } from '@/lib/use-offre';
import { fmtNum } from '@/lib/format';
import type { VueOffre } from '@/lib/offre';

/**
 * LES CONTACTS DE LA FORMULE PRO (décision de Julien du 2026-11-24, plan `2026-11-24-contacts-packs-et-remplacement.md`,
 * lot 1) : les 1 000 contacts inclus, les packs de 1 000 achetés en plus, « Ajouter 1 000 contacts » au prix de la formule
 * et « Retirer 1 000 contacts ». L'ajout facture le prorata sur la carte du Pro, et ne s'applique que s'il est payé ; sinon
 * la facture à régler est proposée. Le retrait ne rembourse rien et n'efface rien : il est refusé tant que les contacts ne
 * tiennent pas. Rien ne s'affiche hors Pro, ni sur une API plus ancienne (`packsContacts` absent).
 */
export function PacksContactsPro({ tenantId, vue }: { tenantId: string; vue: VueOffre }) {
  const t = useT();
  const { locale } = useLocale();
  const confirmer = useConfirmation();
  /** Les packs après un geste fait sur cette page : `null` = ceux de la vue. */
  const [choisis, setChoisis] = useState<number | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [facture, setFacture] = useState<string | null>(null);
  // Venu du bandeau de la page Contacts ou de l'e-mail de limite (`/offre?pack=ajouter`, 2026-11-25) : le bloc se montre et
  // la confirmation de l'achat s'ouvre, une fois ; l'adresse perd le paramètre, pour qu'un rechargement ne la rouvre pas.
  const params = useSearchParams();
  const router = useRouter();
  const bloc = useRef<HTMLElement | null>(null);
  const dejaOuvert = useRef(false);
  const ajouterUn = useRef<(() => Promise<void>) | null>(null);
  const demandeAjout = params.get('pack') === 'ajouter';
  useEffect(() => {
    if (!demandeAjout || dejaOuvert.current || ajouterUn.current === null) return;
    dejaOuvert.current = true;
    router.replace('/offre', { scroll: false });
    bloc.current?.scrollIntoView({ block: 'center' });
    void ajouterUn.current();
  }, [demandeAjout, router]);

  const p = vue.packsContacts;
  if (vue.offre !== 'pro' || p === null) return null;
  const achetes = choisis ?? p.achetes;
  const total = p.inclus + p.contactsParPack * achetes;
  const pack = fmtNum(p.contactsParPack, locale);
  const prix = vue.prixPackContacts ? (p.periodicite === 'an' ? vue.prixPackContacts.anCentimes : vue.prixPackContacts.moisCentimes) : null;
  const prixDit = prix === null ? '' : `${fmtNum(prix / 100, locale)} €`;

  async function changer(cible: number): Promise<void> {
    const ajout = cible > achetes;
    const ok = await confirmer(ajout
      ? {
        titre: t(`Ajouter ${pack} contacts`, `Add ${pack} contacts`),
        message: p!.periodicite === 'an'
          ? t(`${prixDit} HT par an. Le prorata jusqu’à la fin de votre période est facturé maintenant, sur la carte de la formule Pro (pendant un essai, rien n’est facturé avant sa fin).`,
            `${prixDit} excl. VAT a year. The prorated amount until the end of your period is charged now, on the Pro card (during a trial, nothing is charged before it ends).`)
          : t(`${prixDit} HT par mois. Le prorata jusqu’à la fin de votre période est facturé maintenant, sur la carte de la formule Pro (pendant un essai, rien n’est facturé avant sa fin).`,
            `${prixDit} excl. VAT a month. The prorated amount until the end of your period is charged now, on the Pro card (during a trial, nothing is charged before it ends).`),
        confirmer: t('Ajouter', 'Add'),
      }
      : {
        titre: t(`Retirer ${pack} contacts`, `Remove ${pack} contacts`),
        message: t('La période en cours n’est pas remboursée. Vos contacts doivent tenir dans la limite qui reste : aucun n’est effacé pour faire de la place.',
          'The current period is not refunded. Your contacts must fit in the remaining limit: none is deleted to make room.'),
        confirmer: t('Retirer', 'Remove'),
      });
    if (!ok) return;
    setEnCours(true);
    setErreur(null);
    setFacture(null);
    try {
      setChoisis((await changerPacksContacts(tenantId, achetes, cible)).packs);
      // La limite de contacts a changé : la jauge et la coquille relisent la vue entière.
      await relireOffre(tenantId);
    } catch (err) {
      const corps = err instanceof ApiError ? err.corps : null;
      const url = typeof corps === 'object' && corps !== null && (corps as { code?: unknown }).code === 'paiement_pack_contacts_incomplet'
        ? (corps as { url?: unknown }).url : null;
      setFacture(typeof url === 'string' && url.startsWith('https://') ? url : null);
      setErreur(erreurDeChargement(err, t));
    } finally {
      setEnCours(false);
    }
  }

  // Le geste que l'effet du haut joue quand on arrive par `?pack=ajouter` : seulement si les packs sont en vente.
  ajouterUn.current = prix === null ? null : () => changer(achetes + 1);

  return (
    <section ref={bloc} id="packs-contacts" className="flex flex-wrap items-center gap-3 rounded-carte border border-ink-200 bg-white p-5" data-testid="offre-packs-contacts">
      <p className="min-w-0 flex-1 text-sm text-ink-500">
        {achetes === 0
          ? t(`Votre formule Pro comprend ${fmtNum(p.inclus, locale)} contacts.`, `Your Pro plan includes ${fmtNum(p.inclus, locale)} contacts.`)
          : t(`Votre formule Pro comprend ${fmtNum(p.inclus, locale)} contacts, et ${achetes} pack${achetes > 1 ? 's' : ''} de ${pack} contacts en plus : ${fmtNum(total, locale)} contacts en tout.`,
            `Your Pro plan includes ${fmtNum(p.inclus, locale)} contacts, and ${achetes} extra pack${achetes > 1 ? 's' : ''} of ${pack} contacts: ${fmtNum(total, locale)} contacts in all.`)}
        {prix === null
          ? t(' Les contacts en plus ne sont pas encore en vente.', ' Extra contacts are not on sale yet.')
          : p.periodicite === 'an'
            ? t(` ${pack} contacts de plus : ${prixDit} HT par an.`, ` ${pack} more contacts: ${prixDit} excl. VAT a year.`)
            : t(` ${pack} contacts de plus : ${prixDit} HT par mois.`, ` ${pack} more contacts: ${prixDit} excl. VAT a month.`)}
      </p>
      {prix !== null && (
        <Bouton variante="secondaire" onClick={() => void changer(achetes + 1)} enCours={enCours} disabled={enCours} data-testid="offre-ajouter-pack">
          {t(`Ajouter ${pack} contacts`, `Add ${pack} contacts`)}
        </Bouton>
      )}
      {achetes > 0 && (
        <Bouton variante="secondaire" onClick={() => void changer(achetes - 1)} enCours={enCours} disabled={enCours} data-testid="offre-retirer-pack">
          {t(`Retirer ${pack} contacts`, `Remove ${pack} contacts`)}
        </Bouton>
      )}
      {erreur && (
        <p className="w-full text-sm text-danger" data-testid="offre-packs-erreur">
          {erreur}
          {facture && (
            <> <a href={facture} target="_blank" rel="noopener noreferrer" className="underline" data-testid="offre-packs-facture">{t('Régler la facture', 'Pay the invoice')}</a></>
          )}
        </p>
      )}
    </section>
  );
}
