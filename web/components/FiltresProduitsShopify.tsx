'use client';

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import type { ContactFieldFilter } from '@/lib/api';
import { inputClsAuto } from '@/lib/ui';
import {
  BORNES_SEGMENTS, CLES_SEGMENT, filtreSegment, valeurSegment,
  type AchatsVises, type CleSegment, type ProduitVise, type ProduitVuVue, type Reassort,
} from '@/lib/partage/segments';
import { chercherProduitsVus, lirePlageSaisie, saisieDePlage, type SaisiePlage } from '@/lib/segments';

/**
 * LES CRITÈRES PRODUIT DU VOLET SHOPIFY (segments Shopify enrichis, lot 3) : « a acheté » (TOUS ces produits, sur les N
 * derniers jours au choix), « n'a pas acheté » (AUCUN, jamais seul : il viserait presque tout l'espace) et le réassort
 * (le dernier achat d'UN produit, il y a au moins et au plus N jours). Les produits se choisissent parmi ceux DÉJÀ VUS
 * dans les commandes de l'espace, jamais le catalogue ; les cartes cadeaux n'y sont pas (décision de Julien du
 * 2026-11-23). Ce composant n'écrit que ses trois clés et rend les autres critères tels quels.
 */
export function FiltresProduitsShopify({ tenantId, segments, onChange }: {
  tenantId: string;
  segments: ContactFieldFilter[];
  onChange: (segments: ContactFieldFilter[]) => void;
}) {
  const t = useT();
  const [recherche, setRecherche] = useState('');
  const [resultats, setResultats] = useState<ProduitVuVue[] | null | 'chargement'>('chargement');
  const [cible, setCible] = useState<'produit' | 'sku'>('produit');
  // Les noms des produits vus, pour dire autre chose qu'un identifiant sur une puce.
  const noms = useRef(new Map<string, string>());

  useEffect(() => {
    let actif = true;
    const minuterie = setTimeout(() => {
      void chercherProduitsVus(tenantId, recherche).then((r) => {
        if (!actif) return;
        for (const p of r ?? []) {
          const libelle = `${p.titre}${p.varianteTitre ? ` · ${p.varianteTitre}` : ''}`;
          if (p.produitId) noms.current.set(cleVise({ produit: p.produitId }), p.titre);
          if (p.sku) noms.current.set(cleVise({ sku: p.sku }), `${libelle} (${p.sku})`);
        }
        setResultats(r);
      });
    }, 250);
    return () => { actif = false; clearTimeout(minuterie); };
  }, [tenantId, recherche]);

  const achete = achatsDe(valeurSegment(segments, CLES_SEGMENT.achete));
  const pasAchete = achatsDe(valeurSegment(segments, CLES_SEGMENT.pasAchete));
  const reassort = reassortDe(valeurSegment(segments, CLES_SEGMENT.reassort));

  /** Remplace (ou retire) les clés données, sans toucher aux autres critères. */
  const ecrire = (changes: Partial<Record<CleSegment, AchatsVises | Reassort | undefined>>) => {
    const cles = Object.keys(changes) as CleSegment[];
    const gardes = segments.filter((s) => !cles.includes(s.key as CleSegment));
    const ajouts = cles.flatMap((k) => { const v = changes[k]; return v === undefined ? [] : [filtreSegment(k, v)]; });
    onChange([...gardes, ...ajouts]);
  };
  /** « A acheté » vidé emporte « n'a pas acheté », qui ne s'emploie jamais seul. */
  const ecrireAchete = (a: AchatsVises | undefined) =>
    ecrire(a === undefined ? { [CLES_SEGMENT.achete]: undefined, [CLES_SEGMENT.pasAchete]: undefined } : { [CLES_SEGMENT.achete]: a });
  const ajouter = (liste: AchatsVises | undefined, vise: ProduitVise): AchatsVises | undefined => {
    const produits = liste?.produits ?? [];
    if (produits.some((p) => cleVise(p) === cleVise(vise)) || produits.length >= BORNES_SEGMENTS.produitsMax) return liste;
    return { ...(liste ?? {}), produits: [...produits, vise] };
  };
  const retirer = (liste: AchatsVises, vise: ProduitVise): AchatsVises | undefined => {
    const produits = liste.produits.filter((p) => cleVise(p) !== cleVise(vise));
    return produits.length === 0 ? undefined : { ...liste, produits };
  };
  const viseDe = (p: ProduitVuVue): ProduitVise =>
    (cible === 'sku' && p.sku) || !p.produitId ? { sku: p.sku! } : { produit: p.produitId };
  const nom = (v: ProduitVise): string =>
    noms.current.get(cleVise(v)) ?? ('produit' in v ? t(`Produit ${v.produit}`, `Product ${v.produit}`) : `SKU ${v.sku}`);

  return (
    <div className="flex flex-col gap-2 border-t border-ink-100 pt-2" data-testid="filtres-produits">
      <LigneAchats
        nom="achete" libelle={t('A acheté (tous ces produits)', 'Bought (all these products)')} achats={achete} nomDe={nom}
        onRetirer={(v) => ecrireAchete(retirer(achete!, v))}
        onJours={(jours) => achete && ecrireAchete({ produits: achete.produits, ...(jours !== undefined ? { jours } : {}) })}
      />
      <LigneAchats
        nom="pas-achete" libelle={t('N’a pas acheté (aucun de ces produits)', 'Did not buy (none of these products)')} achats={pasAchete} nomDe={nom}
        onRetirer={(v) => ecrire({ [CLES_SEGMENT.pasAchete]: retirer(pasAchete!, v) })}
      />
      <LigneReassort
        reassort={reassort} nomDe={nom}
        onChange={(r) => ecrire({ [CLES_SEGMENT.reassort]: r })}
      />
      <div className="flex flex-col gap-1">
        <input
          type="search" value={recherche} onChange={(e) => setRecherche(e.target.value)} maxLength={80}
          placeholder={t('Chercher un produit déjà commandé (titre ou SKU)', 'Search a product already ordered (title or SKU)')}
          className={`${inputClsAuto} w-full`} data-testid="filtre-produits-recherche"
        />
        <div className="flex flex-wrap gap-3 text-xs text-ink-500" role="radiogroup">
          <label className="flex items-center gap-1">
            <input type="radio" checked={cible === 'produit'} onChange={() => setCible('produit')} data-testid="filtre-produits-cible-produit" />
            {t('Viser le produit (toutes ses variantes)', 'Target the product (every variant)')}
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" checked={cible === 'sku'} onChange={() => setCible('sku')} data-testid="filtre-produits-cible-sku" />
            {t('Viser la variante (son SKU)', 'Target the variant (its SKU)')}
          </label>
        </div>
        {resultats === null && (
          <p className="text-xs text-danger" data-testid="filtre-produits-indisponible">
            {t('La liste des produits commandés n’a pas pu être lue.', 'The list of ordered products could not be read.')}
          </p>
        )}
        {Array.isArray(resultats) && resultats.length === 0 && (
          <p className="text-xs text-ink-500" data-testid="filtre-produits-aucun">
            {t('Aucun produit ne correspond dans les commandes reçues. Les cartes cadeaux ne se ciblent pas.', 'No product matches in the orders received. Gift cards cannot be targeted.')}
          </p>
        )}
        {Array.isArray(resultats) && resultats.length > 0 && (
          <ul className="divide-y divide-ink-100 rounded-controle border border-ink-100 text-sm" data-testid="filtre-produits-resultats">
            {resultats.map((p) => {
              const vise = viseDe(p);
              return (
                <li key={`${p.produitId ?? ''}|${p.sku ?? ''}`} className="flex flex-wrap items-center gap-2 px-2 py-1.5" data-testid="filtre-produits-resultat">
                  <span className="min-w-0 flex-1 text-ink-700">
                    {p.titre}{p.varianteTitre && <span className="text-ink-500"> · {p.varianteTitre}</span>}
                    {p.sku && <span className="text-ink-400"> ({p.sku})</span>}
                    <span className="text-xs text-ink-400"> · {p.commandes === 1 ? t('1 commande', '1 order') : t(`${p.commandes} commandes`, `${p.commandes} orders`)}</span>
                  </span>
                  <button type="button" className="text-xs text-brand-700 hover:underline" data-testid="produit-achete" onClick={() => ecrireAchete(ajouter(achete, vise))}>
                    {t('A acheté', 'Bought')}
                  </button>
                  <button
                    type="button" className="text-xs text-brand-700 hover:underline disabled:cursor-not-allowed disabled:text-ink-300" data-testid="produit-pas-achete"
                    disabled={achete === undefined} onClick={() => ecrire({ [CLES_SEGMENT.pasAchete]: ajouter(pasAchete, vise) })}
                    title={achete === undefined ? t('« N’a pas acheté » s’ajoute à « a acheté », jamais seul.', '"Did not buy" goes with "bought", never alone.') : undefined}
                  >
                    {t('N’a pas acheté', 'Did not buy')}
                  </button>
                  <button
                    type="button" className="text-xs text-brand-700 hover:underline" data-testid="produit-reassort"
                    onClick={() => ecrire({ [CLES_SEGMENT.reassort]: { ...vise, ...bornesDuReassort(reassort) } })}
                  >
                    {t('Réassort', 'Restock')}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {achete === undefined && (
          <p className="text-xs text-ink-500" data-testid="filtre-pas-achete-aide">
            {t('« N’a pas acheté » s’ajoute à « a acheté », jamais seul : seul, il viserait presque tous vos contacts.', '"Did not buy" goes with "bought", never alone: alone, it would target almost all your contacts.')}
          </p>
        )}
      </div>
    </div>
  );
}

/** Une liste de produits posée (« a acheté » ou « n'a pas acheté ») : ses puces, et pour « a acheté » sa fenêtre en jours. */
function LigneAchats({ nom, libelle, achats, nomDe, onRetirer, onJours }: {
  nom: string; libelle: string; achats: AchatsVises | undefined; nomDe: (v: ProduitVise) => string;
  onRetirer: (v: ProduitVise) => void; onJours?: (jours: number | undefined) => void;
}) {
  const t = useT();
  const [saisie, setSaisie] = useState(achats?.jours === undefined ? '' : String(achats.jours));
  useEffect(() => { setSaisie(achats?.jours === undefined ? '' : String(achats.jours)); }, [achats?.jours]);
  if (!achats) return null;
  const lecture = lireJours(saisie);
  return (
    <div className="flex flex-col gap-1" data-testid={`filtre-${nom}`}>
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-700">
        <span className="min-w-40">{libelle}</span>
        {achats.produits.map((p) => (
          <span key={JSON.stringify(p)} className="inline-flex items-center gap-1 rounded-controle bg-ink-100 px-2 py-0.5 text-xs" data-testid={`filtre-${nom}-puce`}>
            {nomDe(p)}
            <button type="button" aria-label={t('Retirer', 'Remove')} className="text-ink-500 hover:text-ink-900" data-testid={`filtre-${nom}-retirer`} onClick={() => onRetirer(p)}>×</button>
          </span>
        ))}
        {onJours && (
          <>
            <span>{t('sur les', 'over the last')}</span>
            <input
              type="number" inputMode="numeric" min={1} max={BORNES_SEGMENTS.joursMax} value={saisie} className={`${inputClsAuto} w-20`}
              data-testid={`filtre-${nom}-jours`}
              onChange={(e) => {
                setSaisie(e.target.value);
                const l = lireJours(e.target.value);
                if (l !== 'erreur') onJours(l);
              }}
            />
            <span>{t('derniers jours (vide : depuis le début du suivi)', 'days (empty: since tracking started)')}</span>
          </>
        )}
      </div>
      {lecture === 'erreur' && (
        <p className="text-xs text-danger" data-testid={`filtre-${nom}-erreur`}>
          {t(`Un nombre entier de jours, de 1 à ${BORNES_SEGMENTS.joursMax}.`, `A whole number of days, from 1 to ${BORNES_SEGMENTS.joursMax}.`)}
        </p>
      )}
    </div>
  );
}

/**
 * Le réassort posé : son produit et sa plage de jours depuis le dernier achat. 🔴 Une saisie invalide, ou les deux bornes
 * vidées le temps d'une frappe, NE RETIRE RIEN : la dernière plage valide reste appliquée, comme les autres lignes du
 * volet. Le critère se retire par sa croix.
 */
function LigneReassort({ reassort, nomDe, onChange }: {
  reassort: Reassort | undefined; nomDe: (v: ProduitVise) => string; onChange: (r: Reassort | undefined) => void;
}) {
  const t = useT();
  const [saisie, setSaisie] = useState<SaisiePlage>(() => saisieDePlage(reassort));
  // Des primitives en dépendances : `reassort` est relu du JSON des filtres à chaque rendu, jamais le même objet.
  const min = reassort?.min;
  const max = reassort?.max;
  useEffect(() => { setSaisie(saisieDePlage({ ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) })); }, [min, max]);
  if (!reassort) return null;
  const vise: ProduitVise = 'produit' in reassort ? { produit: reassort.produit } : { sku: reassort.sku };
  const options = { max: BORNES_SEGMENTS.joursMax, entier: true, avecJours: false, restreint: false };
  const changer = (patch: Partial<SaisiePlage>) => {
    const s = { ...saisie, ...patch };
    setSaisie(s);
    const l = lirePlageSaisie(s, options);
    if ('erreur' in l || l.plage === undefined) return;
    onChange({ ...vise, ...l.plage });
  };
  const lecture = lirePlageSaisie(saisie, options);
  const champ = (k: 'min' | 'max') => (
    <input
      type="number" inputMode="numeric" min={0} max={BORNES_SEGMENTS.joursMax} value={saisie[k]} className={`${inputClsAuto} w-20`}
      data-testid={`filtre-reassort-${k}`} onChange={(e) => changer({ [k]: e.target.value })}
    />
  );
  return (
    <div className="flex flex-col gap-1" data-testid="filtre-reassort">
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-700">
        <span className="min-w-40">{t('Réassort : dernier achat de', 'Restock: last purchase of')}</span>
        <span className="inline-flex items-center gap-1 rounded-controle bg-ink-100 px-2 py-0.5 text-xs" data-testid="filtre-reassort-puce">
          {nomDe(vise)}
          <button type="button" aria-label={t('Retirer', 'Remove')} className="text-ink-500 hover:text-ink-900" data-testid="filtre-reassort-retirer" onClick={() => onChange(undefined)}>×</button>
        </span>
        <span>{t('il y a au moins', 'at least')}</span>{champ('min')}
        <span>{t('au plus', 'at most')}</span>{champ('max')}
        <span>{t('jours', 'days ago')}</span>
      </div>
      {('erreur' in lecture || lecture.plage === undefined) && (
        <p className="text-xs text-danger" data-testid="filtre-reassort-erreur">
          {'erreur' in lecture
            ? lecture.erreur === 'ordre' ? t('Le minimum dépasse le maximum.', 'The minimum is above the maximum.') : t('Un nombre dans les bornes, s’il vous plaît.', 'A number within bounds, please.')
            : t('Au moins une borne : « il y a au moins » ou « au plus ».', 'At least one bound: "at least" or "at most".')}
        </p>
      )}
    </div>
  );
}

/**
 * Les bornes d'un réassort quand on change de produit : celles déjà posées, sinon « il y a au moins 60 jours », visible et
 * modifiable (le critère exige une borne, et un produit choisi sans borne ne filtrerait rien).
 */
function bornesDuReassort(r: Reassort | undefined): { min?: number; max?: number } {
  if (r && (r.min !== undefined || r.max !== undefined)) {
    return { ...(r.min !== undefined ? { min: r.min } : {}), ...(r.max !== undefined ? { max: r.max } : {}) };
  }
  return { min: 60 };
}

/** La clé d'un produit visé, pour comparer et nommer. */
function cleVise(v: ProduitVise): string {
  return 'produit' in v ? `p:${v.produit}` : `s:${v.sku}`;
}

/** Une liste de produits posée, ou `undefined` (absente ou illisible). */
function achatsDe(v: unknown): AchatsVises | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const a = v as Partial<AchatsVises>;
  return Array.isArray(a.produits) && a.produits.length > 0 ? a as AchatsVises : undefined;
}

/** Un réassort posé, ou `undefined`. */
function reassortDe(v: unknown): Reassort | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const r = v as Record<string, unknown>;
  return typeof r.produit === 'string' || typeof r.sku === 'string' ? r as unknown as Reassort : undefined;
}

/** Une fenêtre en jours saisie : vide, un entier valide, ou une erreur. */
function lireJours(s: string): number | undefined | 'erreur' {
  if (s.trim() === '') return undefined;
  const n = Number(s);
  return Number.isInteger(n) && n >= 1 && n <= BORNES_SEGMENTS.joursMax ? n : 'erreur';
}
