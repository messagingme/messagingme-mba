'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useLocale, useT } from '@/lib/i18n';
import { bulkContactAction, type ContactFieldFilter } from '@/lib/api';
import { inputClsAuto } from '@/lib/ui';
import { formatDate } from '@/lib/day';
import {
  BORNES_SEGMENTS, CLES_SEGMENT, filtreSegment, valeurSegment, type EtiquettesShopifyLuesVue, type EtiquettesShopifyVisees,
} from '@/lib/partage/segments';
import { chercherEtiquettesShopify } from '@/lib/segments';

/** Tant qu'une synchronisation tourne, la liste se relit toutes les 5 s, deux minutes au plus. */
const RELECTURE_MS = 5_000;
const RELECTURES_MAX = 24;
/** La borne d'une étiquette Messaging Me (`LONGUEUR_MAX_ETIQUETTE`, `src/crm/poser-etiquette.ts`), pour la copie. */
const ETIQUETTE_MAX = 64;

/**
 * LES ÉTIQUETTES SHOPIFY DU VOLET SHOPIFY (segments Shopify enrichis, lot 6b) : les étiquettes que le marchand a posées sur
 * ses clients DANS SHOPIFY, lues par la synchronisation qu'il allume sur la carte Shopify. Un bloc à part, marqué Shopify :
 * 🔴 JAMAIS les étiquettes Messaging Me du bloc « Étiquettes » du panneau ; un même mot des deux côtés fait deux critères.
 *
 * Le critère : TOUTES les étiquettes choisies, ou l'une d'elles, comparées sans la casse, telles que la dernière
 * synchronisation les a lues (la phrase le dit, avec sa date). Sans synchronisation aboutie, le serveur le refuse : la
 * phrase dit où l'allumer, jamais « personne ».
 *
 * Le seul pont vers les étiquettes Messaging Me est la COPIE EXPLICITE : « Copier en étiquette Messaging Me » pose, maintenant,
 * l'étiquette nommée par le marchand sur les fiches qui portent cette étiquette Shopify (l'action en masse du mini-CRM, sans
 * suivi ensuite, sans consentement). Ce composant n'écrit que sa clé et rend les autres critères tels quels.
 */
export function FiltresEtiquettesShopify({ tenantId, segments, onChange }: {
  tenantId: string;
  segments: ContactFieldFilter[];
  onChange: (segments: ContactFieldFilter[]) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [recherche, setRecherche] = useState('');
  const [vue, setVue] = useState<EtiquettesShopifyLuesVue | null | 'chargement'>('chargement');
  const [relectures, setRelectures] = useState(0);
  const [copie, setCopie] = useState<{ etiquette: string; nom: string; enCours: boolean; erreur: string | null } | null>(null);
  const [copiee, setCopiee] = useState<string | null>(null);

  useEffect(() => {
    let actif = true;
    const minuterie = setTimeout(() => {
      void chercherEtiquettesShopify(tenantId, recherche).then((r) => { if (actif) setVue(r); });
    }, 250);
    return () => { actif = false; clearTimeout(minuterie); };
  }, [tenantId, recherche, relectures]);

  const synchro = vue !== null && vue !== 'chargement' ? vue.synchro : null;
  useEffect(() => {
    if (!synchro?.enCours || relectures >= RELECTURES_MAX) return;
    const minuterie = setTimeout(() => setRelectures((n) => n + 1), RELECTURE_MS);
    return () => clearTimeout(minuterie);
  }, [synchro?.enCours, relectures]);

  const posee = etiquettesDe(valeurSegment(segments, CLES_SEGMENT.etiquetteShopify));
  /** Remplace (ou retire) le critère, sans toucher aux autres. */
  const ecrire = (e: EtiquettesShopifyVisees | undefined) =>
    onChange([...segments.filter((s) => s.key !== CLES_SEGMENT.etiquetteShopify), ...(e === undefined ? [] : [filtreSegment(CLES_SEGMENT.etiquetteShopify, e)])]);
  const ajouter = (etiquette: string) => {
    const liste = posee?.etiquettes ?? [];
    if (liste.some((x) => x.toLowerCase() === etiquette.toLowerCase()) || liste.length >= BORNES_SEGMENTS.etiquettesShopifyMax) return;
    ecrire({ etiquettes: [...liste, etiquette], mode: posee?.mode ?? 'toutes' });
  };
  const retirer = (etiquette: string) => {
    if (!posee) return;
    const liste = posee.etiquettes.filter((x) => x !== etiquette);
    ecrire(liste.length === 0 ? undefined : { ...posee, etiquettes: liste });
  };

  /** La copie explicite : l'étiquette Messaging Me nommée, posée maintenant sur les fiches de cette étiquette Shopify. */
  const copier = async (): Promise<void> => {
    if (!copie) return;
    const nom = copie.nom.trim();
    if (nom === '' || nom.length > ETIQUETTE_MAX) return;
    setCopie({ ...copie, enCours: true, erreur: null });
    try {
      const { affected } = await bulkContactAction(
        tenantId,
        { filters: { fieldFilters: [filtreSegment(CLES_SEGMENT.etiquetteShopify, { etiquettes: [copie.etiquette], mode: 'toutes' })] } },
        { type: 'add_tag', tags: [nom] },
      );
      setCopie(null);
      setCopiee(t(
        `Étiquette Messaging Me « ${nom} » posée sur ${affected} fiche${affected > 1 ? 's' : ''}. Elle ne suivra pas l’étiquette Shopify ensuite.`,
        `Messaging Me tag “${nom}” added to ${affected} record${affected === 1 ? '' : 's'}. It will not follow the Shopify tag afterwards.`,
      ));
    } catch (e: unknown) {
      setCopie({ ...copie, enCours: false, erreur: e instanceof Error ? e.message : t('Copie impossible', 'Unable to copy') });
    }
  };

  const nomValide = copie !== null && copie.nom.trim() !== '' && copie.nom.trim().length <= ETIQUETTE_MAX;

  return (
    <div className="flex flex-col gap-2 border-t border-ink-100 pt-2" data-testid="filtres-etiquettes-shopify">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-ink-700">{t('Étiquettes Shopify', 'Shopify tags')}</span>
        <span className="text-xs text-ink-500">
          {t(
            'Les étiquettes posées sur vos clients dans Shopify, distinctes de vos étiquettes Messaging Me.',
            'The tags put on your customers in Shopify, separate from your Messaging Me tags.',
          )}
        </span>
      </div>
      {posee && <LigneEtiquettes posee={posee} onRetirer={retirer} onMode={(mode) => ecrire({ ...posee, mode })} />}
      <input
        type="search" value={recherche} onChange={(e) => setRecherche(e.target.value)} maxLength={80}
        placeholder={t('Chercher une étiquette Shopify', 'Search a Shopify tag')}
        className={`${inputClsAuto} w-full`} data-testid="filtre-etiquettes-shopify-recherche"
      />
      {vue === null && (
        <p className="text-xs text-danger" data-testid="filtre-etiquettes-shopify-indisponible">
          {t('La liste des étiquettes Shopify n’a pas pu être lue.', 'The list of Shopify tags could not be read.')}
        </p>
      )}
      {synchro && synchro.synchroLe === null && !synchro.enCours && synchro.refus === null && (
        <p className="text-xs text-ink-500" data-testid="filtre-etiquettes-shopify-jamais">
          {t('Aucune étiquette lue : allumez « Synchroniser les étiquettes » sur la carte Shopify, dans ', 'No tag read yet: turn on “Sync the tags” on the Shopify card, in ')}
          <Link href="/integrations#integration-shopify" className="text-brand-600 hover:underline">{t('Tools > Intégrations', 'Tools > Integrations')}</Link>.
        </p>
      )}
      {synchro?.enCours && (
        <p className="text-xs text-ink-500" data-testid="filtre-etiquettes-shopify-en-cours">
          {t('Synchronisation des étiquettes de vos clients en cours : la liste se complète dans un instant.', 'Syncing the tags of your customers: the list fills in shortly.')}
        </p>
      )}
      {synchro?.refus && (
        <p className="text-xs text-danger" data-testid="filtre-etiquettes-shopify-refus">
          {t(`La dernière synchronisation des étiquettes a échoué : ${synchro.refus.message}`, 'The last sync of the tags failed. Start it again from the Shopify card.')}
        </p>
      )}
      {vue !== null && vue !== 'chargement' && vue.etiquettes.length === 0 && synchro?.synchroLe && (
        <p className="text-xs text-ink-500" data-testid="filtre-etiquettes-shopify-aucune">
          {t('Aucune étiquette Shopify ne correspond parmi vos clients reliés à une fiche.', 'No Shopify tag matches among your customers linked to a record.')}
        </p>
      )}
      {vue !== null && vue !== 'chargement' && vue.etiquettes.length > 0 && (
        <ul className="divide-y divide-ink-100 rounded-controle border border-ink-100 text-sm" data-testid="filtre-etiquettes-shopify-resultats">
          {vue.etiquettes.map((e) => (
            <li key={e.etiquette} className="flex flex-wrap items-center gap-2 px-2 py-1.5" data-testid="filtre-etiquettes-shopify-resultat">
              <span className="min-w-0 flex-1 text-ink-700">
                {e.etiquette}
                <span className="text-xs text-ink-400"> · {e.fiches === 1 ? t('1 fiche', '1 record') : t(`${e.fiches} fiches`, `${e.fiches} records`)}</span>
              </span>
              <button type="button" className="text-xs text-brand-700 hover:underline" data-testid="etiquette-shopify-cibler" onClick={() => ajouter(e.etiquette)}>
                {t('Cibler', 'Target')}
              </button>
              <button
                type="button" className="text-xs text-ink-600 hover:underline" data-testid="etiquette-shopify-copier"
                onClick={() => { setCopiee(null); setCopie({ etiquette: e.etiquette, nom: e.etiquette.slice(0, ETIQUETTE_MAX), enCours: false, erreur: null }); }}
              >
                {t('Copier en étiquette Messaging Me', 'Copy as a Messaging Me tag')}
              </button>
            </li>
          ))}
        </ul>
      )}
      {copie && (
        <div className="flex flex-col gap-1 rounded-controle border border-ink-200 p-2" data-testid="etiquette-shopify-copie">
          <p className="text-xs text-ink-700">
            {t(
              `Poser maintenant une étiquette Messaging Me sur les fiches qui portent l’étiquette Shopify « ${copie.etiquette} ». Une copie à cet instant : elle ne suivra pas Shopify ensuite, et elle ne donne aucun consentement.`,
              `Add now a Messaging Me tag to the records that carry the Shopify tag “${copie.etiquette}”. A copy at this moment: it will not follow Shopify afterwards, and it gives no consent.`,
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={copie.nom} onChange={(e) => setCopie({ ...copie, nom: e.target.value })} maxLength={ETIQUETTE_MAX}
              className={`${inputClsAuto} w-48`} data-testid="etiquette-shopify-copie-nom" aria-label={t('Nom de l’étiquette Messaging Me', 'Messaging Me tag name')}
            />
            <button
              type="button" disabled={!nomValide || copie.enCours} onClick={() => void copier()}
              className="rounded-controle bg-brand-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-50" data-testid="etiquette-shopify-copie-valider"
            >
              {t('Copier', 'Copy')}
            </button>
            <button type="button" className="text-xs text-ink-500 hover:underline" onClick={() => setCopie(null)} data-testid="etiquette-shopify-copie-annuler">
              {t('Annuler', 'Cancel')}
            </button>
          </div>
          {copie.erreur && <p className="text-xs text-danger" data-testid="etiquette-shopify-copie-erreur">{copie.erreur}</p>}
        </div>
      )}
      {copiee && <p className="text-xs text-ink-700" data-testid="etiquette-shopify-copiee">{copiee}</p>}
      {synchro?.synchroLe && (
        <p className="text-xs text-ink-500" data-testid="filtre-etiquettes-shopify-synchro-le">
          {t(
            `Étiquettes lues chez Shopify le ${formatDate(synchro.synchroLe, locale)} : une fiche compte si son client porte l’étiquette à cette lecture.`,
            `Tags read at Shopify on ${formatDate(synchro.synchroLe, locale)}: a record counts if its customer carries the tag at that reading.`,
          )}
        </p>
      )}
    </div>
  );
}

/** Le critère posé : ses puces et son mode (toutes, ou l'une d'elles). */
function LigneEtiquettes({ posee, onRetirer, onMode }: {
  posee: EtiquettesShopifyVisees; onRetirer: (etiquette: string) => void; onMode: (mode: 'toutes' | 'une') => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-ink-700" data-testid="filtre-etiquette-shopify">
      <span className="min-w-40">{t('A l’étiquette Shopify', 'Has the Shopify tag')}</span>
      {posee.etiquettes.map((e) => (
        <span key={e} className="inline-flex items-center gap-1 rounded-controle bg-ink-100 px-2 py-0.5 text-xs" data-testid="filtre-etiquette-shopify-puce">
          {e}
          <button type="button" aria-label={t('Retirer', 'Remove')} className="text-ink-500 hover:text-ink-900" data-testid="filtre-etiquette-shopify-retirer" onClick={() => onRetirer(e)}>×</button>
        </span>
      ))}
      {posee.etiquettes.length > 1 && (
        <select
          value={posee.mode} onChange={(e) => onMode(e.target.value === 'une' ? 'une' : 'toutes')}
          className={`${inputClsAuto} w-auto`} data-testid="filtre-etiquette-shopify-mode"
        >
          <option value="toutes">{t('toutes', 'all of them')}</option>
          <option value="une">{t('l’une d’elles', 'any of them')}</option>
        </select>
      )}
    </div>
  );
}

/** Le critère d'étiquette Shopify posé, ou `undefined` (absent ou illisible). */
function etiquettesDe(v: unknown): EtiquettesShopifyVisees | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const e = v as Partial<EtiquettesShopifyVisees>;
  return Array.isArray(e.etiquettes) && e.etiquettes.length > 0 && e.etiquettes.every((x) => typeof x === 'string')
    ? { etiquettes: e.etiquettes, mode: e.mode === 'une' ? 'une' : 'toutes' } : undefined;
}
