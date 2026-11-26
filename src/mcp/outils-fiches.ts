import { ficheOutilMcp } from '../../web/lib/partage/catalogue-mcp';
import type { AnnotationsMcp, OutilMcp } from './outils';
import { RefusOutil, familleDuRefus, refusDuCoeur, texteObligatoire, valeurOuRefus } from './saisie';
import { ecriture, LOURDE, personneRequise, plafondCouteux, signataire } from './outils-agent';
import { proposer } from '../mise-en-ligne/mise-en-ligne';
import { boutonDuOui } from './outils-mise-en-ligne';
import { renommerEtiquette, supprimerEtiquette, type TagsRouteDeps } from '../http/tags';
import { creerContactALaMain, exporterHistorique, refusPossibles, type ContactsRouteDeps } from '../http/contacts';
import { apercuImport, effacementsDeLImportPour, importerCsv, type DepsApercuImport, type DepsImportCsv } from '../http/import';
import { texteDe } from '../lib/erreur';
import { estUuid } from '../http/scope';
import type { ColumnMapping } from '../crm/types';
import { LONGUEUR_MAX_ETIQUETTE } from '../crm/poser-etiquette';
import { LONGUEUR_MAX_CLE_CHAMP } from './outils-champs';
import { LONGUEUR_MAX_VALEUR_SAISIE } from '../crm/fields';
import { LISTES } from './ecran';

/**
 * LES ÉTIQUETTES ET LA CRÉATION D'UN CONTACT DEPUIS CLAUDE (lot 1 du CSM virtuel, B10, livraison 1a, plan
 * `docs/superpowers/plans/2026-11-26-csm-lot1-i-reste-du-lot.md`). 🔴 Aucune logique propre : le renommage et la
 * suppression d'une étiquette sont ceux du menu Contenu > Étiquettes (`renommerEtiquette`, `supprimerEtiquette`), la
 * création d'un contact celle de la console (`creerContactALaMain` : les champs validés contre les définitions de
 * l'espace, la limite de contacts de l'offre, la ligne `contact.created`), à une différence près : l'accord, que l'écran
 * pré-coche sous les yeux de la personne, se DIT ici (`opt_in` obligatoire). Aucun de ces gestes ne démarre
 * d'automation.
 * Livraison 1b : l'aperçu et l'import d'un CSV (`apercuImport`, `importerCsv` : 🔴 l'outil passe TOUJOURS l'autorité
 * `import`, qui ne lève jamais un STOP, et l'accord s'y dit aussi), les listes de conformité (désabonnés, refus possibles
 * par `refusPossibles`, bloqués), l'historique d'une fiche, son bilan et son export RGPD (`exporterHistorique`, tracé au
 * nom de la personne), par les MÊMES fonctions et magasins que les routes.
 */
export interface DepsFichesMcp {
  /** Les étiquettes de l'espace : le MÊME magasin que la route (`PgTagStore`, passé entier : ses méthodes lisent `this`). */
  referentielEtiquettes: Pick<TagsRouteDeps, 'listDistinct' | 'rename' | 'remove'>;
  /** La création d'un contact à la main, la MÊME fonction que `POST /contacts` (l'upsert de la console). */
  createOneContact: ContactsRouteDeps['createOneContact'];
  /** L'aperçu et l'import d'un CSV : les MÊMES magasins que la route (`PgContactStore`, `PgUserFieldStore`, entiers). */
  importCsv: DepsApercuImport & Omit<DepsImportCsv, 'audit'>;
  /** Les listes de conformité (désabonnés, refus possibles, bloqués) : le MÊME magasin que les routes (`PgContactStore`). */
  listesContacts: Pick<ContactsRouteDeps['contacts'], 'listeDesabonnes' | 'listBlocked' | 'messagesARelire'>;
  /** L'historique d'une fiche et son export : le MÊME magasin que les routes (`PgContactHistoryStore`, entier). */
  historiqueContacts: Pick<ContactsRouteDeps['contactHistory'], 'getContactHistory' | 'listSendsForExport'>;
  /** Le bilan d'une fiche (son coût, son entonnoir), qui demande ses tarifs à Meta : l'objet du chiffrage, entier. */
  bilanContact: Pick<ContactsRouteDeps, 'getBilanContact'>;
}

const lecture = (title: string, openWorldHint = false): AnnotationsMcp => ({ title, readOnlyHint: true, openWorldHint });

/** Des étiquettes et des champs au plus par création, bornés comme l'import de la console. */
const ETIQUETTES_MAX = 50;
const CHAMPS_MAX = 50;
/** Le nom d'un contact, que la console coupe au même endroit (`creerContactALaMain`) ; exporté pour le test des bornes. */
export const LONGUEUR_MAX_NOM_CONTACT = 120;
/** Le numéro avec son indicatif : le schéma l'annonce et l'outil l'applique, par la même expression. */
const TELEPHONE_E164 = /^\+[1-9][0-9]{7,14}$/;
/**
 * Un CSV passé par la conversation : le corps d'un appel MCP plafonne à 1 000 000 d'octets (le `bodyLimit` de l'API),
 * et un caractère accentué en pèse deux. Exporté pour le test des bornes annoncées.
 */
export const LONGUEUR_MAX_CSV_OUTIL = 200_000;
/** Les colonnes d'un mapping, et l'en-tête d'une colonne. */
const COLONNES_MAX = 100;
const LONGUEUR_MAX_ENTETE = 200;

/**
 * 🔴 L'accord se DIT (`create_contact`, `import_contacts`) : omis, il serait déclaré par défaut, comme la case que l'écran
 * pré-coche sous les yeux de la personne, et une fiche arrivée par un message passerait en « accepte » sans que personne
 * l'ait dit. `false` ne déclare rien : l'opt-in ne régresse jamais en base.
 */
function accordDit(v: unknown): boolean {
  if (typeof v !== 'boolean') throw new RefusOutil('opt_in : true ou false, obligatoire (true déclare l’accord de la personne, au nom de l’utilisateur)', 'invalid_args');
  return v;
}

/** Les étiquettes données à un outil, chacune vérifiée (le serveur ne valide pas le schéma) : 50 au plus, 64 caractères. */
function etiquettesDonnees(v: unknown): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > ETIQUETTES_MAX) throw new RefusOutil(`tags : une liste de ${ETIQUETTES_MAX} étiquettes au plus`, 'invalid_args');
  return v.map((t: unknown) => {
    if (typeof t !== 'string' || t.trim() === '' || t.length > LONGUEUR_MAX_ETIQUETTE_OUTIL) {
      throw new RefusOutil(`tags : chaque étiquette est un texte de 1 à ${LONGUEUR_MAX_ETIQUETTE_OUTIL} caractères`, 'invalid_args');
    }
    return t;
  });
}

/** Un refus d'une route (son statut, son corps `{ error, code?, upgradeUrl? }`) en refus d'outil, l'adresse de l'offre comprise. */
function refusDuCorps(statut: number, corps: Record<string, unknown>, defaut: string): RefusOutil {
  return refusDuCoeur({
    statut, message: typeof corps.error === 'string' ? corps.error : defaut,
    ...(typeof corps.code === 'string' ? { code: corps.code } : {}),
    ...(typeof corps.upgradeUrl === 'string' ? { upgradeUrl: corps.upgradeUrl } : {}),
  });
}

/** Le mapping de l'import vers une liste (le schéma d'un outil n'a pas de table libre), et retour. */
type ColonneDonnee = { header: string; target: 'phone' | 'name' | 'custom' | 'ignore'; key?: string };
const mappingEnListe = (m: ColumnMapping): ColonneDonnee[] =>
  Object.entries(m.columns).map(([header, c]) => ({ header, target: c.target, ...(c.target === 'custom' && c.key ? { key: c.key } : {}) }));
function mappingDonne(v: unknown): ColumnMapping | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length === 0 || v.length > COLONNES_MAX) throw new RefusOutil(`mapping : une liste de 1 à ${COLONNES_MAX} colonnes`, 'invalid_args');
  const columns: ColumnMapping['columns'] = {};
  for (const brut of v as unknown[]) {
    const c = brut as { header?: unknown; target?: unknown; key?: unknown } | null;
    if (typeof c?.header !== 'string' || c.header === '' || c.header.length > LONGUEUR_MAX_ENTETE) {
      throw new RefusOutil(`mapping : chaque colonne porte son en-tête (header, ${LONGUEUR_MAX_ENTETE} caractères au plus)`, 'invalid_args');
    }
    if (Object.hasOwn(columns, c.header)) throw new RefusOutil(`mapping : la colonne « ${c.header} » est donnée deux fois`, 'invalid_args');
    if (c.target === 'custom') {
      if (typeof c.key !== 'string' || c.key.trim() === '' || c.key.length > LONGUEUR_MAX_CLE_CHAMP) {
        throw new RefusOutil(`mapping : la colonne « ${c.header} » vers un champ porte sa clé (key)`, 'invalid_args');
      }
      columns[c.header] = { target: 'custom', key: c.key.trim() };
    } else if (c.target === 'phone' || c.target === 'name' || c.target === 'ignore') {
      columns[c.header] = { target: c.target };
    } else {
      throw new RefusOutil(`mapping : la cible de « ${c.header} » est phone, name, custom ou ignore`, 'invalid_args');
    }
  }
  return avecTelephone({ columns });
}

/** Un mapping sans colonne de téléphone écarterait chaque ligne, après avoir créé les champs nommés : refusé (l'écran grise son bouton). */
function avecTelephone(m: ColumnMapping): ColumnMapping {
  if (!Object.values(m.columns).some((c) => c.target === 'phone')) {
    throw new RefusOutil('mapping : aucune colonne de téléphone (target phone), chaque ligne serait écartée', 'invalid_args');
  }
  return m;
}

/** L'identifiant d'une fiche : un uuid, sinon un refus lisible plutôt qu'une erreur de la base. */
function ficheDonnee(args: Record<string, unknown>): string {
  const id = texteObligatoire(args, 'contact_id', LONGUEUR_MAX_ID_FICHE);
  if (!estUuid(id)) throw new RefusOutil('contact_id : l’identifiant d’une fiche (search_contacts, get_contact)', 'invalid_args');
  return id;
}
/** Un uuid, et la borne que le schéma annonce ; exportée pour le test des bornes. */
export const LONGUEUR_MAX_ID_FICHE = 36;
/** L'identifiant d'un appel de connecteur, ou « none » ; exportée pour le test des bornes. */
export const LONGUEUR_MAX_ID_REQUETE = 64;
const FICHE = { contact_id: { type: 'string' as const, minLength: 1, maxLength: LONGUEUR_MAX_ID_FICHE, description: 'The contact id (search_contacts, get_contact).' } };

/**
 * Une erreur du lecteur de CSV porte son statut 4xx (trop gros, lecture interrompue, trop de lectures en cours) : elle
 * devient un refus lisible, avec son délai quand elle est passagère, jamais un « échec interne de l'outil ».
 */
async function lectureCsv<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    const statut = (e as { statusCode?: unknown } | null)?.statusCode;
    if (typeof statut === 'number' && statut >= 400 && statut < 500) throw refusDuCoeur({ statut, message: texteDe(e) });
    throw e;
  }
}

/** Le nombre d'effacements que le client accepte (`delete_oldest`), s'il en donne un. */
function effacementsAcceptes(v: unknown): number | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    throw new RefusOutil('delete_oldest : un entier positif, le nombre d’effacements que le client accepte', 'invalid_args');
  }
  return v;
}

/** Une étiquette, bornée comme la pose (64 caractères) ; exportée pour le test des bornes annoncées. */
export const LONGUEUR_MAX_ETIQUETTE_OUTIL = LONGUEUR_MAX_ETIQUETTE;
const ETIQUETTE = { type: 'string' as const, minLength: 1, maxLength: LONGUEUR_MAX_ETIQUETTE_OUTIL };

export const OUTILS_FICHES: OutilMcp[] = [
  {
    ...ficheOutilMcp('list_tags'),
    fonction: null,
    description: 'The tags of the workspace, each with the number of contacts carrying it: those put on contacts and those '
      + 'declared without any contact yet (Content > Tags in the console). A segment is a tag: tag_contacts puts one on a '
      + 'target of contacts.',
    annotations: lecture('List tags'),
    entree: { type: 'object', properties: {}, additionalProperties: false },
    async executer(deps, tenantId) {
      const tags = await deps.referentielEtiquettes.listDistinct(tenantId);
      return { tags: tags.map((t) => ({ tag: t.tag, contacts: t.count })) };
    },
  },
  {
    ...ficheOutilMcp('rename_tag'),
    fonction: null,
    description: 'Renames a tag on every contact that carries it, as Content > Tags does. If the new name already exists, '
      + 'the two tags merge, which cannot be undone: list_tags first. Automations, scenarios and campaign targets that '
      + 'name the old tag are not renamed: they keep the old name. Starts no automation. Returns how many contacts were '
      + 'renamed.',
    annotations: ecriture('Rename a tag', true, false),
    entree: {
      type: 'object',
      properties: {
        from: { ...ETIQUETTE, description: 'The current tag (list_tags).' },
        to: { ...ETIQUETTE, description: 'The new name.' },
      },
      required: ['from', 'to'],
      additionalProperties: false,
    },
    ecran: () => LISTES.etiquettes,
    async executer(deps, tenantId, args, personne) {
      signataire(personne);
      const de = texteObligatoire(args, 'from', LONGUEUR_MAX_ETIQUETTE_OUTIL);
      const vers = texteObligatoire(args, 'to', LONGUEUR_MAX_ETIQUETTE_OUTIL);
      const r = await renommerEtiquette(deps.referentielEtiquettes, tenantId, de, vers);
      if (!r.ok) throw new RefusOutil(r.erreur, familleDuRefus(r.statut));
      return { renamed: r.valeur.renamed };
    },
  },
  {
    ...ficheOutilMcp('delete_tag'),
    fonction: null,
    description: 'Removes a tag from every contact that carries it, and from the declared tags, as Content > Tags does. It '
      + 'cannot be undone: list_tags tells how many contacts carry it. Starts no automation. Returns how many contacts '
      + 'lost the tag.',
    annotations: ecriture('Delete a tag', true, false),
    entree: {
      type: 'object',
      properties: { tag: { ...ETIQUETTE, description: 'The tag to delete (list_tags).' } },
      required: ['tag'],
      additionalProperties: false,
    },
    ecran: () => LISTES.etiquettes,
    async executer(deps, tenantId, args, personne) {
      signataire(personne);
      const tag = texteObligatoire(args, 'tag', LONGUEUR_MAX_ETIQUETTE_OUTIL);
      const r = await supprimerEtiquette(deps.referentielEtiquettes, tenantId, tag);
      if (!r.ok) throw new RefusOutil(r.erreur, familleDuRefus(r.statut));
      return { removed: r.valeur.removed };
    },
  },
  {
    ...ficheOutilMcp('create_contact'),
    fonction: null,
    description: 'Adds a contact by hand, as the console does: the phone with its country code (+33612345678), opt_in, and '
      + 'if needed a name, custom fields (existing keys, values matching their type, no json field: list_fields) and tags. '
      + 'A number already known updates its record instead (status "updated"): the name and the fields given, the tags '
      + 'added. opt_in is required: true declares, on the user\'s behalf and under their responsibility, that the person '
      + 'agreed to receive marketing messages; false declares nothing and leaves a known record\'s consent as it is. A '
      + 'person who sent STOP stays unsubscribed. The plan\'s contact limit applies: on a full Business or Enterprise '
      + 'workspace set so that the oldest contact makes room, each new contact deletes the oldest one for good. Starts no '
      + 'automation.',
    annotations: ecriture('Create a contact', true, false),
    entree: {
      type: 'object',
      properties: {
        phone: { type: 'string', pattern: TELEPHONE_E164.source, description: 'The number with the country code.' },
        name: { type: 'string', minLength: 1, maxLength: LONGUEUR_MAX_NOM_CONTACT, description: 'The contact name.' },
        fields: {
          type: 'array', maxItems: CHAMPS_MAX,
          items: {
            type: 'object',
            properties: {
              key: { type: 'string', minLength: 1, maxLength: LONGUEUR_MAX_CLE_CHAMP, description: 'The field key (list_fields).' },
              value: { type: 'string', minLength: 1, maxLength: LONGUEUR_MAX_VALEUR_SAISIE, description: 'The value, matching the field type (a json field cannot be filled here).' },
            },
            required: ['key', 'value'],
            additionalProperties: false,
          },
          description: 'Custom field values: one { key, value } per field (list_fields), each matching the field type.',
        },
        tags: { type: 'array', maxItems: ETIQUETTES_MAX, items: ETIQUETTE, description: 'Tags to put on the contact.' },
        opt_in: { type: 'boolean', description: 'Required. true: the user declares that the person agreed to marketing messages. false: nothing is declared.' },
      },
      required: ['phone', 'opt_in'],
      additionalProperties: false,
    },
    ecran: () => LISTES.contacts,
    async executer(deps, tenantId, args, personne) {
      const userId = signataire(personne);
      // Le serveur ne valide pas le schéma (il ne refuse que les clés inconnues) : chaque type se vérifie ici.
      const phone = typeof args.phone === 'string' ? args.phone.trim() : '';
      if (!TELEPHONE_E164.test(phone)) throw new RefusOutil('phone : le numéro avec son indicatif, au format +33612345678', 'invalid_args');
      const optIn = accordDit(args.opt_in);
      const name = args.name === undefined ? undefined : texteObligatoire(args, 'name', LONGUEUR_MAX_NOM_CONTACT);
      // Les champs, de la liste { key, value } vers la saisie de la console : une clé deux fois est refusée, jamais écrasée.
      const fields: Record<string, string> = {};
      if (args.fields !== undefined) {
        if (!Array.isArray(args.fields) || args.fields.length > CHAMPS_MAX) throw new RefusOutil(`fields : une liste de ${CHAMPS_MAX} champs au plus`, 'invalid_args');
        for (const f of args.fields as unknown[]) {
          const c = f as { key?: unknown; value?: unknown } | null;
          if (typeof c?.key !== 'string' || typeof c.value !== 'string') throw new RefusOutil('fields : chaque élément porte key et value, en texte', 'invalid_args');
          if (Object.hasOwn(fields, c.key)) throw new RefusOutil(`fields : la clé « ${c.key} » est donnée deux fois`, 'invalid_args');
          fields[c.key] = c.value;
        }
      }
      const tags = etiquettesDonnees(args.tags);
      const r = await creerContactALaMain(
        {
          champs: deps.champs, createOneContact: deps.createOneContact, audit: deps.journal,
          // Appelée sur son objet : détachée, une méthode perdrait son `this`.
          ensureSocleField: (t, cle, libelle, type) => deps.ensureSocleField(t, cle, libelle, type),
        },
        tenantId,
        { phone, name, fields, tags, optIn },
        { auth: { userId } },
      );
      if (!r.ok) throw refusDuCorps(r.statut, r.corps, 'contact refusé');
      return { status: r.corps.status, contact_id: r.corps.contactId ?? null };
    },
  },
  {
    ...ficheOutilMcp('preview_contacts_import'),
    fonction: null,
    description: 'Reads a CSV of contacts without writing anything, exactly as import_contacts will read it: its columns, '
      + 'the first rows, the row count, the mapping it proposes (each column to phone, name, a custom field or ignore) '
      + 'and, when the workspace makes room for new contacts by deleting the oldest, how many new numbers the file '
      + 'carries, how many places are free and how many of the oldest contacts the import would delete for good '
      + '(oldest_deleted, which import_contacts asks to accept). Then import_contacts, with this mapping or a corrected '
      + 'one. ' + LOURDE,
    annotations: lecture('Preview a contacts import'),
    entree: {
      type: 'object',
      properties: { csv: { type: 'string', minLength: 1, maxLength: LONGUEUR_MAX_CSV_OUTIL, description: 'The CSV text, first line = headers. 200,000 characters at most: split a bigger file.' } },
      required: ['csv'],
      additionalProperties: false,
    },
    async executer(deps, tenantId, args) {
      // Vérifié (non vide, borné) mais passé TEL QUEL : rogné, un TSV dont la première cellule d'en-tête est vide (un index
      // exporté, A1 vide sous Excel) glisserait d'une colonne, et la lecture ne serait plus celle de la console.
      texteObligatoire(args, 'csv', LONGUEUR_MAX_CSV_OUTIL);
      const csv = typeof args.csv === 'string' ? args.csv : '';
      await plafondCouteux(deps, tenantId);
      const r = await lectureCsv(() => apercuImport(deps.importCsv, tenantId, csv));
      if (!r.ok) throw refusDuCorps(r.statut, r.corps, 'aperçu impossible');
      const { headers, sampleRows, rowCount, mapping, remplacement } = r.valeur;
      return {
        headers, sample_rows: sampleRows, row_count: rowCount, mapping: mappingEnListe(mapping),
        ...(remplacement ? {
          replacement: {
            new_numbers: remplacement.nouveaux, free_places: remplacement.placesLibres,
            oldest_deleted: Math.max(0, remplacement.nouveaux - remplacement.placesLibres),
          },
        } : {}),
      };
    },
  },
  {
    ...ficheOutilMcp('import_contacts'),
    fonction: null,
    description: 'Imports a CSV of contacts, as the import of the console does: a new number creates its record, a number '
      + 'already known updates it (the name and the fields of the file, the tags added). mapping is the one '
      + 'preview_contacts_import proposed, or a corrected one (100 columns at most, a phone column required, a column left '
      + 'out is ignored); without it, the columns are recognized from the headers and every column that is not recognized '
      + 'becomes a custom field. A custom field named in the mapping that does not exist yet is created. opt_in is '
      + 'required: true declares, on the user\'s behalf and under their responsibility, that every person of the file '
      + 'agreed to receive marketing messages; false declares nothing and leaves known records as they are. A person who '
      + 'sent STOP stays unsubscribed, always. The plan\'s contact limit applies to the whole file (nothing is written if '
      + 'it does not fit). On a full Business or Enterprise workspace set so that the oldest contact makes room, the import '
      + 'would delete the oldest contacts for good, with their conversations: it is then refused with their number, and '
      + 'passes only with delete_oldest set to at least that number, the deletions the user accepted. Starts no '
      + 'automation. Returns how many records were created, updated and skipped (with the line and reason of each skipped '
      + 'one) and how many of the oldest were deleted. ' + LOURDE,
    annotations: ecriture('Import contacts', true, false),
    entree: {
      type: 'object',
      properties: {
        csv: { type: 'string', minLength: 1, maxLength: LONGUEUR_MAX_CSV_OUTIL, description: 'The CSV text, first line = headers. 200,000 characters at most: split a bigger file.' },
        mapping: {
          type: 'array', minItems: 1, maxItems: COLONNES_MAX,
          items: {
            type: 'object',
            properties: {
              header: { type: 'string', minLength: 1, maxLength: LONGUEUR_MAX_ENTETE, description: 'The column header, as in the file.' },
              target: { type: 'string', enum: ['phone', 'name', 'custom', 'ignore'], description: 'What the column fills.' },
              key: { type: 'string', minLength: 1, maxLength: LONGUEUR_MAX_CLE_CHAMP, description: 'For a custom target: the field key (list_fields).' },
            },
            required: ['header', 'target'],
            additionalProperties: false,
          },
          description: 'One entry per column, as preview_contacts_import returns it.',
        },
        tags: { type: 'array', maxItems: ETIQUETTES_MAX, items: ETIQUETTE, description: 'Tags put on every contact of the file.' },
        opt_in: { type: 'boolean', description: 'Required. true: the user declares that every person of the file agreed to marketing messages. false: nothing is declared.' },
        delete_oldest: { type: 'integer', minimum: 0, description: 'Only when the workspace makes room: how many of the oldest contacts the user accepts to delete for good (the number the refusal or preview_contacts_import gave).' },
      },
      required: ['csv', 'opt_in'],
      additionalProperties: false,
    },
    ecran: () => LISTES.contacts,
    async executer(deps, tenantId, args, personne) {
      const userId = signataire(personne);
      texteObligatoire(args, 'csv', LONGUEUR_MAX_CSV_OUTIL);
      const csv = typeof args.csv === 'string' ? args.csv : ''; // tel quel, comme à l'aperçu
      const optIn = accordDit(args.opt_in);
      const donne = mappingDonne(args.mapping);
      const tags = etiquettesDonnees(args.tags);
      const accepte = effacementsAcceptes(args.delete_oldest);
      await plafondCouteux(deps, tenantId);
      // Le mapping que l'import emploiera : celui donné, sinon celui des en-têtes, lu comme l'aperçu le lit.
      let mapping = donne;
      if (mapping === undefined) {
        const a = await lectureCsv(() => apercuImport(deps.importCsv, tenantId, csv));
        if (!a.ok) throw refusDuCorps(a.statut, a.corps, 'import refusé');
        mapping = a.valeur.mapping;
      }
      const choisi = avecTelephone(mapping);
      // 🔴 LE PLUS ANCIEN LAISSE SA PLACE (décision du 2026-11-24) : un import qui effacerait des fiches l'annonce AVANT
      // d'écrire, comme l'aperçu de la console avant sa confirmation, et ne passe qu'avec l'accord dit de ce nombre.
      const effaces = await lectureCsv(() => effacementsDeLImportPour(deps.importCsv, tenantId, csv, choisi));
      if (effaces > 0 && (accepte === undefined || accepte < effaces)) {
        throw new RefusOutil(
          `Cet import effacerait pour de bon ${effaces === 1 ? 'le contact le plus ancien' : `les ${effaces} contacts les plus anciens`} `
          + `de l’espace, avec ${effaces === 1 ? 'ses' : 'leurs'} conversations, pour faire de la place (l’espace est plein et le `
          + `plus ancien y laisse sa place) : dites-le au client, et relancez avec delete_oldest: ${effaces} s’il l’accepte.`,
          'conflict',
        );
      }
      // 🔴 `import`, jamais `import_csv_coche` : depuis Claude, un import ne réabonne personne qui a dit STOP.
      const r = await lectureCsv(() => importerCsv(
        { ...deps.importCsv, audit: deps.journal }, tenantId, { csv, mapping: choisi, tags, optIn }, 'import', { auth: { userId } },
      ));
      if (!r.ok) throw refusDuCorps(r.statut, r.corps, 'import refusé');
      return { created: r.valeur.created, updated: r.valeur.updated, skipped: r.valeur.skipped, errors: r.valeur.errors, oldest_deleted: effaces };
    },
  },
  {
    ...ficheOutilMcp('list_unsubscribed_contacts'),
    fonction: null,
    description: 'The contacts who asked not to be contacted any more, most recent first (500 at most): name, number, when '
      + '(null for refusals older than that date) and where the refusal came from (whatsapp_stop: the person sent STOP; '
      + 'crm: set by the team; scenario, flow or webhook:<name>: through a scenario, a form or a tool; liste_de_refus: the '
      + 'STOP of an erased record, kept). They receive no marketing message.',
    annotations: lecture('List unsubscribed contacts'),
    entree: { type: 'object', properties: {}, additionalProperties: false },
    async executer(deps, tenantId) {
      const liste = await deps.listesContacts.listeDesabonnes(tenantId);
      return {
        contacts: liste.map((c) => ({ id: c.id, name: c.profileName, phone: c.phoneE164, unsubscribed_at: c.desabonneLe, source: c.source })),
      };
    },
  },
  {
    ...ficheOutilMcp('list_possible_refusals'),
    fonction: null,
    description: 'Inbound messages of the last 30 days that may be a request to stop without being a clear STOP (the strict '
      + 'rule did not apply), for a person to read and decide: nobody was unsubscribed. scanned says how many messages '
      + 'were read (2,000 at most): an empty list after reading few messages does not mean the same as after reading many.',
    annotations: lecture('List possible refusals'),
    entree: { type: 'object', properties: {}, additionalProperties: false },
    async executer(deps, tenantId) {
      const r = await refusPossibles(deps.listesContacts, tenantId);
      return {
        scanned: r.scannes,
        refusals: r.refus.map((m) => ({
          message_id: m.messageId, conversation_id: m.conversationId, contact_id: m.contactId, wa_id: m.waId,
          name: m.profileName, text: m.body, received_at: m.recuLe,
        })),
      };
    },
  },
  {
    ...ficheOutilMcp('list_blocked_contacts'),
    fonction: null,
    description: 'The blocked contacts, most recently blocked first: nothing is sent to them and they no longer appear in '
      + 'the contact lists. block_contact unblocks one.',
    annotations: lecture('List blocked contacts'),
    entree: { type: 'object', properties: {}, additionalProperties: false },
    async executer(deps, tenantId) {
      const liste = await deps.listesContacts.listBlocked(tenantId);
      return { contacts: liste.map((c) => ({ id: c.id, name: c.profileName, phone: c.phoneE164, blocked_at: c.blockedAt })) };
    },
  },
  {
    ...ficheOutilMcp('get_contact_history'),
    fonction: null,
    description: 'The history of a contact, as on its record: the sends it received (campaign, template or scenario, '
      + 'status, dates) and the conversations it had.',
    annotations: lecture('Read a contact history'),
    entree: { type: 'object', properties: { ...FICHE }, required: ['contact_id'], additionalProperties: false },
    async executer(deps, tenantId, args) {
      const historique = await deps.historiqueContacts.getContactHistory(tenantId, ficheDonnee(args));
      if (!historique) throw new RefusOutil('contact inconnu dans cet espace', 'not_found');
      return historique;
    },
  },
  {
    ...ficheOutilMcp('get_contact_report'),
    fonction: null,
    description: 'The report of a contact, as on its record: what its campaign sends cost (an estimate from Meta\'s rates, '
      + 'a floor and not an invoice; null when nothing could be priced, never a zero that would read free, with how many '
      + 'sends had no category or no rate) and its engagement funnel (how many journeys reached at least each level of '
      + 'exchange, five at most; empty when none started). Asks Meta for its rates.',
    annotations: lecture('Read a contact report', true),
    entree: { type: 'object', properties: { ...FICHE }, required: ['contact_id'], additionalProperties: false },
    async executer(deps, tenantId, args) {
      const b = await deps.bilanContact.getBilanContact(tenantId, ficheDonnee(args));
      if (!b) throw new RefusOutil('contact inconnu dans cet espace', 'not_found');
      return {
        cost: {
          sent: b.cout.envoyes, estimate: b.cout.cout, currency: b.cout.currency, not_priced: b.cout.nonChiffrables,
          without_category: b.cout.sansCategorie, without_rate: b.cout.sansTarif,
        },
        funnel: b.entonnoir.map((n) => ({ level: n.niveau, journeys: n.parcours })),
      };
    },
  },
  {
    ...ficheOutilMcp('export_contact_history'),
    fonction: null,
    description: 'The sends of a contact, up to 5,000 (campaign, template or scenario, status, dates), for a GDPR access '
      + 'request. The export is recorded in the audit log under the user\'s name, as made through Claude: the count, '
      + 'never the content. ' + LOURDE,
    annotations: lecture('Export a contact history'),
    entree: { type: 'object', properties: { ...FICHE }, required: ['contact_id'], additionalProperties: false },
    async executer(deps, tenantId, args, personne) {
      const userId = signataire(personne);
      const contactId = ficheDonnee(args);
      await plafondCouteux(deps, tenantId);
      const r = await exporterHistorique(
        { contactHistory: deps.historiqueContacts, audit: deps.journal }, tenantId, contactId, { auth: { userId } },
        { via: 'mcp', ...(personne?.autorisationId ? { autorisation: personne.autorisationId } : {}) },
      );
      if (!r) throw new RefusOutil('contact inconnu dans cet espace', 'not_found');
      return r;
    },
  },
  {
    ...ficheOutilMcp('get_optout_push'),
    fonction: null,
    description: 'The connector call notified at each unsubscription, if any (request_id, null for none), and the connector '
      + 'calls of the workspace that can be chosen (id, label). At each unsubscription, that call receives the number of '
      + 'the person and what it reads from the record (name, tags, fields): data that leaves for that third party. '
      + 'set_optout_push changes it, on the click of an administrator.',
    annotations: lecture('Read the unsubscription push'),
    entree: { type: 'object', properties: {}, additionalProperties: false },
    async executer(deps, tenantId) {
      const p = deps.misesEnLigne.envois.pousseeOptout;
      const [actuelle, appels] = await Promise.all([p.actuelle(tenantId), p.lister(tenantId)]);
      return { request_id: actuelle, requests: appels.map((a) => ({ id: a.id, label: a.label })) };
    },
  },
  {
    ...ficheOutilMcp('set_optout_push'),
    fonction: null,
    description: 'Prepares the choice of the connector call notified at each unsubscription (an id from get_optout_push), '
      + 'or "none" to notify none. Nothing changes until an administrator clicks the button of the go_live link in the '
      + 'console, after reading what will leave for that third party (the number of the person and what the call reads '
      + 'from the record). The click reads again that the call still exists in the workspace and that the setting has '
      + 'not changed since. get_go_live with go_live_id then tells what was done.',
    annotations: ecriture('Choose the unsubscription push', false, false),
    entree: {
      type: 'object',
      properties: {
        request_id: { type: 'string', minLength: 1, maxLength: LONGUEUR_MAX_ID_REQUETE, description: 'The connector call (get_optout_push), or "none".' },
      },
      required: ['request_id'],
      additionalProperties: false,
    },
    ecran: () => LISTES.consentement,
    async executer(deps, tenantId, args, personne) {
      signataire(personne);
      const brut = texteObligatoire(args, 'request_id', LONGUEUR_MAX_ID_REQUETE);
      // 🔴 Au oui : brancher un appel fait partir des données de contact chez un tiers. L'outil prépare, l'admin clique.
      const oui = valeurOuRefus(await proposer(
        deps.misesEnLigne, tenantId, personneRequise(personne), [{ type: 'poussee_optout', requete: brut === 'none' ? null : brut }],
      ));
      return {
        go_live: boutonDuOui(oui),
        a_savoir: `Rien n’a changé : un administrateur clique « ${oui.libelle} » dans la console, après avoir lu ce qui change. `
          + 'Après le clic, get_go_live avec go_live_id dit ce qui a été fait.',
      };
    },
  },
];
