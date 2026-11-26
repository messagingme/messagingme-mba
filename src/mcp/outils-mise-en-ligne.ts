import { ficheOutilMcp } from '../../web/lib/partage/catalogue-mcp';
import { DELAI_SCENARIO_HEURES_MAX, DELAI_SCENARIO_HEURES_MIN } from '../../web/lib/partage/repondeur-modes';
import { estUuid } from '../http/scope';
import {
  ACTIONS_MAX, TYPES_ACTION, lireVue, proposer, type DemandeAction, type DepsMisesEnLigne, type VueMiseEnLigne,
} from '../mise-en-ligne/mise-en-ligne';
import { ECRANS, adresseEcran, lire } from './ecran';
import { ecriture, personneRequise } from './outils-agent';
import type { AnnotationsMcp, OutilMcp } from './outils';
import { RefusOutil, texteObligatoire, valeurOuRefus } from './saisie';

/**
 * LE OUI DE MISE EN LIGNE ET LES VERSIONS, DEPUIS CLAUDE (lot 1 du CSM virtuel, B2 et B3). 🔴 Aucun de ces outils ne
 * clique : `propose_go_live` prépare et rend le lien de la page de la console où un admin connecté clique ; le clic,
 * seul, publie et branche (`src/http/mises-en-ligne.ts`). La logique vit dans `src/mise-en-ligne/mise-en-ligne.ts`.
 */
export interface DepsMiseEnLigneMcp {
  misesEnLigne: DepsMisesEnLigne;
}

const lecture = (title: string): AnnotationsMcp => ({ title, readOnlyHint: true, openWorldHint: false });

const SCENARIO_INCONNU = 'scénario introuvable dans cet espace';

/** Une action telle que Claude l'écrit, lue sans `as` : un champ inattendu ou mal formé est refusé, jamais deviné. */
function demandeDe(brute: unknown, rang: number): DemandeAction {
  const ou = `action ${rang + 1}`;
  if (typeof brute !== 'object' || brute === null || Array.isArray(brute)) throw new RefusOutil(`${ou} : un objet est attendu`, 'invalid_args');
  const a: Record<string, unknown> = Object.fromEntries(Object.entries(brute));
  const inconnue = Object.keys(a).find((k) => !['type', 'scenario', 'version', 'delai_heures'].includes(k));
  if (inconnue !== undefined) throw new RefusOutil(`${ou} : paramètre inconnu « ${inconnue} »`, 'invalid_args');
  const scenario = texteObligatoire(a, 'scenario', 100);
  switch (a.type) {
    case 'publier':
      return { type: 'publier', scenario };
    case 'restaurer': {
      if (typeof a.version !== 'number' || !Number.isInteger(a.version) || a.version < 1) {
        throw new RefusOutil(`${ou} : « version » requise (un entier, le numéro rendu par list_scenario_versions)`, 'invalid_args');
      }
      return { type: 'restaurer', scenario, version: a.version };
    }
    case 'repondeur': {
      const h = a.delai_heures;
      if (h === undefined || h === null) return { type: 'repondeur', scenario };
      if (typeof h !== 'number' || !Number.isInteger(h) || h < DELAI_SCENARIO_HEURES_MIN || h > DELAI_SCENARIO_HEURES_MAX) {
        throw new RefusOutil(`${ou} : « delai_heures » va de ${DELAI_SCENARIO_HEURES_MIN} à ${DELAI_SCENARIO_HEURES_MAX}`, 'invalid_args');
      }
      return { type: 'repondeur', scenario, delaiHeures: h };
    }
    default:
      throw new RefusOutil(`${ou} : « type » vaut ${TYPES_ACTION.map((t) => `« ${t} »`).join(', ')}`, 'invalid_args');
  }
}

/** La vue, aux noms des outils (snake_case), sans graphe. */
export const vueOutil = (v: VueMiseEnLigne) => ({
  id: v.id,
  etat: v.etat,
  libelle: v.libelle,
  recapitulatif: v.recapitulatif,
  expire_le: v.expireLe,
  acceptee_le: v.accepteeLe,
  terminee_le: v.termineeLe,
  actions: v.actions.map((a) => ({
    type: a.type,
    nom: a.nom,
    ...(a.scenario === undefined ? {} : { scenario: a.scenario }),
    ...(a.campagne === undefined ? {} : { campagne: a.campagne }),
    ...(a.version === undefined ? {} : { version: a.version }),
    resultat: a.resultat,
  })),
});

/**
 * Le bouton d'un envoi au oui (B8), tel que l'outil qui le prépare le rend : l'identifiant, ce que dit le bouton, le
 * lien de la page et son échéance, et la consigne. Rien ne part avant le clic d'un admin, que Claude ne peut pas donner.
 */
export function boutonDuOui(v: VueMiseEnLigne) {
  const lien = adresseEcran(ECRANS.miseEnLigne(v.id));
  return {
    go_live_id: v.id,
    bouton: v.libelle,
    lien,
    expire_le: v.expireLe,
    consigne: `Écris ce lien EN ENTIER à la personne, seul sur sa ligne, en texte simple : ${lien} . Elle seule peut `
      + `accepter : un administrateur de l’espace, connecté à la console, clique sur « ${v.libelle} » (24 heures pour le `
      + 'faire). Rien ne part avant. Une fois cliqué, l’outil qui prend go_live_id rend le résultat.',
  };
}

export const OUTILS_MISE_EN_LIGNE: OutilMcp[] = [
  {
    ...ficheOutilMcp('list_scenario_versions'),
    fonction: 'scenarios',
    description: 'The published versions of a scenario, most recent first (50 at most): numero, publiee_le, blocs (its '
      + 'number of blocks) and en_ligne (the version that is live). Every publication makes a version, from the console, '
      + 'the API or Claude; moving blocks around does not. To go back to one, propose_go_live with the action "restaurer".',
    annotations: lecture('List the versions of a scenario'),
    entree: {
      type: 'object',
      properties: { scenario: { type: 'string', format: 'uuid', minLength: 1, maxLength: 100, description: 'The scenario id (list_scenarios).' } },
      required: ['scenario'],
      additionalProperties: false,
    },
    async executer(deps, tenantId, args) {
      const ref = texteObligatoire(args, 'scenario', 100);
      const wf = estUuid(ref) ? await deps.misesEnLigne.scenarios.getById(ref, tenantId) : null;
      if (!wf || wf.rayon !== 'general') throw new RefusOutil(SCENARIO_INCONNU, 'not_found');
      const versions = await deps.misesEnLigne.versions.lister(tenantId, wf.id);
      return {
        scenario: wf.id,
        nom: wf.name,
        versions: versions.map((v, i) => ({ numero: v.numero, publiee_le: v.publieeLe, blocs: v.blocs, en_ligne: i === 0 && wf.graph.nodes.length > 0 })),
      };
    },
  },
  {
    ...ficheOutilMcp('propose_go_live'),
    fonction: 'scenarios',
    description: 'Prepares a GO-LIVE and returns the link of the console page where an administrator of the workspace '
      + 'accepts it with ONE button whose label, written by the server, names the effect (going live on WhatsApp when a '
      + 'scenario will answer customers). '
      + 'This call publishes and switches on NOTHING: only the click does, on that page, by a signed-in administrator, and '
      + 'no tool can click. The actions, run in this order on the click: "publier" (publish the draft of a scenario exactly '
      + 'as it is now), "restaurer" (publish an earlier version again, list_scenario_versions), "repondeur" (the scenario '
      + 'answers whoever writes on WhatsApp and is not already handled, like set_default_responder in mode "scenario"; a '
      + 'scenario never published needs its "publier" in the same go-live). Everything is checked now, without writing. The '
      + 'page shows a summary written by the server; the button expires after 24 hours and works once. If the draft or '
      + 'the responder changes before the click, the click is refused: prepare the go-live again. After the click, '
      + 'get_go_live gives the result of each action.',
    annotations: ecriture('Prepare a go-live', false, false),
    entree: {
      type: 'object',
      properties: {
        actions: {
          type: 'array',
          minItems: 1,
          maxItems: ACTIONS_MAX,
          description: 'What the click will do, at most one action per scenario, plus one "repondeur".',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: [...TYPES_ACTION], description: '"publier", "restaurer" or "repondeur".' },
              scenario: { type: 'string', format: 'uuid', minLength: 1, maxLength: 100, description: 'The scenario id (list_scenarios).' },
              version: { type: 'integer', minimum: 1, description: 'With "restaurer": the version number (list_scenario_versions).' },
              delai_heures: {
                type: 'integer', minimum: DELAI_SCENARIO_HEURES_MIN, maximum: DELAI_SCENARIO_HEURES_MAX,
                description: 'With "repondeur": the scenario starts again at most once per this delay for the same contact. Absent: the delay already set.',
              },
            },
            required: ['type', 'scenario'],
            additionalProperties: false,
          },
        },
      },
      required: ['actions'],
      additionalProperties: false,
    },
    ecran: (_args, r) => ECRANS.miseEnLigne(lire(r, 'id')),
    async executer(deps, tenantId, args, personne) {
      const p = personneRequise(personne);
      const brutes = args.actions;
      if (!Array.isArray(brutes) || brutes.length === 0 || brutes.length > ACTIONS_MAX) {
        throw new RefusOutil(`paramètre « actions » : une liste de 1 à ${ACTIONS_MAX} actions`, 'invalid_args');
      }
      const v = valeurOuRefus(await proposer(deps.misesEnLigne, tenantId, p, brutes.map(demandeDe)));
      const lien = adresseEcran(ECRANS.miseEnLigne(v.id));
      return {
        ...vueOutil(v),
        lien,
        consigne: `Écris ce lien EN ENTIER à la personne, seul sur sa ligne, en texte simple : ${lien} . Elle seule peut `
          + `accepter : un administrateur de l’espace, connecté à la console, clique sur « ${v.libelle} ». Rien n’est fait avant.`,
      };
    },
  },
  {
    ...ficheOutilMcp('get_go_live'),
    // Ouvert à toutes les offres (B8, livraison 2) : un modèle envoyé à une personne, ouvert à toutes, s'y lit, comme la
    // page du oui, ouverte à la Free. Une lecture de ce que l'espace a préparé, sans rien de plus.
    fonction: null,
    description: 'Where a go-live stands: one prepared by propose_go_live, or the button of a send prepared by '
      + 'send_template_to_contact or send_scenario_to_contact, or the choice of set_optout_push (its go_live_id). etat: '
      + '"proposee" (waiting for the click), '
      + '"expiree" (the button expired: prepare it again), "en_cours", "interrompue" (an outage stopped it: an '
      + 'administrator resumes it by clicking again on the same page), "faite", "echouee" (an action was refused: its '
      + 'resultat says why, and the following actions did not run). Each action has its resultat once run; a send to a '
      + 'person carries its send_id (envoi).',
    annotations: lecture('Read a go-live'),
    entree: {
      type: 'object',
      properties: { id: { type: 'string', format: 'uuid', minLength: 1, maxLength: 100, description: 'The id returned by propose_go_live, or the go_live_id of a prepared send.' } },
      required: ['id'],
      additionalProperties: false,
    },
    async executer(deps, tenantId, args) {
      return vueOutil(valeurOuRefus(await lireVue(deps.misesEnLigne, tenantId, texteObligatoire(args, 'id', 100))));
    },
  },
];
