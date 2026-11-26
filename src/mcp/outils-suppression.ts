import { FICHES_DE_L_APERCU, MAX_FICHES_PAR_SUPPRESSION, ficheOutilMcp } from '../../web/lib/partage/catalogue-mcp';
import type { DepsMcp, OutilMcp, ProprieteEntree } from './outils';
import { RefusOutil, limiteEntiere, valeurOuRefus } from './saisie';
import { CHAMPS_CIBLE_FILTRES, CHAMPS_CIBLE_IDENTIFIANTS, MAX_IDENTIFIANTS_CIBLE, lireCibleMcp } from './cible';
import { ecriture, LOURDE, personneRequise, plafondCouteux, signataire } from './outils-agent';
import type { BulkTarget, FicheASupprimer } from '../crm/contact-store.pg';
import { DROITS, type Fonction } from '../offres/offres';
import { numeroMasque } from '../emails-produit/alertes';
import { estUuid } from '../http/scope';
import { lireVue, proposer, reprendre } from '../mise-en-ligne/mise-en-ligne';
import { boutonDuOui } from './outils-mise-en-ligne';
import { LISTES } from './ecran';

/**
 * LA SUPPRESSION DE CONTACTS EN MASSE DEPUIS CLAUDE (plan `docs/superpowers/plans/2026-10-26-free-au-dela-de-100-contacts.md`,
 * décisions de Julien du 2026-10-26) : un espace revenu en Free au-delà de sa limite ne crée plus rien, et un nouveau
 * client qui écrit n'y entre pas, tant qu'il n'a pas supprimé ce qui dépasse. La Free n'a pas la console : c'est Claude
 * qui supprime, d'un coup, une sélection (les plus anciens, une étiquette, une liste).
 *
 * 🔴 PAS DE CRITÈRE D'INACTIVITÉ (relecture du lot, 2026-10-26). Le seul « dernier message » qu'on ait est celui des fils
 * (`conversations.last_message_at`), or la conservation les purge (30 jours en Free) et la déconnexion du numéro les
 * efface tous : un client qui a écrit il y a trois mois paraîtrait « jamais actif », et l'outil effacerait des clients
 * actifs. `inactive_days` est donc une clé inconnue, refusée comme les autres. L'inactivité reviendra quand la fiche
 * gardera sa propre date de dernier message (`todo.md`).
 *
 * Sur le motif des campagnes, et au oui depuis B8 (lot 1 du CSM virtuel, décisions de Julien du 2026-11-26 : le code de
 * confirmation a disparu) : `prepare_contacts_deletion` montre le compte et un échantillon, et rend le bouton du oui ;
 * rien n'est effacé avant le clic d'un admin dans la console, qui relit les fiches et refuse si elles ont changé, puis
 * efface par `effacerContacts` (`src/mise-en-ligne/envois.ts`), l'effacement de la purge de la console et de
 * `DELETE /v1/contacts/{id}` : la même limite du jour (levée tant que l'espace dépasse sa limite de contacts,
 * `QuotaSuppressions`), la même purge, le même retrait chez l'agent de Meta, la même ligne d'audit. `delete_contacts`
 * rend ce que le clic a fait, et reprend un effacement coupé. La page du oui est ouverte à la Free : c'est elle qui en a
 * besoin (`MODULES_OUVERTS_AU_FREE`).
 *
 * 🔴 Une personne nommée (`exigePersonne`, un jeton OAuth d'administrateur, jamais une clé d'API) : une clé branchée sur un
 * agent qui lit des messages de clients ne doit pas pouvoir effacer l'espace sur l'injection d'un message. Ouverts à
 * toutes les offres : c'est la Free qui en a besoin.
 */

// Les fiches au plus par appel (`MAX_FICHES_PAR_SUPPRESSION`) et celles de l'aperçu (`FICHES_DE_L_APERCU`) viennent du
// catalogue partagé : la documentation publique les cite.
/** La limite du jour de la Free, lue dans la grille, que les descriptions citent. */
const SUPPRESSIONS_DU_JOUR = DROITS.base.limites.suppressionsJour ?? 0;

export interface DepsSuppressionMcp {
  /** Les fiches vivantes d'une sélection, DANS l'espace, les plus anciennes d'abord (`PgContactStore.selectionAEffacer`). */
  selection(tenantId: string, cible: BulkTarget, limite: number): Promise<FicheASupprimer[]>;
}

/** Les critères d'une sélection : ceux de la cible d'une campagne, sans l'analyse ni les conversations, et `oldest`. */
const CLES_DE_SELECTION = ['tags', 'tag_mode', 'opt_in', 'contact_ids', 'oldest'] as const;

/** Les paramètres de la sélection, annoncés par les deux outils. Toute borne appliquée ici y figure. */
const CHAMPS_DE_SELECTION: Record<(typeof CLES_DE_SELECTION)[number], ProprieteEntree> = {
  tags: { ...CHAMPS_CIBLE_FILTRES.tags!, description: 'Contacts carrying these tags.' },
  tag_mode: CHAMPS_CIBLE_FILTRES.tag_mode!,
  opt_in: { ...CHAMPS_CIBLE_FILTRES.opt_in!, description: 'Marketing consent of the contacts: opted_in, opted_out (they replied STOP) or unknown.' },
  contact_ids: {
    ...CHAMPS_CIBLE_IDENTIFIANTS.contact_ids!,
    description: `Contacts by id (contact_id of list_conversations, id of search_contacts), ${MAX_IDENTIFIANTS_CIBLE} at most. `
      + 'Not combined with tags or opt_in; oldest narrows them.',
  },
  oldest: {
    type: 'integer', minimum: 1, maximum: MAX_FICHES_PAR_SUPPRESSION,
    description: 'Keeps the N oldest contacts of the selection, by creation date.',
  },
};

/** L'analyse n'est pas un critère de ces outils : `lireCibleMcp` ne reçoit aucune fonction à ouvrir. */
const SANS_ANALYSE: ReadonlySet<Fonction> = new Set();

const present = (v: unknown): boolean => v !== undefined && v !== null;

/** Une sélection lue, avant toute lecture en base. */
interface SelectionLue {
  args: Record<string, unknown>;
  parCible: boolean;
  plusAnciennes: number | null;
}

/**
 * Lit une sélection, sans rien lire en base. 🔴 Une clé inconnue est REFUSÉE, jamais ignorée : un critère jeté (une
 * analyse, des conversations, une inactivité) élargirait ce qu'on efface. Sans aucun critère, refusée : ce ne sera jamais
 * « tout l'espace ».
 */
function lireSelection(args: Record<string, unknown>): SelectionLue {
  const permises: readonly string[] = CLES_DE_SELECTION;
  const inconnues = Object.keys(args).filter((k) => !permises.includes(k));
  if (inconnues.length > 0) throw new RefusOutil(`paramètre inconnu : ${inconnues.join(', ')} (la sélection se fait par ${permises.join(', ')})`, 'invalid_args');
  if (present(args.tag_mode) && !present(args.tags)) throw new RefusOutil('paramètre « tag_mode » : il ne vaut qu’avec tags', 'invalid_args');
  if (Array.isArray(args.tags) && args.tags.length === 0) throw new RefusOutil('paramètre « tags » : au moins une étiquette, ou pas de paramètre', 'invalid_args');
  const plusAnciennes = present(args.oldest) ? limiteEntiere(args.oldest, 'oldest', 1, MAX_FICHES_PAR_SUPPRESSION) : null;
  const parCible = ['tags', 'opt_in', 'contact_ids'].some((k) => present(args[k]));
  if (!parCible && plusAnciennes === null) {
    throw new RefusOutil('précisez au moins un critère : tags, opt_in, contact_ids ou oldest', 'invalid_args');
  }
  return { args, parCible, plusAnciennes };
}

/**
 * Les fiches d'une sélection, DANS l'espace. La cible passe par l'analyseur des campagnes (`lireCibleMcp`, donc
 * `parseBulkTarget`) ; sans aucun de ses critères, c'est tout l'espace, que `oldest` resserre.
 */
async function resoudreSelection(deps: DepsMcp, tenantId: string, s: SelectionLue): Promise<FicheASupprimer[]> {
  const cible: BulkTarget = s.parCible
    ? await lireCibleMcp(s.args, SANS_ANALYSE, deps, tenantId, { identifiants: true })
    : { filters: {}, excludeIds: [] };
  // Une de plus que le plafond, sans `oldest` : c'est elle qui dit que la sélection le dépasse.
  const fiches = await deps.suppression.selection(tenantId, cible, s.plusAnciennes ?? MAX_FICHES_PAR_SUPPRESSION + 1);
  if (fiches.length > MAX_FICHES_PAR_SUPPRESSION) {
    throw new RefusOutil(`cette sélection compte plus de ${MAX_FICHES_PAR_SUPPRESSION} contacts : resserrez-la (oldest, tags), `
      + `${MAX_FICHES_PAR_SUPPRESSION} au plus par appel`, 'too_large');
  }
  return fiches;
}

const PLAFOND_DU_JOUR = `In Free, deletions are capped at ${SUPPRESSIONS_DU_JOUR} a day while the workspace is within its contact `
  + 'limit, and not capped while it is above it (get_plan: contactsEnTrop, the contacts above the limit).';

export const OUTILS_SUPPRESSION: OutilMcp[] = [
  {
    ...ficheOutilMcp('prepare_contacts_deletion'),
    fonction: null,
    description:
      'Prepares the deletion of a selection of contacts WITHOUT deleting anything. Returns how many contacts the '
      + `selection holds, ${FICHES_DE_L_APERCU} of them at most (name, masked number, creation date), and go_live, the `
      + 'button of its yes: the link of the console page where an administrator of the workspace clicks its delete '
      + 'button, which says how many contacts. NOTHING IS DELETED BEFORE THAT CLICK, which Claude cannot give: show the '
      + 'summary, then give the link. '
      + 'After the click, delete_contacts with go_live_id returns what was deleted. The selection: tags (all or any), '
      + 'marketing consent or a list of contact_ids, narrowed or not by oldest (the oldest contacts of the selection, by '
      + `creation date). At least one criterion is required, and a selection of more than ${MAX_FICHES_PAR_SUPPRESSION} `
      + 'contacts is refused: oldest narrows it. A deleted contact is never counted. Deleting is irreversible: the click '
      + `deletes exactly the contacts shown, and is refused if they changed since. ${PLAFOND_DU_JOUR} ${LOURDE}`,
    // Rien n'est effacé ni ne part chez un tiers ; chaque appel prépare un nouveau oui : pas idempotente. Destructrice pour
    // la règle du répertoire de Claude (une écriture du scope `mcp:write`, voir `AnnotationsMcp`), comme `prepare_campaign`.
    annotations: ecriture('Prepare a contact deletion', false, false),
    entree: { type: 'object', properties: { ...CHAMPS_DE_SELECTION }, additionalProperties: false },
    ecran: () => LISTES.contacts,
    async executer(deps, tenantId, args, personne) {
      signataire(personne);
      const selection = lireSelection(args);
      // Le plafond des opérations coûteuses, comme `prepare_campaign` : la sélection lit jusqu'au plafond de fiches, plus une.
      await plafondCouteux(deps, tenantId);
      const fiches = await resoudreSelection(deps, tenantId, selection);
      if (fiches.length === 0) throw new RefusOutil('aucun contact de cet espace ne correspond à cette sélection : rien à supprimer', 'conflict');
      // 🔴 Le oui (B8) : les identifiants des fiches montrées sont gardés (jamais leur nom ni leur numéro), et le clic les relit.
      const oui = valeurOuRefus(await proposer(deps.misesEnLigne, tenantId, personneRequise(personne), [{ type: 'suppression', contacts: fiches.map((f) => f.id) }]));
      return {
        count: fiches.length,
        // Les plus anciennes d'abord, comme la sélection : un numéro masqué, jamais entier (plan).
        sample: fiches.slice(0, FICHES_DE_L_APERCU).map((f) => ({
          name: f.profileName, phone: numeroMasque(f.phoneE164 ?? f.bsuid ?? ''), created_at: f.createdAt,
        })),
        go_live: boutonDuOui(oui),
        a_savoir: 'Rien n’a été supprimé. La suppression est définitive : chaque fiche part avec ses conversations, ses messages '
          + 'et son analyse. Montre l’échantillon à la personne, puis le lien : un administrateur clique « '
          + `${oui.libelle} » dans la console. Après le clic, delete_contacts avec go_live_id rend ce qui a été supprimé.`,
      };
    },
  },
  {
    ...ficheOutilMcp('delete_contacts'),
    fonction: null,
    description:
      'Returns what the click of an administrator did with a deletion prepared by prepare_contacts_deletion: the '
      + 'go_live_id of its summary. Nothing is deleted without that click in the console, which Claude cannot give. '
      + 'Clicked: how many contacts, conversations and messages were deleted (each contact erased with its conversations, '
      + 'messages and analysis, as by the deletion of the console; a contact who replied STOP stays unsubscribed if they '
      + 'come back). A click cut short by an outage resumes here, with the contacts that remain. Not clicked yet: refused, '
      + `the link waits for the click (24 hours after the preparation). ${PLAFOND_DU_JOUR} ${LOURDE}`,
    // Le même identifiant rend le même résultat, et une reprise n'efface que ce qui reste : idempotente. Monde ouvert : la
    // purge retire aussi les contacts de la liste de l'agent de Meta, chez Meta (comme `control_conversation`).
    annotations: ecriture('Delete contacts', true, true),
    entree: {
      type: 'object',
      properties: {
        go_live_id: { type: 'string', format: 'uuid', description: 'The go_live_id of the summary returned by prepare_contacts_deletion.' },
      },
      required: ['go_live_id'],
      additionalProperties: false,
    },
    ecran: () => LISTES.contacts,
    async executer(deps, tenantId, args, personne) {
      signataire(personne);
      // 🔴 Une clé de sélection n'est jamais ignorée : la sélection est celle que le bouton a montrée, rien d'autre.
      const inconnues = Object.keys(args).filter((k) => k !== 'go_live_id');
      if (inconnues.length > 0) {
        throw new RefusOutil(`paramètre inconnu : ${inconnues.join(', ')} (delete_contacts ne prend que go_live_id : la sélection est celle du bouton)`, 'invalid_args');
      }
      const goLiveId = args.go_live_id;
      if (!estUuid(goLiveId)) throw new RefusOutil('paramètre « go_live_id » : identifiant mal formé', 'invalid_args');
      // La nature du oui AVANT toute reprise : sinon un autre oui, accepté et coupé, serait exécuté puis refusé.
      const lu = valeurOuRefus(await lireVue(deps.misesEnLigne, tenantId, goLiveId));
      if (lu.actions.length !== 1 || lu.actions[0]?.type !== 'suppression') {
        throw new RefusOutil('ce oui ne porte pas sur une suppression de contacts', 'conflict');
      }
      let v = lu;
      if (lu.etat === 'proposee' || lu.etat === 'expiree' || lu.etat === 'interrompue') {
        // Le plafond des opérations coûteuses de la purge de la console : seule une reprise coupée efface encore.
        if (lu.etat === 'interrompue') await plafondCouteux(deps, tenantId);
        // 🔴 Jamais sans le clic : `reprendre` refuse une mise en ligne que personne n'a acceptée, et n'accepte jamais.
        v = valeurOuRefus(await reprendre(deps.misesEnLigne, tenantId, goLiveId));
      }
      const action = v.actions[0]!;
      const r = action.resultat;
      if (r === null) return { status: v.etat === 'en_cours' ? 'in_progress' : 'interrupted', go_live_id: v.id };
      if (!r.ok) throw new RefusOutil(r.message, r.code === 'plan_limit_reached' ? 'plan_limit' : 'conflict', { cause: r.code });
      // Impossible : une action de suppression ne rend que ce résultat. Une panne, jamais un refus ordinaire.
      if (r.etat !== 'supprimes') throw new Error(`delete_contacts : résultat inattendu « ${r.etat} » pour une suppression`);
      return { deleted: r.contacts, conversations: r.conversations, messages: r.messages };
    },
  },
];
