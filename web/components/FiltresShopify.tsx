'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useT } from '@/lib/i18n';
import type { ContactFieldFilter } from '@/lib/api';
import { inputClsAuto } from '@/lib/ui';
import { formatDate } from '@/lib/day';
import {
  BORNES_SEGMENTS, CLES_COMMANDES, CLES_SEGMENT, filtreSegment, valeurSegment,
  type CleSegment, type PlageSurJours, type SuiviSegmentsVue,
} from '@/lib/partage/segments';
import { lirePlageSaisie, saisieDePlage, type SaisiePlage } from '@/lib/segments';
import { Icone } from '@/components/Icone';
import { LogoShopify } from '@/components/LogosCanaux';

/**
 * LE VOLET « SHOPIFY » DU PANNEAU DE FILTRES (spec du 2026-11-21, lot 1, décision d'ergonomie de Julien du
 * 2026-11-22) : les critères qui lisent les commandes de la boutique, regroupés dans un volet replié par défaut. Une
 * seule définition : le mini-CRM et l'audience d'une campagne (onglet « Shopify », volet forcé ouvert) l'affichent
 * par le même `ContactFilterPanel`. Les critères sont des `fieldFilters` sous clé réservée (`@/lib/partage/segments`) ;
 * ce composant n'écrit que les siens et rend les autres tels quels.
 *
 * 🔴 PAS DE BOUTIQUE, PAS DE VOLET : masqué plutôt que grisé, comme le bouton HubSpot. Un critère déjà posé (brouillon
 * d'avant la coupure du lien, API qui ne répond pas) le garde visible, pour qu'on le voie et qu'on le retire : un
 * serveur qui ne le connaît pas n'y trouve personne. Une boutique coupée garde son volet, l'historique se filtre.
 *
 * ⚠️ IL S'OUVRE DÈS QU'UN CRITÈRE EST POSÉ : un brouillon repris montre ce qui filtre, au lieu d'un volet fermé qui
 * cacherait pourquoi la liste a maigri.
 */
export function FiltresShopify({ segments, onChange, suivi, ouvert: force = false }: {
  segments: ContactFieldFilter[];
  onChange: (segments: ContactFieldFilter[]) => void;
  suivi: SuiviSegmentsVue | null;
  /** L'onglet « Shopify » de l'audience l'ouvre ; le mini-CRM le laisse replié. */
  ouvert?: boolean;
}) {
  const t = useT();
  const { locale } = useLocale();
  const posee = segments.some((s) => (CLES_COMMANDES as readonly string[]).includes(s.key));
  const [ouvert, setOuvert] = useState(force || posee);
  useEffect(() => {
    if (force || posee) setOuvert(true);
  }, [force, posee]);
  const boutique = suivi?.boutique ?? null;
  if (boutique === null && !posee) return null;

  /** Remplace (ou retire, `undefined`) le critère `cle`, sans toucher aux autres. */
  const ecrire = (cle: CleSegment, valeur: PlageSurJours | undefined) =>
    onChange([...segments.filter((s) => s.key !== cle), ...(valeur === undefined ? [] : [filtreSegment(cle, valeur)])]);
  const plage = (cle: CleSegment): PlageSurJours | undefined => {
    const v = valeurSegment(segments, cle);
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as PlageSurJours : undefined;
  };

  const devise = boutique?.devise ?? '';
  return (
    <details
      open={ouvert}
      onToggle={(e) => setOuvert(e.currentTarget.open)}
      className="group/shopify rounded-controle border border-ink-200"
      data-testid="filtres-shopify"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs text-ink-500 [&::-webkit-details-marker]:hidden" data-testid="filtres-shopify-titre">
        <span aria-hidden="true"><LogoShopify className="h-3.5 w-3.5" /></span>
        <span className="flex-1">Shopify</span>
        <Icone nom="deplier" taille="petite" className="text-ink-400 transition-transform duration-150 group-open/shopify:rotate-180" />
      </summary>
      <div className="flex flex-col gap-2 border-t border-ink-100 px-3 py-3">
        <LignePlage
          nom="commandes" posee={plage(CLES_SEGMENT.commandes)} onChange={(p) => ecrire(CLES_SEGMENT.commandes, p)}
          avecJours restreint entier max={BORNES_SEGMENTS.commandesMax} libelle={t('Commandes payées', 'Paid orders')}
        />
        <LignePlage
          nom="depense" posee={plage(CLES_SEGMENT.depense)} onChange={(p) => ecrire(CLES_SEGMENT.depense, p)}
          avecJours restreint entier={false} max={BORNES_SEGMENTS.depenseMax}
          libelle={devise ? t(`Dépense (${devise})`, `Spent (${devise})`) : t('Dépense', 'Spent')}
        />
        <LignePlage
          nom="derniere-commande" posee={plage(CLES_SEGMENT.derniereCommande)} onChange={(p) => ecrire(CLES_SEGMENT.derniereCommande, p)}
          avecJours={false} restreint={false} entier max={BORNES_SEGMENTS.joursMax}
          libelle={t('Dernière commande, il y a (jours)', 'Last order, days ago')}
        />
        {boutique && (
          <p className="text-xs text-ink-500" data-testid="filtres-achats-suivi">
            {t(
              `Commandes payées suivies depuis le ${formatDate(boutique.commandesDepuis, locale)}, commandes de test comprises, remboursements non déduits.`,
              `Paid orders recorded since ${formatDate(boutique.commandesDepuis, locale)}, test orders included, refunds not deducted.`,
            )}
            {boutique.coupeeLe && ` ${t(`Boutique coupée le ${formatDate(boutique.coupeeLe, locale)}.`, `Store disconnected on ${formatDate(boutique.coupeeLe, locale)}.`)}`}
          </p>
        )}
      </div>
    </details>
  );
}

/**
 * Une plage (au moins, au plus, et sur N jours pour les commandes et la dépense). La saisie vit ici ; seule une plage
 * VALIDE remonte dans les filtres. 🔴 Une saisie invalide dit pourquoi et NE RETIRE RIEN : le dernier critère valide reste
 * appliqué, sinon « au moins 2 », puis un maximum à 1 par erreur, rendrait l'audience des autres filtres à la campagne.
 */
function LignePlage({ nom, posee, onChange, avecJours, restreint, entier, max, libelle }: {
  nom: string; posee: PlageSurJours | undefined; onChange: (p: PlageSurJours | undefined) => void;
  avecJours: boolean; restreint: boolean; entier: boolean; max: number; libelle: string;
}) {
  const t = useT();
  const [saisie, setSaisie] = useState<SaisiePlage>(() => saisieDePlage(posee));
  // Ce que cette ligne a elle-même envoyé : seul un changement venu d'ailleurs (réinitialisation, brouillon repris)
  // réécrit la saisie, sinon des jours tapés avant le minimum disparaîtraient.
  const envoye = useRef(JSON.stringify(posee ?? null));
  useEffect(() => {
    const venu = JSON.stringify(posee ?? null);
    if (venu !== envoye.current) { envoye.current = venu; setSaisie(saisieDePlage(posee)); }
  }, [posee]);
  const lecture = lirePlageSaisie(saisie, { max, entier, avecJours, restreint });
  const changer = (patch: Partial<SaisiePlage>) => {
    const s = { ...saisie, ...patch };
    setSaisie(s);
    const l = lirePlageSaisie(s, { max, entier, avecJours, restreint });
    if ('erreur' in l) return;
    envoye.current = JSON.stringify(l.plage ?? null);
    onChange(l.plage);
  };
  const champ = (k: keyof SaisiePlage, largeur: string) => (
    <input
      type="number" inputMode="decimal" min={k === 'jours' ? 1 : 0} max={k === 'jours' ? BORNES_SEGMENTS.joursMax : max}
      value={saisie[k]} onChange={(e) => changer({ [k]: e.target.value })} className={`${inputClsAuto} ${largeur}`}
      data-testid={`filtre-${nom}-${k}`}
    />
  );
  const erreur = 'erreur' in lecture
    ? lecture.erreur === 'ordre' ? t('Le minimum dépasse le maximum.', 'The minimum is above the maximum.')
      : lecture.erreur === 'zero' ? t('« Au moins 0 » ne restreint rien : un minimum au-dessus de 0, ou un maximum.', '"At least 0" restricts nothing: a minimum above 0, or a maximum.')
        : t('Un nombre dans les bornes, s’il vous plaît.', 'A number within bounds, please.')
    : null;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-700">
        <span className="min-w-40">{libelle}</span>
        <span>{t('au moins', 'at least')}</span>{champ('min', 'w-24')}
        <span>{t('au plus', 'at most')}</span>{champ('max', 'w-24')}
        {avecJours && <><span>{t('sur les', 'over the last')}</span>{champ('jours', 'w-20')}<span>{t('derniers jours (vide : depuis le début du suivi)', 'days (empty: since tracking started)')}</span></>}
      </div>
      {erreur && <p className="text-xs text-danger" data-testid={`filtre-${nom}-erreur`}>{erreur}</p>}
    </div>
  );
}
