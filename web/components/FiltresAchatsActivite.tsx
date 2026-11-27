'use client';

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import type { ContactFieldFilter } from '@/lib/api';
import { inputClsAuto } from '@/lib/ui';
import {
  BORNES_SEGMENTS, CLES_ACTIVITE, CLES_REPONSE_CLIC, CLES_SEGMENT, filtreSegment, valeurSegment,
  type CleSegment, type SuiviSegmentsVue,
} from '@/lib/partage/segments';

/**
 * LA PARTIE « ACHATS ET ACTIVITÉ » DU PANNEAU DE FILTRES (spec du 2026-10-31) : l'activité (a écrit ou cliqué). Elle marche
 * sans boutique. Les critères de commande vivent dans le volet « Shopify » (`FiltresShopify`, spec du 2026-11-21, lot 1).
 * Les critères sont des `fieldFilters` sous clé réservée (`@/lib/partage/segments`) ; ce composant n'écrit que les siens
 * et rend les autres tels quels.
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
  const activitePosee = segments.some((s) => (CLES_ACTIVITE as readonly string[]).includes(s.key));
  const reponseClicPose = segments.some((s) => (CLES_REPONSE_CLIC as readonly string[]).includes(s.key));
  if (suivi === null && !activitePosee && !reponseClicPose) return null;

  /** Remplace (ou retire, `undefined`) le critère `cle`, sans toucher aux autres. */
  const ecrire = (cle: CleSegment, valeur: number | undefined) =>
    onChange([...segments.filter((s) => s.key !== cle), ...(valeur === undefined ? [] : [filtreSegment(cle, valeur)])]);
  const jours = (cle: CleSegment): number | undefined => {
    const v = valeurSegment(segments, cle);
    return typeof v === 'number' ? v : undefined;
  };

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
      {(suivi?.reponsesCompletesDepuis !== undefined || reponseClicPose) && (
        // Lot 7c : la réponse et le clic séparés. 🔴 Seulement si l'API l'annonce (ou déjà posé, pour pouvoir le retirer).
        <div className="flex flex-col gap-1" data-testid="filtres-reponse-clic">
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-700">
            <span>{t('A écrit dans les', 'Wrote in the last')}</span>
            <ChampJours valeur={jours(CLES_SEGMENT.reponse)} onChange={(n) => ecrire(CLES_SEGMENT.reponse, n)} testid="filtre-reponse-jours" />
            <span>{t('derniers jours', 'days')}</span>
            <span className="text-ink-300">·</span>
            <span>{t('A cliqué un lien dans les', 'Clicked a link in the last')}</span>
            <ChampJours valeur={jours(CLES_SEGMENT.clic)} onChange={(n) => ecrire(CLES_SEGMENT.clic, n)} testid="filtre-clic-jours" />
            <span>{t('derniers jours', 'days')}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-700">
            <span>{t('A cliqué un lien dans les', 'Clicked a link in the last')}</span>
            <ChampJours
              valeur={jours(CLES_SEGMENT.clicSansReponse)} onChange={(n) => ecrire(CLES_SEGMENT.clicSansReponse, n)} testid="filtre-clic-sans-reponse-jours"
            />
            <span>{t('derniers jours, sans jamais avoir écrit', 'days, without ever writing')}</span>
          </div>
          {suivi?.reponsesCompletesDepuis !== undefined && (
            <span className="text-xs text-ink-500" data-testid="note-reponses-completes">
              {t(
                `« Jamais » : aucun message connu. Chaque message est noté depuis le ${dateCourte(suivi.reponsesCompletesDepuis, 'fr')} ; avant, seuls ceux encore conservés.`,
                `“Never”: no message known. Every message is recorded since ${dateCourte(suivi.reponsesCompletesDepuis, 'en')}; before that, only those still kept.`,
              )}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Une date `AAAA-MM-JJ` en toutes lettres, sans fuseau (elle est déjà un jour). */
function dateCourte(iso: string, langue: 'fr' | 'en'): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(langue === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
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

