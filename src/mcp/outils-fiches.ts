import { ficheOutilMcp } from '../../web/lib/partage/catalogue-mcp';
import type { AnnotationsMcp, OutilMcp } from './outils';
import { RefusOutil, familleDuRefus, refusDuCoeur, texteObligatoire } from './saisie';
import { ecriture, signataire } from './outils-agent';
import { renommerEtiquette, supprimerEtiquette, type TagsRouteDeps } from '../http/tags';
import { creerContactALaMain, type ContactsRouteDeps } from '../http/contacts';
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
 */
export interface DepsFichesMcp {
  /** Les étiquettes de l'espace : le MÊME magasin que la route (`PgTagStore`, passé entier : ses méthodes lisent `this`). */
  referentielEtiquettes: Pick<TagsRouteDeps, 'listDistinct' | 'rename' | 'remove'>;
  /** La création d'un contact à la main, la MÊME fonction que `POST /contacts` (l'upsert de la console). */
  createOneContact: ContactsRouteDeps['createOneContact'];
}

const lecture = (title: string): AnnotationsMcp => ({ title, readOnlyHint: true, openWorldHint: false });

/** Des étiquettes et des champs au plus par création, bornés comme l'import de la console. */
const ETIQUETTES_MAX = 50;
const CHAMPS_MAX = 50;
/** Le nom d'un contact, que la console coupe au même endroit (`creerContactALaMain`) ; exporté pour le test des bornes. */
export const LONGUEUR_MAX_NOM_CONTACT = 120;
/** Le numéro avec son indicatif : le schéma l'annonce et l'outil l'applique, par la même expression. */
const TELEPHONE_E164 = /^\+[1-9][0-9]{7,14}$/;

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
      // 🔴 L'accord se DIT : omis, il serait déclaré par défaut (la case que l'écran pré-coche sous les yeux de la
      // personne), et une fiche arrivée par un message passerait en « accepte » sans que personne l'ait dit.
      if (typeof args.opt_in !== 'boolean') throw new RefusOutil('opt_in : true ou false, obligatoire (true déclare l’accord de la personne, au nom de l’utilisateur)', 'invalid_args');
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
      const tags: string[] = [];
      if (args.tags !== undefined) {
        if (!Array.isArray(args.tags) || args.tags.length > ETIQUETTES_MAX) throw new RefusOutil(`tags : une liste de ${ETIQUETTES_MAX} étiquettes au plus`, 'invalid_args');
        for (const t of args.tags as unknown[]) {
          if (typeof t !== 'string' || t.trim() === '' || t.length > LONGUEUR_MAX_ETIQUETTE_OUTIL) {
            throw new RefusOutil(`tags : chaque étiquette est un texte de 1 à ${LONGUEUR_MAX_ETIQUETTE_OUTIL} caractères`, 'invalid_args');
          }
          tags.push(t);
        }
      }
      const r = await creerContactALaMain(
        {
          champs: deps.champs, createOneContact: deps.createOneContact, audit: deps.journal,
          // Appelée sur son objet : détachée, une méthode perdrait son `this`.
          ensureSocleField: (t, cle, libelle, type) => deps.ensureSocleField(t, cle, libelle, type),
        },
        tenantId,
        { phone, name, fields, tags, optIn: args.opt_in },
        { auth: { userId } },
      );
      if (!r.ok) {
        const c = r.corps as { error?: unknown; code?: unknown; upgradeUrl?: unknown };
        throw refusDuCoeur({
          statut: r.statut, message: typeof c.error === 'string' ? c.error : 'contact refusé',
          ...(typeof c.code === 'string' ? { code: c.code } : {}),
          ...(typeof c.upgradeUrl === 'string' ? { upgradeUrl: c.upgradeUrl } : {}),
        });
      }
      return { status: r.corps.status, contact_id: r.corps.contactId ?? null };
    },
  },
];
