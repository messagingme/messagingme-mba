'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useT } from '@/lib/i18n';
import type { ContactFieldFilter } from '@/lib/api';
import { inputClsAuto } from '@/lib/ui';
import { formatDate } from '@/lib/day';
import {
  BORNES_SEGMENTS, CLES_SEGMENT, filtreSegment, valeurSegment, type CollectionsLuesVue, type CollectionsVisees,
} from '@/lib/partage/segments';
import { chercherCollections } from '@/lib/segments';

/** Tant qu'une lecture est en cours, la liste se relit toutes les 5 s, deux minutes au plus. */
const RELECTURE_MS = 5_000;
const RELECTURES_MAX = 24;
/** Les collections que la route rend au plus : une liste plus courte, sans recherche, est COMPLÈTE. */
const LISTEES = 50;

/**
 * LE CRITÈRE DE COLLECTION DU VOLET SHOPIFY (segments Shopify enrichis, lot 6a) : « a acheté dans la collection », au
 * moins un produit de CHACUNE des collections choisies, sur les N derniers jours au choix. Les collections se choisissent
 * parmi celles LUES chez Shopify sur les produits déjà commandés, telles qu'elles sont dans la boutique à la dernière
 * lecture (la phrase le dit, avec sa date) ; les cartes cadeaux n'y sont pas.
 *
 * Ouvrir ce volet demande une lecture quand un produit commandé n'a jamais été lu ou date de plus de 24 h : la liste dit
 * « lecture en cours » et se relit seule. Sans le droit `read_products` sur l'app de la boutique, la phrase dit comment
 * l'ajouter. 🔴 Une collection posée que la liste COMPLÈTE ne connaît plus est signalée : le serveur refuserait le critère.
 * Ce composant n'écrit que sa clé et rend les autres critères tels quels.
 */
export function FiltresCollectionsShopify({ tenantId, segments, onChange }: {
  tenantId: string;
  segments: ContactFieldFilter[];
  onChange: (segments: ContactFieldFilter[]) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [recherche, setRecherche] = useState('');
  const [vue, setVue] = useState<CollectionsLuesVue | null | 'chargement'>('chargement');
  const [relectures, setRelectures] = useState(0);
  // Les titres des collections vues, pour dire autre chose qu'un identifiant sur une puce.
  const noms = useRef(new Map<string, string>());

  useEffect(() => {
    let actif = true;
    const minuterie = setTimeout(() => {
      void chercherCollections(tenantId, recherche).then((r) => {
        if (!actif) return;
        for (const c of r?.collections ?? []) if (c.titre) noms.current.set(c.collectionId, c.titre);
        setVue(r);
      });
    }, 250);
    return () => { actif = false; clearTimeout(minuterie); };
  }, [tenantId, recherche, relectures]);

  const enCours = vue !== null && vue !== 'chargement' && vue.lecture.enCours;
  useEffect(() => {
    if (!enCours || relectures >= RELECTURES_MAX) return;
    const minuterie = setTimeout(() => setRelectures((n) => n + 1), RELECTURE_MS);
    return () => clearTimeout(minuterie);
  }, [enCours, relectures]);

  const posee = collectionsDe(valeurSegment(segments, CLES_SEGMENT.collection));
  /** Remplace (ou retire) le critère, sans toucher aux autres. */
  const ecrire = (c: CollectionsVisees | undefined) =>
    onChange([...segments.filter((s) => s.key !== CLES_SEGMENT.collection), ...(c === undefined ? [] : [filtreSegment(CLES_SEGMENT.collection, c)])]);
  const ajouter = (id: string) => {
    const ids = posee?.collections ?? [];
    if (ids.includes(id) || ids.length >= BORNES_SEGMENTS.collectionsMax) return;
    ecrire({ ...(posee ?? {}), collections: [...ids, id] });
  };
  const retirer = (id: string) => {
    if (!posee) return;
    const ids = posee.collections.filter((x) => x !== id);
    ecrire(ids.length === 0 ? undefined : { ...posee, collections: ids });
  };
  const nom = (id: string): string => noms.current.get(id) ?? t(`Collection ${id}`, `Collection ${id}`);
  // Une liste sans recherche et plus courte que le plafond est complète : une collection posée qu'elle n'a pas n'est plus connue.
  const complete = vue !== null && vue !== 'chargement' && recherche.trim() === '' && vue.collections.length < LISTEES;
  const inconnues = complete && posee ? posee.collections.filter((id) => !vue.collections.some((c) => c.collectionId === id)) : [];
  const lecture = vue !== null && vue !== 'chargement' ? vue.lecture : null;

  return (
    <div className="flex flex-col gap-2 border-t border-ink-100 pt-2" data-testid="filtres-collections">
      {posee && (
        <LigneCollections
          posee={posee} nomDe={nom} onRetirer={retirer}
          onJours={(jours) => ecrire({ collections: posee.collections, ...(jours !== undefined ? { jours } : {}) })}
        />
      )}
      {inconnues.length > 0 && (
        <p className="text-xs text-danger" data-testid="filtre-collection-inconnue">
          {inconnues.length === 1
            ? t(
              `${nom(inconnues[0]!)} n’est plus parmi les collections lues : retirez-la, le critère serait refusé.`,
              `${nom(inconnues[0]!)} is no longer among the collections read: remove it, the criterion would be refused.`,
            )
            : t(
              `${inconnues.map(nom).join(', ')} ne sont plus parmi les collections lues : retirez-les, le critère serait refusé.`,
              `${inconnues.map(nom).join(', ')} are no longer among the collections read: remove them, the criterion would be refused.`,
            )}
        </p>
      )}
      <div className="flex flex-col gap-1">
        <input
          type="search" value={recherche} onChange={(e) => setRecherche(e.target.value)} maxLength={80}
          placeholder={t('Chercher une collection des produits commandés', 'Search a collection of the products ordered')}
          className={`${inputClsAuto} w-full`} data-testid="filtre-collections-recherche"
        />
        {vue === null && (
          <p className="text-xs text-danger" data-testid="filtre-collections-indisponible">
            {t('La liste des collections n’a pas pu être lue.', 'The list of collections could not be read.')}
          </p>
        )}
        {lecture?.refus?.code === 'sans_droit' && (
          <p className="text-xs text-danger" data-testid="filtre-collections-sans-droit">
            {t(
              'Pour lire les collections, l’app Messaging Me de votre boutique doit avoir le droit read_products : ajoutez-le à ses portées sur le tableau de bord développeur de Shopify, publiez sa nouvelle version, puis réinstallez-la sur la boutique pour l’accepter.',
              'To read the collections, the Messaging Me app of your store needs the read_products scope: add it to its scopes on the Shopify developer dashboard, release its new version, then install it again on the store to accept it.',
            )}
          </p>
        )}
        {lecture?.refus && lecture.refus.code !== 'sans_droit' && (
          <p className="text-xs text-danger" data-testid="filtre-collections-refus">
            {t(`La dernière lecture des collections a échoué : ${lecture.refus.message}`, 'The last reading of the collections failed. It starts again the next time you open this section.')}
          </p>
        )}
        {lecture?.enCours && (
          <p className="text-xs text-ink-500" data-testid="filtre-collections-en-cours">
            {t('Lecture des collections de votre boutique en cours : la liste se complète dans un instant.', 'Reading the collections of your store: the list fills in shortly.')}
          </p>
        )}
        {lecture && lecture.lueLe === null && !lecture.enCours && lecture.refus === null && (
          <p className="text-xs text-ink-500" data-testid="filtre-collections-jamais-lues">
            {t('Aucune collection lue : elles se lisent dès qu’un produit a été commandé.', 'No collection read yet: they are read once a product has been ordered.')}
          </p>
        )}
        {vue !== null && vue !== 'chargement' && vue.collections.length === 0 && lecture?.lueLe && (
          <p className="text-xs text-ink-500" data-testid="filtre-collections-aucune">
            {t('Aucune collection ne correspond parmi les produits commandés. Les cartes cadeaux ne se ciblent pas.', 'No collection matches among the products ordered. Gift cards cannot be targeted.')}
          </p>
        )}
        {vue !== null && vue !== 'chargement' && vue.collections.length > 0 && (
          <ul className="divide-y divide-ink-100 rounded-controle border border-ink-100 text-sm" data-testid="filtre-collections-resultats">
            {vue.collections.map((c) => (
              <li key={c.collectionId} className="flex flex-wrap items-center gap-2 px-2 py-1.5" data-testid="filtre-collections-resultat">
                <span className="min-w-0 flex-1 text-ink-700">
                  {c.titre ?? t(`Collection ${c.collectionId}`, `Collection ${c.collectionId}`)}
                  <span className="text-xs text-ink-400"> · {c.produits === 1 ? t('1 produit commandé', '1 product ordered') : t(`${c.produits} produits commandés`, `${c.produits} products ordered`)}</span>
                </span>
                <button type="button" className="text-xs text-brand-700 hover:underline" data-testid="collection-achete" onClick={() => ajouter(c.collectionId)}>
                  {t('A acheté dans la collection', 'Bought in the collection')}
                </button>
              </li>
            ))}
          </ul>
        )}
        {lecture?.lueLe && (
          <p className="text-xs text-ink-500" data-testid="filtre-collections-lues-le">
            {t(
              `Collections telles qu’elles sont dans votre boutique, lues le ${formatDate(lecture.lueLe, locale)} : un produit compte s’il y est à cette lecture, pas au jour de sa commande.`,
              `Collections as they are in your store, read on ${formatDate(lecture.lueLe, locale)}: a product counts if it is in them at that reading, not on the day it was ordered.`,
            )}
            {lecture.incompletes && ` ${t('Certains produits sont dans plus de 50 collections : la liste n’est pas complète.', 'Some products are in more than 50 collections: the list is not complete.')}`}
          </p>
        )}
      </div>
    </div>
  );
}

/** Le critère posé : ses puces (chacune des collections) et sa fenêtre en jours. */
function LigneCollections({ posee, nomDe, onRetirer, onJours }: {
  posee: CollectionsVisees; nomDe: (id: string) => string; onRetirer: (id: string) => void; onJours: (jours: number | undefined) => void;
}) {
  const t = useT();
  const [saisie, setSaisie] = useState(posee.jours === undefined ? '' : String(posee.jours));
  useEffect(() => { setSaisie(posee.jours === undefined ? '' : String(posee.jours)); }, [posee.jours]);
  const lecture = lireJours(saisie);
  return (
    <div className="flex flex-col gap-1" data-testid="filtre-collection">
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-700">
        <span className="min-w-40">{t('A acheté dans la collection (chacune)', 'Bought in the collection (each one)')}</span>
        {posee.collections.map((id) => (
          <span key={id} className="inline-flex items-center gap-1 rounded-controle bg-ink-100 px-2 py-0.5 text-xs" data-testid="filtre-collection-puce">
            {nomDe(id)}
            <button type="button" aria-label={t('Retirer', 'Remove')} className="text-ink-500 hover:text-ink-900" data-testid="filtre-collection-retirer" onClick={() => onRetirer(id)}>×</button>
          </span>
        ))}
        <span>{t('sur les', 'over the last')}</span>
        <input
          type="number" inputMode="numeric" min={1} max={BORNES_SEGMENTS.joursMax} value={saisie} className={`${inputClsAuto} w-20`}
          data-testid="filtre-collection-jours"
          onChange={(e) => {
            setSaisie(e.target.value);
            const l = lireJours(e.target.value);
            if (l !== 'erreur') onJours(l);
          }}
        />
        <span>{t('derniers jours (vide : depuis le début du suivi)', 'days (empty: since tracking started)')}</span>
      </div>
      {lecture === 'erreur' && (
        <p className="text-xs text-danger" data-testid="filtre-collection-erreur">
          {t(`Un nombre entier de jours, de 1 à ${BORNES_SEGMENTS.joursMax}.`, `A whole number of days, from 1 to ${BORNES_SEGMENTS.joursMax}.`)}
        </p>
      )}
    </div>
  );
}

/** Le critère de collection posé, ou `undefined` (absent ou illisible). */
function collectionsDe(v: unknown): CollectionsVisees | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const c = v as Partial<CollectionsVisees>;
  return Array.isArray(c.collections) && c.collections.length > 0 && c.collections.every((x) => typeof x === 'string')
    ? c as CollectionsVisees : undefined;
}

/** Une fenêtre en jours saisie : vide, un entier valide, ou une erreur. */
function lireJours(s: string): number | undefined | 'erreur' {
  if (s.trim() === '') return undefined;
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 && n <= BORNES_SEGMENTS.joursMax ? n : 'erreur';
}
