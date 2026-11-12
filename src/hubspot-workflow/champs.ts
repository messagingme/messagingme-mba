import { z } from 'zod';
import { ensureFieldByKey, type UserFieldStore } from '../crm/fields';
import { normaliserDate } from '../crm/date-iso';
import type { UserFieldType } from '../crm/types';
import type { ChampsFiche } from '../campaign/build';
import { journaliser } from '../lib/journal';

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
export const CALCULES_HUBSPOT = ['conseiller', 'lien_agenda', 'lien_devis', 'pdf_devis', 'document'] as const;
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

/**
 * Un champ choisi avec son libellé HubSpot, tel que le connecteur le rend. `typeHubspot` (le `type` de la propriété chez
 * HubSpot : `datetime`, `date`, `string`...) n'est connu qu'à l'enregistrement de la liste, relu chez le connecteur.
 */
export interface ChampLibelle { objet: ObjetHubspot; propriete: string; libelle: string; typeHubspot?: string }

/** La clé de fiche d'un champ choisi : `hs_contact_<p>`, `hs_deal_<p>` ou `hs_calc_<calculé>`. */
export function cleChampHubspot(objet: ObjetHubspot, propriete: string): string {
  return `hs_${objet === 'calcule' ? 'calc' : objet}_${propriete}`;
}

/**
 * Le type du champ de fiche : les liens calculés (réservation, devis, PDF du devis) en `url`, une propriété HubSpot
 * `datetime` en « date et heure » et `date` en « date » (plan `docs/superpowers/plans/2026-11-12-champs-hubspot-dates.md` :
 * le déclencheur « avant ou après une date » n'accepte qu'un champ « date et heure », le rappel d'un rendez-vous pris dans
 * HubSpot en dépend), le reste en texte. 🔴 Un booléen ou un nombre restent du TEXTE : `champsDeFiche` ne met en forme que
 * les dates, un autre type recevrait la valeur brute de HubSpot sans validation.
 */
export function typeChampHubspot(objet: ObjetHubspot, propriete: string, typeHubspot?: string): UserFieldType {
  if (objet === 'calcule') return CALCULES_LIENS.has(propriete) ? 'url' : 'text';
  if (typeHubspot === 'datetime') return 'datetime';
  if (typeHubspot === 'date') return 'date';
  return 'text';
}

/** Un champ de fiche déclaré dans l'espace, tel que l'écriture des valeurs reçues le lit (`UserFieldStore.list`). */
export interface ChampDeclare { readonly key: string; readonly type: UserFieldType }

/** Ce que la déclaration demande au store des champs : il sait aussi changer le type d'un champ existant. */
export interface StoreChampsHubspot extends UserFieldStore {
  updateField(tenantId: string, key: string, patch: { type: UserFieldType }): Promise<boolean>;
}

/**
 * Déclare les champs choisis dans l'espace (idempotent). Une clé qui existe déjà garde son libellé et son type, SAUF un
 * champ resté en texte dont la propriété HubSpot est une date : il passe en date (décision de Julien du 2026-11-12), ses
 * valeurs venant déjà de HubSpot. Jamais l'inverse, et jamais un autre type : un champ retypé à la main reste tel quel.
 */
export async function declarerChampsHubspot(store: StoreChampsHubspot, tenantId: string, champs: readonly ChampLibelle[]): Promise<void> {
  for (const c of champs) {
    const cle = cleChampHubspot(c.objet, c.propriete);
    const voulu = typeChampHubspot(c.objet, c.propriete, c.typeHubspot);
    const champ = await ensureFieldByKey(store, tenantId, cle, `${c.libelle} (HubSpot)`, voulu);
    if (champ.type === 'text' && (voulu === 'date' || voulu === 'datetime')) await store.updateField(tenantId, cle, { type: voulu });
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
/**
 * L'adresse du PDF propre au contact : signée, donc plus longue qu'un lien de devis (jeton, nom de fichier encodé), et
 * jamais écrite sur la fiche (`recopierDocumentRecu` la remplace par un code) : la borne d'une valeur de fiche ne la
 * concerne pas. Plafonnée quand même, une adresse de 4 Ko au-delà n'est plus une adresse (relecture du lot B1).
 */
export const ADRESSE_DOCUMENT_MAX = 4096;
const adresseDocument = z.union([z.literal(''), z.url({ protocol: /^https$/ }).max(ADRESSE_DOCUMENT_MAX)]);

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
    // Le PDF propre au contact (plan `docs/superpowers/plans/2026-11-12-pdf-par-contact-hubspot.md`) : une adresse à courte
    // vie que mba télécharge AUSSITÔT (`recopierDocumentRecu`) ; la fiche ne reçoit que le code de la copie, jamais l'adresse.
    document: adresseDocument.optional(),
  }).strict().optional(),
}).strict()
  .refine((c) => Object.keys(c).length > 0, { message: 'aucun groupe' })
  .refine((c) => Object.keys(c.contact ?? {}).length + Object.keys(c.deal ?? {}).length + Object.keys(c.calcules ?? {}).length <= CHAMPS_HUBSPOT_MAX, { message: 'trop de champs' });

export type ChampsGroupes = z.infer<typeof schemaChampsGroupes>;

/**
 * Les champs de fiche reçus, clé de fiche et valeur brute. L'ancienne forme `{ prenom, conseiller, lienAgenda }` de
 * l'action transaction est retirée depuis le 2026-11-03 : le connecteur n'envoie que la forme groupée depuis le lot 2
 * (2026-11-02), et les corps gardés de ses relances ont passé `TROP_TARD_MS` (20 h).
 */
function clesRecues(g: ChampsGroupes): Array<[string, string]> {
  return [
    ...Object.entries(g.contact ?? {}).map(([p, v]): [string, string] => [cleChampHubspot('contact', p), v]),
    ...Object.entries(g.deal ?? {}).map(([p, v]): [string, string] => [cleChampHubspot('deal', p), v]),
    ...Object.entries(g.calcules ?? {}).flatMap(([p, v]): Array<[string, string]> => (v === undefined ? [] : [[cleChampHubspot('calcule', p), v]])),
  ];
}

/**
 * Les champs reçus, en écriture de fiche : une valeur posée, une valeur vide RETIRÉE (jamais la valeur laissée par une
 * transaction précédente, décision 6 du 2026-10-29), une propriété non reçue pas touchée. Seules les clés DÉCLARÉES dans
 * l'espace (`declarees`) s'écrivent ; une autre est ignorée.
 *
 * Un champ « date » ou « date et heure » reçoit sa valeur mise en ISO (`normaliserDate`, la forme que le déclencheur
 * « avant ou après une date » et les filtres comparent). 🔴 Une date ILLISIBLE est RETIRÉE et journalisée (sa clé et la
 * raison, jamais la valeur), décision de Julien du 2026-11-12 : un rappel ne part pas sur l'ancienne date d'un rendez-vous
 * que HubSpot a changé, et un champ date ne porte qu'une date.
 */
export function champsDeFiche(recus: ChampsGroupes, declarees: Iterable<ChampDeclare>, tenantId: string): ChampsFiche {
  const types = new Map<string, UserFieldType>();
  for (const d of declarees) types.set(d.key, d.type);
  const poser: Record<string, string> = {};
  const retirer: string[] = [];
  for (const [cle, v] of clesRecues(recus)) {
    const type = types.get(cle);
    if (type === undefined) continue;
    if (v.trim() === '') {
      retirer.push(cle);
      continue;
    }
    if (type !== 'date' && type !== 'datetime') {
      poser[cle] = v;
      continue;
    }
    const n = normaliserDate(v, type);
    if (n.ok) poser[cle] = n.iso;
    else {
      journaliser('warn', 'hubspot_champ_date_illisible', { tenantId, cle, raison: n.raison });
      retirer.push(cle);
    }
  }
  return { poser, retirer };
}
