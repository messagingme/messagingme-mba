'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useT } from '@/lib/i18n';
import type { ContactFieldFilter } from '@/lib/api';
import { inputClsAuto } from '@/lib/ui';
import { formatDate } from '@/lib/day';
import {
  BORNES_SEGMENTS, CLES_SEGMENT, CLES_SHOPIFY, filtreSegment, valeurSegment,
  type BoutonsSansCommandeVue, type CleSegment, type PlageSurJours, type SuiviSegmentsVue,
} from '@/lib/partage/segments';
import { lirePlageSaisie, saisieDePlage, type SaisiePlage } from '@/lib/segments';
import { Icone } from '@/components/Icone';
import { LogoShopify } from '@/components/LogosCanaux';
import { FiltresProduitsShopify } from '@/components/FiltresProduitsShopify';
import { FiltresCollectionsShopify } from '@/components/FiltresCollectionsShopify';
import { FiltresEtiquettesShopify } from '@/components/FiltresEtiquettesShopify';
import { FiltresSegmentsShopify } from '@/components/FiltresSegmentsShopify';

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
export function FiltresShopify({ tenantId, segments, onChange, suivi, ouvert: force = false }: {
  tenantId: string;
  segments: ContactFieldFilter[];
  onChange: (segments: ContactFieldFilter[]) => void;
  suivi: SuiviSegmentsVue | null;
  /** L'onglet « Shopify » de l'audience l'ouvre ; le mini-CRM le laisse replié. */
  ouvert?: boolean;
}) {
  const t = useT();
  const { locale } = useLocale();
  const posee = segments.some((s) => (CLES_SHOPIFY as readonly string[]).includes(s.key));
  const produitPose = segments.some((s) => s.key === CLES_SEGMENT.achete || s.key === CLES_SEGMENT.pasAchete || s.key === CLES_SEGMENT.reassort);
  const collectionPosee = segments.some((s) => s.key === CLES_SEGMENT.collection);
  const etiquettePosee = segments.some((s) => s.key === CLES_SEGMENT.etiquetteShopify);
  const segmentPose = segments.some((s) => s.key === CLES_SEGMENT.segmentShopify);
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
        {/* Les critères produit (lot 3) : annoncés par l'API, ou déjà posés (un brouillon les garde visibles pour les retirer). */}
        {(suivi?.produits === true || produitPose) && <FiltresProduitsShopify tenantId={tenantId} segments={segments} onChange={onChange} />}
        {/* La collection (lot 6a) : annoncée par l'API, ou déjà posée (pour la retirer). */}
        {(suivi?.collections === true || collectionPosee) && <FiltresCollectionsShopify tenantId={tenantId} segments={segments} onChange={onChange} />}
        {/* Les étiquettes Shopify (lot 6b), un bloc à part des étiquettes Messaging Me : annoncées par l'API, ou déjà posées. */}
        {(suivi?.etiquettesShopify === true || etiquettePosee) && <FiltresEtiquettesShopify tenantId={tenantId} segments={segments} onChange={onChange} />}
        {/* Les segments Shopify (lot 6c), ceux que le marchand a construits dans Shopify : annoncés par l'API, ou déjà posés. */}
        {(suivi?.segmentsShopify === true || segmentPose) && <FiltresSegmentsShopify tenantId={tenantId} segments={segments} onChange={onChange} />}
        <BoutonsSansCommande segments={segments} onChange={onChange} comptes={suivi?.boutons ?? null} />
        {boutique && (
          <p className="text-xs text-ink-500" data-testid="filtres-achats-suivi">
            {t(
              `Commandes payées suivies depuis le ${formatDate(boutique.commandesDepuis, locale)}, commandes de test comprises, remboursements non déduits.`,
              `Paid orders recorded since ${formatDate(boutique.commandesDepuis, locale)}, test orders included, refunds not deducted.`,
            )}
            {boutique.rattrapeesDepuis && ` ${t(
              `Rattrapées aussi depuis le ${formatDate(boutique.rattrapeesDepuis, locale)}, pour les fiches qui existaient alors.`,
              `Also caught up since ${formatDate(boutique.rattrapeesDepuis, locale)}, for the records that existed then.`,
            )}`}
            {boutique.coupeeLe && ` ${t(`Boutique coupée le ${formatDate(boutique.coupeeLe, locale)}.`, `Store disconnected on ${formatDate(boutique.coupeeLe, locale)}.`)}`}
          </p>
        )}
      </div>
    </details>
  );
}

/**
 * LES DEUX BOUTONS PRÊTS (lot 4, décision de Julien du 2026-11-22) : « A écrit sans commander » et « A cliqué sans
 * commander ». Un clic pose le critère, un second le retire, aucun réglage. La pastille est le compte du bouton SEUL
 * (décision du 2026-11-23), lu à l'ouverture du panneau ; le total de la liste, lui, suit tous les filtres posés.
 * 🔴 Un bouton sans compte (la réponse tarde, une API plus ancienne) ou à zéro n'est pas montré, masqué plutôt que grisé ;
 * un bouton déjà posé l'est toujours, pour qu'on puisse le retirer.
 */
function BoutonsSansCommande({ segments, onChange, comptes }: {
  segments: ContactFieldFilter[];
  onChange: (segments: ContactFieldFilter[]) => void;
  comptes: BoutonsSansCommandeVue | null;
}) {
  const t = useT();
  const boutons = [
    { cle: CLES_SEGMENT.ecritSansCommande, nom: 'ecrit', compte: comptes?.ecritSansCommande, libelle: t('A écrit sans commander', 'Wrote without ordering') },
    { cle: CLES_SEGMENT.clicSansCommande, nom: 'clic', compte: comptes?.clicSansCommande, libelle: t('A cliqué sans commander', 'Clicked without ordering') },
  ].map((b) => ({ ...b, pose: segments.some((s) => s.key === b.cle) }));
  const visibles = boutons.filter((b) => b.pose || (b.compte ?? 0) > 0);
  if (visibles.length === 0) return null;
  const basculer = (cle: CleSegment, pose: boolean) =>
    onChange(pose ? segments.filter((s) => s.key !== cle) : [...segments, filtreSegment(cle, true)]);
  return (
    <div className="flex flex-col gap-1 border-t border-ink-100 pt-2" data-testid="filtres-boutons-sans-commande">
      <div className="flex flex-wrap items-center gap-2">
        {visibles.map((b) => (
          <button
            key={b.cle}
            type="button"
            onClick={() => basculer(b.cle, b.pose)}
            aria-pressed={b.pose}
            className={`rounded-controle px-3 py-1 text-sm font-medium transition-colors duration-150 ${b.pose ? 'bg-brand-600 text-white' : 'bg-ink-100 text-ink-700 hover:bg-ink-200'}`}
            data-testid={`filtre-bouton-${b.nom}`}
          >
            {b.libelle}
            {b.compte !== undefined && <span data-testid={`filtre-bouton-${b.nom}-compte`}> · {b.compte}</span>}
          </button>
        ))}
      </div>
      <p className="text-xs text-ink-500" data-testid="filtres-boutons-legende">
        {t(
          '« A écrit » : au moins un message reçu encore connu (une réaction, un bouton touché comptent). « A cliqué » : au moins un clic sur un lien suivi. « Sans commander » : aucune commande enregistrée pour ce contact.',
          '"Wrote": at least one message still known (a reaction or a button tap counts). "Clicked": at least one tracked link click. "Without ordering": no order recorded for this contact.',
        )}
      </p>
    </div>
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
