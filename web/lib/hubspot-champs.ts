import type { ChampHubspot, ChampsHubspotDuPortail } from './api';

/**
 * LES CHAMPS HUBSPOT À IMPORTER (lot 2 du 2026-11-02, `components/ChampsHubspot.tsx`) : la logique de l'écran, en
 * fonctions pures, testées dans `hubspot-champs.test.ts`. Le serveur tient les mêmes bornes (20 au plus, sans doublon).
 */

/** Au plus autant de champs choisis, calculés compris (le serveur refuse au-delà). */
export const CHAMPS_HUBSPOT_MAX = 20;

/** L'identifiant d'un champ dans la sélection de l'écran : son objet et sa propriété. */
export const idChamp = (c: ChampHubspot): string => `${c.objet}:${c.propriete}`;

/** Une ligne de la liste : un champ, son libellé HubSpot, et s'il peut être coché. */
export interface LigneChamp extends ChampHubspot {
  libelle: string;
  /** Le nom interne, montré sous le libellé (deux propriétés peuvent porter le même libellé). */
  nom: string;
  /** Faux pour un calculé dont l'accès manque, ou un choisi disparu de HubSpot. */
  disponible: boolean;
  /** Le calculé indisponible : l'accès qui manque pour le cocher (la raison montrée sous la case). */
  acces?: AccesHubspot;
}

/** Une portée facultative de l'application HubSpot qu'un calculé demande. */
export type AccesHubspot = 'agenda' | 'devis' | 'pieces';

/**
 * Les calculés, dans l'ordre de l'écran, et l'accès que chacun demande (cadrage « lien du devis » du 2026-11-02) : le
 * conseiller n'en demande aucun, le lien de réservation l'agenda, le lien et le PDF du devis les devis.
 */
const CALCULES: ReadonlyArray<{ cle: ChampsHubspotDuPortail['calcules'][number]['cle']; acces?: AccesHubspot }> = [
  { cle: 'conseiller' }, { cle: 'lien_agenda', acces: 'agenda' }, { cle: 'lien_devis', acces: 'devis' }, { cle: 'pdf_devis', acces: 'devis' },
  // Le PDF joint au dernier e-mail (plan du 2026-11-12) : l'accès aux e-mails et aux fichiers, ou, en repli, aux devis.
  { cle: 'document', acces: 'pieces' },
];
const rangCalcule = (cle: string): number => {
  const i = CALCULES.findIndex((c) => c.cle === cle);
  return i < 0 ? CALCULES.length : i;
};

/**
 * Faut-il proposer « Autoriser l'accès aux devis et à l'agenda » ? Oui dès qu'un calculé est grisé faute d'accès : le
 * connecteur redemande toutes les portées facultatives à chaque autorisation, un seul bouton couvre les deux.
 */
export function accesAAutoriser(portail: ChampsHubspotDuPortail): boolean {
  return portail.calcules.some((c) => !c.disponible && CALCULES.some((k) => k.cle === c.cle && k.acces));
}

export interface GroupeChamps {
  objet: ChampHubspot['objet'];
  lignes: LigneChamp[];
}

/** Pour la recherche : minuscules, sans accents. */
const plat = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Les trois groupes de l'écran (Contact, Transaction, Calculés), filtrés par la recherche sur le libellé ou le nom.
 * 🔴 Un champ déjà choisi reste visible quelle que soit la recherche : il compte dans les 20, on doit pouvoir le décocher.
 */
export function groupesDeChamps(portail: ChampsHubspotDuPortail, recherche: string, selection: ReadonlySet<string>): GroupeChamps[] {
  const q = plat(recherche.trim());
  const garde = (l: LigneChamp) => q === '' || selection.has(idChamp(l)) || plat(l.libelle).includes(q) || plat(l.nom).includes(q);
  const proprietes = (objet: 'contact' | 'deal'): LigneChamp[] =>
    portail.proprietes[objet].map((p) => ({ objet, propriete: p.nom, nom: p.nom, libelle: p.libelle, disponible: true }));
  // Les calculés dans l'ordre de l'écran (conseiller, réservation, devis, PDF), quel que soit celui du connecteur.
  const calcules: LigneChamp[] = [...portail.calcules].sort((a, b) => rangCalcule(a.cle) - rangCalcule(b.cle)).map((c) => {
    const acces = c.disponible ? undefined : CALCULES.find((k) => k.cle === c.cle)?.acces;
    return { objet: 'calcule', propriete: c.cle, nom: c.cle, libelle: c.libelle, disponible: c.disponible, ...(acces ? { acces } : {}) };
  });
  // 🔴 Un champ choisi que le portail ne propose plus (supprimé, caché ou devenu sensible dans HubSpot) : montré avec
  // la raison, décochable et jamais recochable. Sans sa ligne, il resterait dans la sélection sans case, et chaque
  // enregistrement prendrait le refus `propriete_inconnue` (relecture du lot 2, 2026-11-02).
  const connus = new Set([...proprietes('contact'), ...proprietes('deal'), ...calcules].map(idChamp));
  const disparus = (objet: ChampHubspot['objet']): LigneChamp[] => portail.choisis
    .filter((c) => c.objet === objet && !connus.has(idChamp(c)))
    .map((c) => ({ objet, propriete: c.propriete, nom: c.propriete, libelle: `${c.libelle} (n’existe plus dans HubSpot)`, disponible: false }));
  return [
    { objet: 'contact' as const, lignes: [...proprietes('contact'), ...disparus('contact')].filter(garde) },
    { objet: 'deal' as const, lignes: [...proprietes('deal'), ...disparus('deal')].filter(garde) },
    { objet: 'calcule' as const, lignes: [...calcules, ...disparus('calcule')].filter(garde) },
  ];
}

/**
 * Les champs sélectionnés, dans l'ordre des groupes (Contact, Transaction, Calculés), avec leur libellé : la liste au-dessus
 * des cases, où chacun se retire d'une croix (demande de Julien du 2026-11-02 : un champ coché disparaissait dès que la
 * recherche changeait). Un choisi disparu de HubSpot y figure aussi, avec sa raison.
 */
export function champsSelectionnes(portail: ChampsHubspotDuPortail, selection: ReadonlySet<string>): LigneChamp[] {
  return groupesDeChamps(portail, '', selection).flatMap((g) => g.lignes).filter((l) => selection.has(idChamp(l)));
}

/**
 * La réponse de la lecture a-t-elle la forme attendue ? Une API d'une autre version (ou un mock) qui rendrait autre chose
 * ferait tomber toute la page Intégrations : l'écran le dit à la place.
 */
export function portailLisible(p: unknown): p is ChampsHubspotDuPortail {
  const r = p as Partial<ChampsHubspotDuPortail> | null | undefined;
  return !!r && Array.isArray(r.proprietes?.contact) && Array.isArray(r.proprietes?.deal) && Array.isArray(r.calcules) && Array.isArray(r.choisis);
}

/** La sélection de départ : la liste enregistrée chez le connecteur. */
export function selectionDe(choisis: ReadonlyArray<ChampHubspot>): Set<string> {
  return new Set(choisis.map(idChamp));
}

/** La case est-elle grisée ? Au-delà de 20, seules les cases cochées restent actives ; un champ indisponible ne se coche pas. */
export function caseGrisee(selection: ReadonlySet<string>, l: LigneChamp): boolean {
  if (selection.has(idChamp(l))) return false;
  return !l.disponible || selection.size >= CHAMPS_HUBSPOT_MAX;
}

/** Coche ou décoche, sans jamais dépasser 20. */
export function basculerChamp(selection: ReadonlySet<string>, l: LigneChamp): Set<string> {
  const suivante = new Set(selection);
  const id = idChamp(l);
  if (suivante.has(id)) suivante.delete(id);
  else if (!caseGrisee(selection, l)) suivante.add(id);
  return suivante;
}

/** L'identifiant du calculé `document` dans la sélection. */
export const ID_DOCUMENT = 'calcule:document';
/** Les bornes des débuts, celles du serveur et du connecteur (`schemaDebutsDocument`). */
export const DEBUTS_MAX = 5;
export const DEBUT_LONGUEUR_MAX = 40;

/** Les débuts du document, tels que l'écran les montre : séparés par des virgules. */
export function debutsDe(choisis: ReadonlyArray<ChampHubspot>): string {
  return (choisis.find((c) => c.objet === 'calcule' && c.propriete === 'document')?.debuts ?? []).join(', ');
}

/**
 * Les débuts saisis, prêts pour le serveur : séparés par des virgules ou des retours à la ligne, sans vides ni doublons
 * (sans casse), coupés aux bornes. Le serveur refuserait au-delà ; l'écran le dit avant (`debutsTropNombreux`).
 */
export function lireDebuts(texte: string): string[] {
  const vus = new Set<string>();
  return texte.split(/[,\n]/).map((x) => x.trim().slice(0, DEBUT_LONGUEUR_MAX)).filter((x) => {
    const cle = x.toLowerCase();
    if (x === '' || vus.has(cle)) return false;
    vus.add(cle);
    return true;
  });
}

/** Plus de débuts que le serveur n'en accepte. */
export const debutsTropNombreux = (texte: string): boolean => lireDebuts(texte).length > DEBUTS_MAX;

/**
 * Le corps de `PUT .../hubspot/champs` : la sélection, sans libellé (le serveur relit ceux de HubSpot). 🔴 Le document
 * part AVEC ses débuts : renvoyé sans eux, la liste entière étant remplacée, ils seraient effacés chez le connecteur.
 */
export function corpsDesChamps(selection: ReadonlySet<string>, debuts = ''): ChampHubspot[] {
  const lus = lireDebuts(debuts).slice(0, DEBUTS_MAX);
  return [...selection].flatMap((id): ChampHubspot[] => {
    const i = id.indexOf(':');
    const objet = id.slice(0, i);
    const propriete = id.slice(i + 1);
    if (id === ID_DOCUMENT) return [{ objet: 'calcule', propriete, ...(lus.length > 0 ? { debuts: lus } : {}) }];
    return objet === 'contact' || objet === 'deal' || objet === 'calcule' ? [{ objet, propriete }] : [];
  });
}

/** La sélection diffère-t-elle de ce qui est enregistré ? Le bouton « Enregistrer » ne sert qu'alors. */
export function selectionModifiee(selection: ReadonlySet<string>, enregistree: ReadonlySet<string>): boolean {
  return selection.size !== enregistree.size || [...selection].some((id) => !enregistree.has(id));
}
