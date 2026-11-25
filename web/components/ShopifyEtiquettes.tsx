'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useT } from '@/lib/i18n';
import { formatDate } from '@/lib/day';
import { Bouton } from '@/components/Bouton';
import { Toggle } from '@/components/Toggle';
import { routeInconnue } from '@/lib/canaux-services';
import {
  lireSynchroEtiquettesShopify, reglerEtiquettesShopify, synchroniserEtiquettesShopify, type GesteEtiquettesShopify,
} from '@/lib/api-shopify';
import type { SynchroEtiquettesVue } from '@/lib/partage/segments';

/** Une synchronisation qui tourne : la carte la relit à ce rythme, jusqu'à sa fin. */
const RELECTURE_MS = 10_000;

/**
 * LA SYNCHRONISATION DES ÉTIQUETTES SHOPIFY (segments Shopify enrichis, lot 6b), dans la carte Shopify : le réglage
 * « Synchroniser les étiquettes » (éteint par défaut ; l'allumer lance aussitôt une lecture, puis une relecture chaque jour)
 * et le bouton « maintenant ». Les mêmes fonctions que `sync_shopify_customer_tags` (`src/shopify/etiquettes.ts`). Les
 * étiquettes lues se ciblent dans le volet Shopify des filtres, à part des étiquettes Messaging Me.
 *
 * 🔴 UNE API PLUS ANCIENNE (404 du routeur) : rien n'est montré, l'interrupteur appellerait une route qui n'existe pas. Une
 * lecture en panne garde ce qui était affiché ; la relecture continue tant que la synchronisation tourne.
 */
export function ShopifyEtiquettes({ tenantId, onMessage }: {
  tenantId: string;
  onMessage: (m: { genre: 'ok' | 'erreur'; texte: string }) => void;
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

  useEffect(() => { void relire(); }, [relire]);
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

  const nombre = (n: number, fr: readonly [string, string], en: readonly [string, string]): string =>
    t(`${n} ${n > 1 ? fr[1] : fr[0]}`, `${n} ${n === 1 ? en[0] : en[1]}`);
  const c = v.comptes;

  return (
    <div className="space-y-1" data-testid="integration-shopify-etiquettes">
      <div className="flex flex-wrap items-center gap-3">
        <Toggle
          checked={v.allumee} disabled={enCours} libelle={t('Synchroniser les étiquettes', 'Sync the tags')} testid="integration-shopify-etiquettes-interrupteur"
          onChange={() => void geste(
            () => reglerEtiquettesShopify(tenantId, !v.allumee),
            (lancee) => {
              if (v.allumee) return t('Synchronisation des étiquettes éteinte : celles déjà lues restent.', 'Tags sync turned off: the tags already read stay.');
              return lancee
                ? t('Synchronisation des étiquettes allumée : la première lecture tourne en arrière-plan.', 'Tags sync turned on: the first reading runs in the background.')
                : t('Synchronisation des étiquettes allumée : une lecture tourne déjà, elle continue.', 'Tags sync turned on: a reading is already running, it carries on.');
            },
          )}
        />
        <span className="text-ink-900">
          {t(
            'Synchroniser les étiquettes de vos clients Shopify, pour filtrer vos contacts. Elles restent à part de vos étiquettes Messaging Me.',
            'Sync the tags of your Shopify customers, to filter your contacts. They stay separate from your Messaging Me tags.',
          )}
        </span>
        {v.allumee && !v.enCours && (
          <Bouton
            type="button" taille="petite" variante="secondaire" disabled={enCours} data-testid="integration-shopify-etiquettes-maintenant"
            onClick={() => void geste(
              () => synchroniserEtiquettesShopify(tenantId),
              (lancee) => (lancee
                ? t('Synchronisation lancée : elle tourne en arrière-plan.', 'Sync started: it runs in the background.')
                : t('Une synchronisation tourne déjà : elle continue.', 'A sync is already running: it carries on.')),
            )}
          >
            {t('Synchroniser maintenant', 'Sync now')}
          </Bouton>
        )}
      </div>
      {v.enCours && (
        <p className="text-ink-500" data-testid="integration-shopify-etiquettes-en-cours">
          {t('Synchronisation en cours : ', 'Sync running: ')}
          {nombre(c.clientsLus, ['client lu', 'clients lus'], ['customer read', 'customers read'])}
          {c.trouvesParTelephone > 0 && `, ${nombre(c.trouvesParTelephone, ['fiche reliée par son numéro', 'fiches reliées par leur numéro'], ['record linked by its number', 'records linked by their number'])}`}.
        </p>
      )}
      {!v.enCours && v.synchroLe && (
        <p className="text-ink-500" data-testid="integration-shopify-etiquettes-etat">
          {t(`Dernière synchronisation le ${formatDate(v.synchroLe, locale)} : `, `Last sync on ${formatDate(v.synchroLe, locale)}: `)}
          {nombre(c.clientsLus, ['client lu', 'clients lus'], ['customer read', 'customers read'])}, {nombre(c.fichesEtiquetees, ['fiche porte au moins une étiquette', 'fiches portent au moins une étiquette'], ['record carries at least one tag', 'records carry at least one tag'])}
          {c.sansFiche > 0 && `, ${nombre(c.sansFiche, ['client sans fiche, oublié', 'clients sans fiche, oubliés'], ['customer without a record, forgotten', 'customers without a record, forgotten'])}`}.
          {v.allumee ? ` ${t('Relue chaque jour.', 'Read again every day.')}` : ` ${t('Éteinte : plus de relecture.', 'Off: no more reading.')}`}
        </p>
      )}
      {v.refus && (
        <p className="text-danger" data-testid="integration-shopify-etiquettes-refus">
          {t(`La dernière synchronisation a échoué : ${v.refus.message}`, 'The last sync failed. Turn it off and on again, or sync now, once the cause is fixed.')}
        </p>
      )}
    </div>
  );
}
