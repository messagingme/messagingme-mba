'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useLocale, useT } from '@/lib/i18n';
import { bulkContactAction, type ContactFieldFilter } from '@/lib/api';
import { inputClsAuto } from '@/lib/ui';
import { formatDate } from '@/lib/day';
import {
  BORNES_SEGMENTS, CLES_SEGMENT, filtreSegment, valeurSegment, type SegmentShopifyVue, type SegmentsShopifyLusVue, type SegmentsShopifyVises,
} from '@/lib/partage/segments';
import { chargerSegmentsShopify } from '@/lib/segments';

/** Tant qu'une synchronisation tourne, la liste se relit toutes les 5 s, deux minutes au plus. */
const RELECTURE_MS = 5_000;
const RELECTURES_MAX = 24;
/** La borne d'une étiquette Messaging Me (`LONGUEUR_MAX_ETIQUETTE`, `src/crm/poser-etiquette.ts`), pour la copie. */
const ETIQUETTE_MAX = 64;

/**
 * LES SEGMENTS SHOPIFY DU VOLET SHOPIFY (segments Shopify enrichis, lot 6c) : les segments que le marchand a construits DANS
 * SHOPIFY et choisis de suivre sur la carte Shopify (20 au plus), dont la synchronisation lit les membres. Un bloc à part :
 * ni les étiquettes Messaging Me, ni les étiquettes Shopify.
 *
 * Le critère : dans TOUS les segments choisis, ou dans l'un d'eux, avec les membres que Shopify a donnés à la dernière
 * lecture de chacun (la ligne le dit, avec sa date). Un segment pas encore lu ne se cible pas ; s'il a été posé (un brouillon
 * repris), le serveur refuse le critère en le nommant, jamais « personne ».
 *
 * Comme pour les étiquettes Shopify, le seul pont vers les étiquettes Messaging Me est la COPIE EXPLICITE (« Copier en
 * étiquette Messaging Me ») : posée maintenant, sans suivi ensuite, sans consentement. Ce composant n'écrit que sa clé.
 */
export function FiltresSegmentsShopify({ tenantId, segments, onChange }: {
  tenantId: string;
  segments: ContactFieldFilter[];
  onChange: (segments: ContactFieldFilter[]) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [vue, setVue] = useState<SegmentsShopifyLusVue | null | 'chargement'>('chargement');
  const [relectures, setRelectures] = useState(0);
  const [copie, setCopie] = useState<{ segment: SegmentShopifyVue; nom: string; enCours: boolean; erreur: string | null } | null>(null);
  const [copiee, setCopiee] = useState<string | null>(null);

  useEffect(() => {
    let actif = true;
    void chargerSegmentsShopify(tenantId).then((r) => { if (actif) setVue(r); });
    return () => { actif = false; };
  }, [tenantId, relectures]);

  const lue = vue !== null && vue !== 'chargement' ? vue : null;
  const synchro = lue?.synchro ?? null;
  useEffect(() => {
    if (!synchro?.enCours || relectures >= RELECTURES_MAX) return;
    const minuterie = setTimeout(() => setRelectures((n) => n + 1), RELECTURE_MS);
    return () => clearTimeout(minuterie);
  }, [synchro?.enCours, relectures]);

  const posee = segmentsDe(valeurSegment(segments, CLES_SEGMENT.segmentShopify));
  const suivis = (lue?.segments ?? []).filter((s) => s.suivi && !s.absent);
  const nomDe = (id: string): string => lue?.segments.find((s) => s.segmentId === id)?.nom ?? id;
  /** Remplace (ou retire) le critère, sans toucher aux autres. */
  const ecrire = (e: SegmentsShopifyVises | undefined) =>
    onChange([...segments.filter((s) => s.key !== CLES_SEGMENT.segmentShopify), ...(e === undefined ? [] : [filtreSegment(CLES_SEGMENT.segmentShopify, e)])]);
  const ajouter = (id: string) => {
    const liste = posee?.segments ?? [];
    if (liste.includes(id) || liste.length >= BORNES_SEGMENTS.segmentsShopifyMax) return;
    ecrire({ segments: [...liste, id], mode: posee?.mode ?? 'toutes' });
  };
  const retirer = (id: string) => {
    if (!posee) return;
    const liste = posee.segments.filter((x) => x !== id);
    ecrire(liste.length === 0 ? undefined : { ...posee, segments: liste });
  };

  /** La copie explicite : l'étiquette Messaging Me nommée, posée maintenant sur les fiches de ce segment. */
  const copier = async (): Promise<void> => {
    if (!copie) return;
    const nom = copie.nom.trim();
    if (nom === '' || nom.length > ETIQUETTE_MAX) return;
    setCopie({ ...copie, enCours: true, erreur: null });
    try {
      const { affected } = await bulkContactAction(
        tenantId,
        { filters: { fieldFilters: [filtreSegment(CLES_SEGMENT.segmentShopify, { segments: [copie.segment.segmentId], mode: 'toutes' })] } },
        { type: 'add_tag', tags: [nom] },
      );
      setCopie(null);
      setCopiee(t(
        `Étiquette Messaging Me « ${nom} » posée sur ${affected} fiche${affected > 1 ? 's' : ''}. Elle ne suivra pas le segment Shopify ensuite.`,
        `Messaging Me tag “${nom}” added to ${affected} record${affected === 1 ? '' : 's'}. It will not follow the Shopify segment afterwards.`,
      ));
    } catch (e: unknown) {
      setCopie({ ...copie, enCours: false, erreur: e instanceof Error ? e.message : t('Copie impossible', 'Unable to copy') });
    }
  };
  const nomValide = copie !== null && copie.nom.trim() !== '' && copie.nom.trim().length <= ETIQUETTE_MAX;
  const fiches = (n: number): string => (n === 1 ? t('1 fiche', '1 record') : t(`${n} fiches`, `${n} records`));

  return (
    <div className="flex flex-col gap-2 border-t border-ink-100 pt-2" data-testid="filtres-segments-shopify">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-ink-700">{t('Segments Shopify', 'Shopify segments')}</span>
        <span className="text-xs text-ink-500">
          {t(
            'Les segments de clients construits dans Shopify, suivis depuis la carte Shopify.',
            'The customer segments built in Shopify, followed from the Shopify card.',
          )}
        </span>
      </div>
      {posee && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-700" data-testid="filtre-segment-shopify">
          <span className="min-w-40">{t('Est dans le segment Shopify', 'Is in the Shopify segment')}</span>
          {posee.segments.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-controle bg-ink-100 px-2 py-0.5 text-xs" data-testid="filtre-segment-shopify-puce">
              {nomDe(id)}
              <button type="button" aria-label={t('Retirer', 'Remove')} className="text-ink-500 hover:text-ink-900" data-testid="filtre-segment-shopify-retirer" onClick={() => retirer(id)}>×</button>
            </span>
          ))}
          {posee.segments.length > 1 && (
            <select
              value={posee.mode} onChange={(e) => ecrire({ ...posee, mode: e.target.value === 'une' ? 'une' : 'toutes' })}
              className={`${inputClsAuto} w-auto`} data-testid="filtre-segment-shopify-mode"
            >
              <option value="toutes">{t('tous', 'all of them')}</option>
              <option value="une">{t('l’un d’eux', 'any of them')}</option>
            </select>
          )}
        </div>
      )}
      {vue === null && (
        <p className="text-xs text-danger" data-testid="filtre-segments-shopify-indisponible">
          {t('La liste des segments Shopify n’a pas pu être lue.', 'The list of Shopify segments could not be read.')}
        </p>
      )}
      {lue && suivis.length === 0 && (
        <p className="text-xs text-ink-500" data-testid="filtre-segments-shopify-aucun">
          {t('Aucun segment suivi : choisissez ceux à suivre sur la carte Shopify, dans ', 'No segment followed: choose the ones to follow on the Shopify card, in ')}
          <Link href="/integrations#integration-shopify" className="text-brand-600 hover:underline">{t('Tools > Intégrations', 'Tools > Integrations')}</Link>.
        </p>
      )}
      {synchro?.enCours && (
        <p className="text-xs text-ink-500" data-testid="filtre-segments-shopify-en-cours">
          {t('Lecture des segments en cours : la liste se complète dans un instant.', 'Reading the segments: the list fills in shortly.')}
        </p>
      )}
      {suivis.length > 0 && (
        <ul className="divide-y divide-ink-100 rounded-controle border border-ink-100 text-sm" data-testid="filtre-segments-shopify-resultats">
          {suivis.map((s) => (
            <li key={s.segmentId} className="flex flex-wrap items-center gap-2 px-2 py-1.5" data-testid="filtre-segments-shopify-resultat">
              <span className="min-w-0 flex-1 text-ink-700">
                {s.nom}
                <span className="text-xs text-ink-400">
                  {s.luLe
                    ? ` · ${fiches(s.fiches)} · ${t(`lu le ${formatDate(s.luLe, locale)}`, `read on ${formatDate(s.luLe, locale)}`)}${s.partiel ? t(', dernière lecture inachevée', ', last reading unfinished') : ''}`
                    : ` · ${t('pas encore lu', 'not read yet')}`}
                </span>
              </span>
              {s.luLe && (
                <>
                  <button type="button" className="text-xs text-brand-700 hover:underline" data-testid="segment-shopify-cibler" onClick={() => ajouter(s.segmentId)}>
                    {t('Cibler', 'Target')}
                  </button>
                  <button
                    type="button" className="text-xs text-ink-600 hover:underline" data-testid="segment-shopify-copier"
                    onClick={() => { setCopiee(null); setCopie({ segment: s, nom: s.nom.slice(0, ETIQUETTE_MAX), enCours: false, erreur: null }); }}
                  >
                    {t('Copier en étiquette Messaging Me', 'Copy as a Messaging Me tag')}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {copie && (
        <div className="flex flex-col gap-1 rounded-controle border border-ink-200 p-2" data-testid="segment-shopify-copie">
          <p className="text-xs text-ink-700">
            {t(
              `Poser maintenant une étiquette Messaging Me sur les fiches du segment Shopify « ${copie.segment.nom} ». Une copie à cet instant : elle ne suivra pas Shopify ensuite, et elle ne donne aucun consentement.`,
              `Add now a Messaging Me tag to the records of the Shopify segment “${copie.segment.nom}”. A copy at this moment: it will not follow Shopify afterwards, and it gives no consent.`,
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={copie.nom} onChange={(e) => setCopie({ ...copie, nom: e.target.value })} maxLength={ETIQUETTE_MAX}
              className={`${inputClsAuto} w-48`} data-testid="segment-shopify-copie-nom" aria-label={t('Nom de l’étiquette Messaging Me', 'Messaging Me tag name')}
            />
            <button
              type="button" disabled={!nomValide || copie.enCours} onClick={() => void copier()}
              className="rounded-controle bg-brand-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50" data-testid="segment-shopify-copie-valider"
            >
              {t('Copier', 'Copy')}
            </button>
            <button type="button" className="text-xs text-ink-500 hover:underline" onClick={() => setCopie(null)} data-testid="segment-shopify-copie-annuler">
              {t('Annuler', 'Cancel')}
            </button>
          </div>
          {copie.erreur && <p className="text-xs text-danger" data-testid="segment-shopify-copie-erreur">{copie.erreur}</p>}
        </div>
      )}
      {copiee && <p className="text-xs text-ink-700" data-testid="segment-shopify-copiee">{copiee}</p>}
    </div>
  );
}

/** Le critère de segment Shopify posé, ou `undefined` (absent ou illisible). */
function segmentsDe(v: unknown): SegmentsShopifyVises | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const e = v as Partial<SegmentsShopifyVises>;
  return Array.isArray(e.segments) && e.segments.length > 0 && e.segments.every((x) => typeof x === 'string')
    ? { segments: e.segments, mode: e.mode === 'une' ? 'une' : 'toutes' } : undefined;
}
