'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useT } from '@/lib/i18n';
import type { ContactFieldFilter } from '@/lib/api';
import { inputClsAuto } from '@/lib/ui';
import { formatDate } from '@/lib/day';
import {
  BORNES_SEGMENTS, CLES_ACTIVITE, CLES_COMMANDES, CLES_SEGMENT, filtreSegment, valeurSegment,
  type CleSegment, type PlageSurJours, type SuiviSegmentsVue,
} from '@/lib/partage/segments';
import { lirePlageSaisie, saisieDePlage, type SaisiePlage } from '@/lib/segments';

/**
 * LA PARTIE « ACHATS ET ACTIVITÉ » DU PANNEAU DE FILTRES (spec du 2026-10-31) : l'activité (a écrit ou cliqué), et si
 * l'espace a une boutique Shopify, les commandes, la dépense et la dernière commande. Les critères sont des
 * `fieldFilters` sous clé réservée (`@/lib/partage/segments`) ; ce composant n'écrit que ceux-là.
 *
 * 🔴 RIEN N'EST PROPOSÉ SI L'API NE L'A PAS ANNONCÉ (`suivi === null`). Un critère déjà posé (brouillon repris) reste
 * visible, pour qu'on le voie et qu'on le retire ; un serveur qui ne le connaît pas n'y trouve personne.
 */
export function FiltresAchatsActivite({ segments, onChange, suivi }: {
  segments: ContactFieldFilter[];
  onChange: (segments: ContactFieldFilter[]) => void;
  suivi: SuiviSegmentsVue | null;
}) {
  const t = useT();
  const { locale } = useLocale();
  const pose = (cles: readonly CleSegment[]) => segments.some((s) => (cles as readonly string[]).includes(s.key));
  const commandesPosees = pose(CLES_COMMANDES);
  const montrerCommandes = suivi?.boutique != null || commandesPosees;
  if (suivi === null && !commandesPosees && !pose(CLES_ACTIVITE)) return null;

  /** Remplace (ou retire, `undefined`) le critère `cle`, sans toucher aux autres. */
  const ecrire = (cle: CleSegment, valeur: PlageSurJours | number | undefined) =>
    onChange([...segments.filter((s) => s.key !== cle), ...(valeur === undefined ? [] : [filtreSegment(cle, valeur)])]);
  const jours = (cle: CleSegment): number | undefined => {
    const v = valeurSegment(segments, cle);
    return typeof v === 'number' ? v : undefined;
  };
  const plage = (cle: CleSegment): PlageSurJours | undefined => {
    const v = valeurSegment(segments, cle);
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as PlageSurJours : undefined;
  };

  const boutique = suivi?.boutique ?? null;
  const devise = boutique?.devise ?? '';
  return (
    <div className="flex flex-col gap-2" data-testid="filtres-achats">
      <span className="text-xs text-ink-500">{t('Achats et activité', 'Purchases and activity')}</span>
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-700">
        <span>{t('Actif (a écrit ou cliqué) dans les', 'Active (wrote or clicked) in the last')}</span>
        <ChampJours valeur={jours(CLES_SEGMENT.actif)} onChange={(n) => ecrire(CLES_SEGMENT.actif, n)} testid="filtre-actif-jours" />
        <span>{t('derniers jours', 'days')}</span>
        <span className="text-ink-300">·</span>
        <span>{t('Inactif depuis', 'Inactive for')}</span>
        <ChampJours valeur={jours(CLES_SEGMENT.inactif)} onChange={(n) => ecrire(CLES_SEGMENT.inactif, n)} testid="filtre-inactif-jours" />
        <span>{t('jours, jamais actifs compris', 'days, never active included')}</span>
      </div>
      {montrerCommandes && (
        <>
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
        </>
      )}
      {/* Sans boutique, les critères de commande manquent : on dit pourquoi, et ce qui reste, au lieu de les laisser absents
          sans un mot (« où est le filtre des commandes ? »). */}
      {!montrerCommandes && (
        <p className="text-xs text-ink-500" data-testid="filtres-achats-sans-boutique">
          {t(
            'Commandes, dépense et dernière commande : branchez votre boutique Shopify (Tools > Intégrations). Nous ne connaissons une commande que par Shopify. Sans boutique, ciblez par activité, par pays (« Téléphone commence par ») ou par étiquette.',
            'Orders, amount spent and last order: connect your Shopify store (Tools > Integrations). We only know about an order through Shopify. Without a store, target by activity, by country (“Phone starts with”) or by tag.',
          )}
        </p>
      )}
    </div>
  );
}

/**
 * Un nombre de jours, de 1 à 3 650 ; vide = pas de critère. 🔴 Une saisie hors bornes n'est pas envoyée et ne retire
 * rien : le dernier critère valide reste appliqué, sinon une faute de frappe élargirait l'audience d'une campagne.
 */
function ChampJours({ valeur, onChange, testid }: { valeur: number | undefined; onChange: (n: number | undefined) => void; testid: string }) {
  const [texte, setTexte] = useState(valeur === undefined ? '' : String(valeur));
  // Ce que ce champ a lui-même envoyé : seul un changement venu d'ailleurs (réinitialisation, brouillon) réécrit la saisie.
  const envoye = useRef(valeur);
  useEffect(() => {
    if (valeur !== envoye.current) { envoye.current = valeur; setTexte(valeur === undefined ? '' : String(valeur)); }
  }, [valeur]);
  const changer = (v: string) => {
    setTexte(v);
    const n = Number(v);
    const valide = Number.isInteger(n) && n >= 1 && n <= BORNES_SEGMENTS.joursMax;
    if (v.trim() !== '' && !valide) return;
    envoye.current = v.trim() === '' ? undefined : n;
    onChange(envoye.current);
  };
  return (
    <input
      type="number" inputMode="numeric" min={1} max={BORNES_SEGMENTS.joursMax} value={texte}
      onChange={(e) => changer(e.target.value)} className={`${inputClsAuto} w-20`} data-testid={testid}
    />
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
