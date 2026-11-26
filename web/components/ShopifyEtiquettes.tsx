'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useT } from '@/lib/i18n';
import { formatDate } from '@/lib/day';
import { Bouton } from '@/components/Bouton';
import { LigneShopify } from '@/components/LigneShopify';
import { routeInconnue } from '@/lib/canaux-services';
import {
  lireSynchroEtiquettesShopify, reglerEtiquettesShopify, synchroniserEtiquettesShopify, type GesteEtiquettesShopify,
} from '@/lib/api-shopify';
import type { SynchroEtiquettesVue } from '@/lib/partage/segments';

/** Une synchronisation qui tourne : la carte la relit à ce rythme, jusqu'à sa fin. */
const RELECTURE_MS = 10_000;

/**
 * LA SYNCHRONISATION DES ÉTIQUETTES SHOPIFY (segments Shopify enrichis, lot 6b), dans la carte Shopify : une ligne,
 * « Synchroniser maintenant » en face, et la date de la dernière synchronisation dessous (Julien, 2026-11-26 : plus
 * d'interrupteur). Le bouton ALLUME la synchronisation si elle ne l'est pas (sa relecture chaque jour suit), sinon il la
 * relance. Les mêmes fonctions que `sync_shopify_customer_tags` (`src/shopify/etiquettes.ts`), qui seul l'éteint encore.
 * Les étiquettes lues se ciblent dans le volet Shopify des filtres, à part des étiquettes Messaging Me.
 *
 * 🔴 UNE API PLUS ANCIENNE (404 du routeur) : rien n'est montré, le bouton appellerait une route qui n'existe pas. Une
 * lecture en panne garde ce qui était affiché ; la relecture continue tant que la synchronisation tourne.
 */
export function ShopifyEtiquettes({ tenantId, onMessage, relire: aRelire = 0, onSynchro }: {
  tenantId: string;
  onMessage: (m: { genre: 'ok' | 'erreur'; texte: string }) => void;
  /** Change quand l'autre partie de la carte a lancé la synchronisation commune : relire, puis la suivre jusqu'à sa fin. */
  relire?: number;
  /** Ce geste a lancé (ou trouvé en cours) la synchronisation commune : la carte fait relire l'autre partie. */
  onSynchro?: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [vue, setVue] = useState<SynchroEtiquettesVue | null | 'absente'>(null);
  const [enCours, setEnCours] = useState(false);
  /** Un tour de relecture de plus : relancé à chaque lecture, même en panne, tant que la synchronisation tourne. */
  const [tour, setTour] = useState(0);

  const relire = useCallback(() => lireSynchroEtiquettesShopify(tenantId)
    .then((v) => { if (v !== null) setVue(v); })
    .catch((e: unknown) => { if (routeInconnue(e)) setVue('absente'); })
    .finally(() => setTour((n) => n + 1)), [tenantId]);

  useEffect(() => { void relire(); }, [relire, aRelire]);
  const v = vue !== null && vue !== 'absente' ? vue : null;
  useEffect(() => {
    if (!v?.enCours) return undefined;
    const minuterie = setTimeout(() => { void relire(); }, RELECTURE_MS);
    return () => clearTimeout(minuterie);
  }, [v?.enCours, tour, relire]);

  if (vue === 'absente' || v === null) return null;

  /**
   * Un geste de la carte : la vue rendue par le serveur et la phrase qui dit si CE geste a lancé une lecture (une
   * synchronisation qui tournait déjà continue, rien n'est « lancé »), ou la phrase du refus.
   */
  const geste = async (faire: () => Promise<GesteEtiquettesShopify>, reussi: (lancee: boolean) => string): Promise<void> => {
    setEnCours(true);
    try {
      const { vue: rendue, lancee } = await faire();
      if (lancee || rendue?.enCours) onSynchro?.();
      if (rendue !== null) setVue(rendue);
      else await relire();
      onMessage({ genre: 'ok', texte: reussi(lancee) });
    } catch (e: unknown) {
      onMessage({ genre: 'erreur', texte: e instanceof Error ? e.message : t('Réglage impossible', 'Unable to save') });
      await relire();
    } finally {
      setEnCours(false);
    }
  };

  const c = v.comptes;
  /** Allumée, « maintenant » la relance ; jamais allumée (ou éteinte par Claude Code), le même bouton l'allume. */
  const synchroniser = () => void geste(
    () => (v.allumee ? synchroniserEtiquettesShopify(tenantId) : reglerEtiquettesShopify(tenantId, true)),
    (lancee) => (lancee
      ? t('Synchronisation lancée : elle tourne en arrière-plan.', 'Sync started: it runs in the background.')
      : t('Une synchronisation tourne déjà : elle continue.', 'A sync is already running: it carries on.')),
  );

  return (
    <LigneShopify
      testid="integration-shopify-etiquettes"
      libelle={t('Synchroniser les étiquettes Shopify de vos clients', 'Sync the Shopify tags of your customers')}
      detail={(
        <>
          {v.enCours && (
            <p className="text-ink-500" data-testid="integration-shopify-etiquettes-en-cours">
              {t(`En cours : ${c.clientsLus} client${c.clientsLus > 1 ? 's' : ''} lu${c.clientsLus > 1 ? 's' : ''}.`, `Running: ${c.clientsLus} customer${c.clientsLus === 1 ? '' : 's'} read.`)}
            </p>
          )}
          {!v.enCours && v.synchroLe && (
            <p className="text-ink-500" data-testid="integration-shopify-etiquettes-etat">
              {t(`Dernière synchronisation le ${formatDate(v.synchroLe, locale)}`, `Last sync on ${formatDate(v.synchroLe, locale)}`)}
            </p>
          )}
          {v.refus && (
            <p className="text-danger" data-testid="integration-shopify-etiquettes-refus">
              {t(`La dernière synchronisation a échoué : ${v.refus.message}`, 'The last sync failed. Sync again once the cause is fixed.')}
            </p>
          )}
        </>
      )}
      bouton={(
        <Bouton
          type="button" taille="petite" variante="secondaire" className="w-full" disabled={enCours || v.enCours}
          data-testid="integration-shopify-etiquettes-maintenant" onClick={synchroniser}
        >
          {t('Synchroniser maintenant', 'Sync now')}
        </Bouton>
      )}
    />
  );
}
