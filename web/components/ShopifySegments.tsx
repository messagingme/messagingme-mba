'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useT } from '@/lib/i18n';
import { formatDate } from '@/lib/day';
import { Bouton } from '@/components/Bouton';
import { routeInconnue } from '@/lib/canaux-services';
import { lireSegmentsShopifyCarte, suivreSegmentsShopify } from '@/lib/api-shopify';
import { BORNES_SEGMENTS, type SegmentsShopifyLusVue } from '@/lib/partage/segments';

/** Une synchronisation qui tourne : la carte la relit à ce rythme, jusqu'à sa fin. */
const RELECTURE_MS = 10_000;

/**
 * LES SEGMENTS SHOPIFY SUIVIS (segments Shopify enrichis, lot 6c), dans la carte Shopify : les segments que la
 * synchronisation des étiquettes a listés dans la boutique, et le choix de ceux dont elle lit les membres (20 au plus).
 * Enregistrer le choix lance une synchronisation qui les lit ; un segment décoché perd ses membres. La MÊME fonction que le
 * paramètre `segments` de `sync_shopify_customer_tags` (`src/shopify/etiquettes.ts`). Ils se ciblent dans le volet Shopify
 * des filtres.
 *
 * Rien tant que la synchronisation est éteinte (c'est elle qui les lit) ou que l'API est plus ancienne (404 du routeur).
 */
export function ShopifySegments({ tenantId, onMessage }: {
  tenantId: string;
  onMessage: (m: { genre: 'ok' | 'erreur'; texte: string }) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [vue, setVue] = useState<SegmentsShopifyLusVue | null | 'absente'>(null);
  const [choix, setChoix] = useState<Set<string> | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [tour, setTour] = useState(0);

  const relire = useCallback(() => lireSegmentsShopifyCarte(tenantId)
    .then((v) => { if (v !== null) setVue(v); })
    .catch((e: unknown) => { if (routeInconnue(e)) setVue('absente'); })
    .finally(() => setTour((n) => n + 1)), [tenantId]);

  useEffect(() => { void relire(); }, [relire]);
  const v = vue !== null && vue !== 'absente' ? vue : null;
  useEffect(() => {
    if (!v?.synchro.enCours) return undefined;
    const minuterie = setTimeout(() => { void relire(); }, RELECTURE_MS);
    return () => clearTimeout(minuterie);
  }, [v?.synchro.enCours, tour, relire]);

  if (v === null || !v.synchro.allumee) return null;

  const listes = v.segments.filter((s) => !s.absent);
  const suivisLus = new Set(listes.filter((s) => s.suivi).map((s) => s.segmentId));
  const coches = choix ?? suivisLus;
  const change = coches.size !== suivisLus.size || [...coches].some((id) => !suivisLus.has(id));
  const basculer = (id: string) => {
    const suivant = new Set(coches);
    if (suivant.has(id)) suivant.delete(id);
    else if (suivant.size < BORNES_SEGMENTS.segmentsShopifyMax) suivant.add(id);
    setChoix(suivant);
  };

  const enregistrer = async (): Promise<void> => {
    setEnCours(true);
    try {
      const { lancee, vue: rendue } = await suivreSegmentsShopify(tenantId, [...coches]);
      setChoix(null);
      onMessage({
        genre: 'ok',
        texte: coches.size === 0
          ? t('Plus aucun segment suivi.', 'No segment followed any more.')
          : lancee
            ? t('Segments suivis enregistrés : la lecture de leurs membres tourne en arrière-plan.', 'Followed segments saved: reading their members runs in the background.')
            : rendue?.enCours
              ? t('Segments suivis enregistrés : une synchronisation tourne déjà, elle les lit.', 'Followed segments saved: a sync is already running, it reads them.')
              : t('Segments suivis enregistrés : ils seront lus à la prochaine synchronisation.', 'Followed segments saved: they will be read at the next sync.'),
      });
    } catch (e: unknown) {
      onMessage({ genre: 'erreur', texte: e instanceof Error ? e.message : t('Réglage impossible', 'Unable to save') });
    } finally {
      setEnCours(false);
      await relire();
    }
  };

  const fiches = (n: number): string => (n === 1 ? t('1 fiche', '1 record') : t(`${n} fiches`, `${n} records`));

  return (
    <div className="space-y-1" data-testid="integration-shopify-segments">
      <p className="text-ink-900">
        {t(
          `Segments Shopify à suivre, ${BORNES_SEGMENTS.segmentsShopifyMax} au plus : la synchronisation lit leurs membres, pour filtrer vos contacts.`,
          `Shopify segments to follow, ${BORNES_SEGMENTS.segmentsShopifyMax} at most: the sync reads their members, to filter your contacts.`,
        )}
      </p>
      {listes.length === 0 ? (
        <p className="text-ink-500" data-testid="integration-shopify-segments-aucun">
          {t('Aucun segment lu dans la boutique : la prochaine synchronisation les liste.', 'No segment read in the store yet: the next sync lists them.')}
        </p>
      ) : (
        <ul className="space-y-0.5" data-testid="integration-shopify-segments-liste">
          {listes.map((s) => (
            <li key={s.segmentId}>
              <label className="flex items-start gap-2 text-ink-700">
                <input
                  type="checkbox" className="mt-0.5" checked={coches.has(s.segmentId)} disabled={enCours}
                  onChange={() => basculer(s.segmentId)} data-testid="integration-shopify-segment"
                />
                <span>
                  {s.nom}
                  {s.suivi && (
                    <span className="text-ink-400">
                      {s.luLe
                        ? ` · ${fiches(s.fiches)} · ${t(`lu le ${formatDate(s.luLe, locale)}`, `read on ${formatDate(s.luLe, locale)}`)}${s.partiel ? t(', dernière lecture inachevée', ', last reading unfinished') : ''}`
                        : ` · ${t('pas encore lu', 'not read yet')}`}
                    </span>
                  )}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {change && (
        <Bouton type="button" taille="petite" variante="secondaire" disabled={enCours} data-testid="integration-shopify-segments-enregistrer" onClick={() => void enregistrer()}>
          {t('Enregistrer les segments suivis', 'Save the followed segments')}
        </Bouton>
      )}
    </div>
  );
}
