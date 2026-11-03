import { z } from 'zod';
import { ensureFieldByKey, type UserFieldStore } from '../crm/fields';
import type { UserFieldType } from '../crm/types';
import type { ChampsFiche } from '../campaign/build';
import { videEnAbsent } from '../api/fiche';

/**
 * LES CHAMPS HUBSPOT QU'UN ESPACE CHOISIT D'IMPORTER SUR SES FICHES (lot 2 du plan
 * `~/mm-hubspot/docs/2026-11-02-champs-hubspot-et-accord-plan.md`, cadrage du même jour, décisions 1 à 4, validées par
 * Julien). Le client choisit, dans Tools > Intégrations > HubSpot, des propriétés du contact et de la transaction, et des
 * champs calculés (`CALCULES_HUBSPOT` : le conseiller, son lien de réservation, le lien et le PDF du devis). La liste vit dans le
 * connecteur ; le connecteur lit les valeurs à chaque exécution et les envoie BRUTES, groupées par objet.
 *
 * 🔴 MBA SEUL FABRIQUE LES CLÉS DE FICHE, depuis le NOM INTERNE de la propriété, jamais depuis son libellé : les sources
 * d'un modèle visent une clé, et un libellé renommé dans HubSpot ne doit pas les faire pointer sur un champ que
 * personne n'écrit. Les calculés vivent sous `hs_calc_`, hors de l'espace des propriétés : une propriété de transaction
 * que le client aurait appelée « conseiller » ne les écrase jamais.
 *
 * 🔴 ET MBA N'ÉCRIT QU'UNE CLÉ DÉCLARÉE DANS L'ESPACE : la liste vit chez le connecteur, mba ne la relit pas à chaque
 * envoi. La déclaration (`declarerChampsHubspot`) a lieu à l'enregistrement de la liste, AVANT de la poser chez le
 * connecteur ; une clé reçue sans champ déclaré est ignorée.
 */

/** Le nom d'une propriété HubSpot qu'on importe : `hs_contact_` + 53 caractères tient dans les 64 d'une clé de l'API. */
export const NOM_PROPRIETE_HUBSPOT = /^[a-z0-9_]{1,53}$/;
/** Au plus autant de champs choisis, calculés compris. */
export const CHAMPS_HUBSPOT_MAX = 20;
/** La borne d'une valeur de champ de fiche (`validateFieldValue`) : le connecteur coupe à cette longueur. */
export const VALEUR_CHAMP_HUBSPOT_MAX = 1000;
/**
 * Les calculés : le conseiller et son lien de réservation (lot 2), le lien public et le PDF du devis de la transaction
 * (cadrage `~/mm-hubspot/docs/2026-11-02-lien-du-devis-cadrage.md`, décisions 1 à 5). Le connecteur choisit le devis.
 */
export const CALCULES_HUBSPOT = ['conseiller', 'lien_agenda', 'lien_devis', 'pdf_devis'] as const;
export type CalculeHubspot = (typeof CALCULES_HUBSPOT)[number];
/** Les calculés qui sont des liens envoyés au client : de type `url`, `https` seulement. */
const CALCULES_LIENS: ReadonlySet<string> = new Set<CalculeHubspot>(['lien_agenda', 'lien_devis', 'pdf_devis']);
export type ObjetHubspot = 'contact' | 'deal' | 'calcule';

/** Un champ choisi, tel que le contrat le décrit. */
export const schemaChampChoisi = z.union([
  z.object({ objet: z.enum(['contact', 'deal']), propriete: z.string().regex(NOM_PROPRIETE_HUBSPOT) }).strict(),
  z.object({ objet: z.literal('calcule'), propriete: z.enum(CALCULES_HUBSPOT) }).strict(),
]);
export type ChampChoisi = z.infer<typeof schemaChampChoisi>;

/** Une liste choisie : au plus `CHAMPS_HUBSPOT_MAX`, sans doublon (objet, propriété). */
export const schemaListeChoisie = z.array(schemaChampChoisi).max(CHAMPS_HUBSPOT_MAX)
  .refine((l) => new Set(l.map((c) => `${c.objet}:${c.propriete}`)).size === l.length, { message: 'doublon' });

/** Un champ choisi avec son libellé HubSpot, tel que le connecteur le rend. */
export interface ChampLibelle { objet: ObjetHubspot; propriete: string; libelle: string }

/** La clé de fiche d'un champ choisi : `hs_contact_<p>`, `hs_deal_<p>` ou `hs_calc_<calculé>`. */
export function cleChampHubspot(objet: ObjetHubspot, propriete: string): string {
  return `hs_${objet === 'calcule' ? 'calc' : objet}_${propriete}`;
}

/**
 * Le type du champ de fiche : du texte, sauf les liens calculés (réservation, devis, PDF du devis). `champsFiche` écrit
 * sans validation ni mise en forme, donc un champ déclaré date ou booléen recevrait la valeur brute de HubSpot.
 */
export function typeChampHubspot(objet: ObjetHubspot, propriete: string): UserFieldType {
  return objet === 'calcule' && CALCULES_LIENS.has(propriete) ? 'url' : 'text';
}

/** Déclare les champs choisis dans l'espace (idempotent : une clé qui existe déjà est reprise telle quelle). */
export async function declarerChampsHubspot(store: UserFieldStore, tenantId: string, champs: readonly ChampLibelle[]): Promise<void> {
  for (const c of champs) {
    await ensureFieldByKey(store, tenantId, cleChampHubspot(c.objet, c.propriete), `${c.libelle} (HubSpot)`, typeChampHubspot(c.objet, c.propriete));
  }
}

const valeur = z.string().max(VALEUR_CHAMP_HUBSPOT_MAX);
/** Les valeurs d'un objet : une par propriété choisie, `''` quand HubSpot la rend vide. */
const valeursDUnObjet = z.record(z.string().regex(NOM_PROPRIETE_HUBSPOT), valeur)
  .refine((r) => Object.keys(r).length <= CHAMPS_HUBSPOT_MAX, { message: 'trop de champs' });
/**
 * Un lien calculé (réservation, devis, PDF du devis) part tel quel dans un message au client : `https` seulement, ou vide
 * (aucun devis valable : le champ est RETIRÉ, jamais le lien d'une autre transaction).
 */
const lienCalcule = z.union([z.literal(''), z.url({ protocol: /^https$/ }).max(VALEUR_CHAMP_HUBSPOT_MAX)]);

/** Les valeurs des propriétés du contact seules (l'action « Lancer un scénario »). */
export const schemaChampsContact = z.object({ contact: valeursDUnObjet }).strict();

/** La forme groupée du contrat (lot 2) : chaque propriété choisie présente, vide = retirée. */
export const schemaChampsGroupes = z.object({
  contact: valeursDUnObjet.optional(),
  deal: valeursDUnObjet.optional(),
  calcules: z.object({
    conseiller: valeur.optional(),
    lien_agenda: lienCalcule.optional(),
    lien_devis: lienCalcule.optional(),
    pdf_devis: lienCalcule.optional(),
  }).strict().optional(),
}).strict()
  .refine((c) => Object.keys(c).length > 0, { message: 'aucun groupe' })
  .refine((c) => Object.keys(c.contact ?? {}).length + Object.keys(c.deal ?? {}).length + Object.keys(c.calcules ?? {}).length <= CHAMPS_HUBSPOT_MAX, { message: 'trop de champs' });

/**
 * L'ANCIENNE forme de l'action transaction (cadrage du 2026-10-29), acceptée le temps que le connecteur passe à la forme
 * groupée (mba se déploie avant lui, et une relance rejoue le corps de la première tentative). Une valeur absente ou
 * vide y était RETIRÉE : les trois sont donc toujours reçues. À retirer au lot suivant (`todo.md`).
 */
const texteAncien = z.preprocess(videEnAbsent, z.string().trim().max(200).optional());
export const schemaChampsAnciens = z.object({
  prenom: texteAncien,
  conseiller: texteAncien,
  lienAgenda: z.preprocess(videEnAbsent, z.url({ protocol: /^https$/ }).max(2048).optional()),
}).strict();

export type ChampsGroupes = z.infer<typeof schemaChampsGroupes>;
export type ChampsAnciens = z.infer<typeof schemaChampsAnciens>;

/** Les champs de fiche reçus, clé de fiche et valeur brute, dans l'une ou l'autre forme. */
function clesRecues(recus: ChampsGroupes | ChampsAnciens): Array<[string, string]> {
  if ('contact' in recus || 'deal' in recus || 'calcules' in recus) {
    const g = recus as ChampsGroupes;
    return [
      ...Object.entries(g.contact ?? {}).map(([p, v]): [string, string] => [cleChampHubspot('contact', p), v]),
      ...Object.entries(g.deal ?? {}).map(([p, v]): [string, string] => [cleChampHubspot('deal', p), v]),
      ...Object.entries(g.calcules ?? {}).flatMap(([p, v]): Array<[string, string]> => (v === undefined ? [] : [[cleChampHubspot('calcule', p), v]])),
    ];
  }
  const a = recus as ChampsAnciens;
  return [
    [cleChampHubspot('contact', 'firstname'), a.prenom ?? ''],
    [cleChampHubspot('calcule', 'conseiller'), a.conseiller ?? ''],
    [cleChampHubspot('calcule', 'lien_agenda'), a.lienAgenda ?? ''],
  ];
}

/**
 * Les champs reçus, en écriture de fiche : une valeur posée, une valeur vide RETIRÉE (jamais la valeur laissée par une
 * transaction précédente, décision 6 du 2026-10-29), une propriété non reçue pas touchée. Seules les clés DÉCLARÉES dans
 * l'espace (`declarees`) s'écrivent ; une autre est ignorée.
 */
export function champsDeFiche(recus: ChampsGroupes | ChampsAnciens, declarees: Iterable<string>): ChampsFiche {
  const connues = new Set(declarees);
  const poser: Record<string, string> = {};
  const retirer: string[] = [];
  for (const [cle, v] of clesRecues(recus)) {
    if (!connues.has(cle)) continue;
    if (v.trim() !== '') poser[cle] = v;
    else retirer.push(cle);
  }
  return { poser, retirer };
}
