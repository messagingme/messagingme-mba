import { ficheOutilMcp } from '../../web/lib/partage/catalogue-mcp';
import {
  MAX_REPONSES_RAPIDES, MAX_TEXTE_REPONSE_RAPIDE, TEXTE_MAX_AVEC_FICHIER_OU_BOUTON, TEXTE_MAX_SIMPLE,
} from '../../web/lib/partage/message-rapide';
import type { AnnotationsMcp, OutilMcp, ProprieteEntree } from './outils';
import { RefusOutil, texteObligatoire } from './saisie';
import { ecriture, signataire } from './outils-agent';
import { MAX_NODES } from '../workflow/graph';
import {
  LONGUEUR_CHAMP_MAX, LONGUEUR_URL_FICHIER_MAX, MAX_BOUTONS_TEMPLATE, MAX_FICHIERS_RECETTE, MAX_TEXTE_BOUTON_TEMPLATE, NOM_SCENARIO_MAX,
  PROFONDEUR_MAX_RECETTE,
} from '../workflow/recette';
import {
  creerScenario, lireScenario, remplacerScenario, supprimerScenario, type DepsScenariosApi, type ResultatScenario,
} from '../workflow/scenarios-api';

/**
 * LES SCÉNARIOS DEPUIS CLAUDE (spec `docs/superpowers/specs/2026-11-02-scenarios-api-design.md`) : créer, relire,
 * remplacer, supprimer un scénario par sa recette. 🔴 Aucune logique ici : le MÊME service que `/v1/scenarios`
 * (`src/workflow/scenarios-api.ts`). Les écritures exigent une personne (`exigePersonne`) : un scénario publié écrit à de
 * vrais contacts, et une clé `mcp:write` branchée sur un agent qui lit des messages de clients ne doit pas pouvoir en
 * publier un.
 */
export interface DepsScenariosMcp {
  scenariosApi: DepsScenariosApi;
}

const lecture = (title: string): AnnotationsMcp => ({ title, readOnlyHint: true, openWorldHint: false });

/** Rend la valeur, ou lève le refus du service avec son chemin : le modèle corrige l'endroit exact. */
function valeurOuRefus<T>(r: ResultatScenario<T>): T {
  if (r.ok) return r.valeur;
  const chemin = typeof r.details?.chemin === 'string' ? ` (à ${r.details.chemin})` : '';
  const id = typeof r.details?.id === 'string' ? ` Scénario existant : ${r.details.id}.` : '';
  throw new RefusOutil(`${r.message}${chemin}.${id}`);
}

/**
 * 🔴 LA RECETTE ANNONCÉE AU MODÈLE porte chaque borne que `lireRecette` applique : le schéma MCP ne décrit pas une
 * récursion, donc la forme d'une étape est dite ici, et le test `tests/mcp-outils-scenarios.test.ts` exige chaque borne.
 */
const FORME_ETAPE = 'A step is an object with EXACTLY ONE of these forms. '
  + '(1) { "template": { "nom", "langue", "variables"? }, "boutons"?, "autre_reponse"? }: sends an APPROVED template of the '
  + 'workspace (create it first with create_template and wait for get_template_status to say approved). "variables" maps a '
  + `template position ("1" for {{1}}) to { "champ": a field key (list_fields, ${LONGUEUR_CHAMP_MAX} characters) } or `
  + '{ "texte": fixed text, with no line break, no tab and at most four spaces in a row } or { "attribut": "name" | "phone" }; '
  + 'absent: the associations set in the console. A carousel template is refused. "boutons": a '
  + `list of { "texte", "suite" }, one per QUICK_REPLY button of the template, "texte" being its exact text (${MAX_TEXTE_BOUTON_TEMPLATE} `
  + `characters, ${MAX_BOUTONS_TEMPLATE} buttons at most); EVERY quick reply needs one, if need be { "humain": {} }. A template without `
  + 'quick replies ends the scenario. "autre_reponse": the step when the contact writes instead of tapping. '
  + '(2) { "message": { "texte", "fichier"? }, "reponses"?, "autre_reponse"?, "suite"? }: a free message within the 24-hour '
  + `window. "texte": ${TEXTE_MAX_SIMPLE} characters, ${TEXTE_MAX_AVEC_FICHIER_OU_BOUTON} with a file or quick replies. "fichier": `
  + `{ "url": a public https address (${LONGUEUR_URL_FICHIER_MAX} characters) of a JPEG, PNG or GIF image, an MP4 video or a PDF }, `
  + `read at each send and checked once now. "reponses": up to ${MAX_REPONSES_RAPIDES} quick replies { "texte", "suite" }, `
  + `${MAX_TEXTE_REPONSE_RAPIDE} characters each, distinct, in the order the contact sees them; with them, "autre_reponse" is `
  + 'the step when the contact writes. Without quick replies the message does not wait: "suite" is the next step. '
  + '(3) { "agent": { "agent_id" } }: an active AI agent of the workspace (list_agents) takes the conversation; it ends the '
  + 'scenario. (4) { "humain": {} }: the conversation goes to the team (To handle); it ends the scenario. '
  + `At most ${PROFONDEUR_MAX_RECETTE} steps deep, ${MAX_NODES} steps and ${MAX_FICHIERS_RECETTE} distinct files.`;

const RECETTE: Record<'nom' | 'entree', ProprieteEntree> = {
  nom: {
    type: 'string', minLength: 1, maxLength: NOM_SCENARIO_MAX,
    description: `The scenario name, unique in the workspace (case-insensitive), ${NOM_SCENARIO_MAX} characters.`,
  },
  entree: { type: 'object', description: `The first step of the scenario. ${FORME_ETAPE}` },
};

const SCENARIO: ProprieteEntree = {
  type: 'string', minLength: 1, maxLength: 100,
  description: 'The scenario id, or its scn_ code (create_scenario, get_scenario, list_scenarios).',
};

const PUBLIE = 'Every write PUBLISHES at once, there is no draft: a published scenario writes to nobody until a send '
  + '(send_template_to_contact, launch_campaign, POST /v1/sends) or the default responder (set_default_responder) starts it. '
  + 'A rule added to an AI agent after the write is not wired: it goes to the team until the scenario is replaced.';

export const OUTILS_SCENARIOS: OutilMcp[] = [
  {
    ...ficheOutilMcp('create_scenario'),
    fonction: 'scenarios',
    description: 'Creates a scenario from a recipe and publishes it. Returns the recipe read back, its id and scn_ code, '
      + 'entreeCode (the nod_ code of the first step), empreinte (to replace it later) and ouverture. ' + PUBLIE,
    annotations: ecriture('Create a scenario', false, false),
    entree: { type: 'object', properties: RECETTE, required: ['nom', 'entree'], additionalProperties: false },
    async executer(deps, tenantId, args, personne) {
      const auteur = { userId: signataire(personne), acces: null };
      return valeurOuRefus(await creerScenario(deps.scenariosApi, tenantId, args, 'mcp', auteur));
    },
  },
  {
    ...ficheOutilMcp('get_scenario'),
    fonction: 'scenarios',
    description: 'Reads a scenario as a recipe, with its empreinte, needed by update_scenario. A scenario edited in the '
      + 'console beyond what a recipe can say is refused: only the console edits it.',
    annotations: lecture('Read a scenario'),
    entree: { type: 'object', properties: { scenario: SCENARIO }, required: ['scenario'], additionalProperties: false },
    async executer(deps, tenantId, args) {
      return valeurOuRefus(await lireScenario(deps.scenariosApi, tenantId, texteObligatoire(args, 'scenario', 100)));
    },
  },
  {
    ...ficheOutilMcp('update_scenario'),
    fonction: 'scenarios',
    description: 'Replaces a WHOLE scenario created through the API or by Claude, and publishes it. Pass the empreinte read '
      + 'by get_scenario: if the scenario changed in the meantime (in the console too), the call is refused instead of '
      + 'overwriting. A step left at the same place keeps its id, so a contact in the middle of the scenario resumes '
      + 'there. ' + PUBLIE,
    annotations: ecriture('Replace a scenario', true, false),
    entree: {
      type: 'object',
      properties: {
        scenario: SCENARIO,
        ...RECETTE,
        empreinte: { type: 'string', minLength: 1, maxLength: 100, description: 'The empreinte returned by get_scenario or by the last write.' },
      },
      required: ['scenario', 'nom', 'entree', 'empreinte'],
      additionalProperties: false,
    },
    async executer(deps, tenantId, args, personne) {
      const auteur = { userId: signataire(personne), acces: null };
      const ref = texteObligatoire(args, 'scenario', 100);
      const { scenario: _ref, empreinte, ...recette } = args;
      return valeurOuRefus(await remplacerScenario(
        deps.scenariosApi, tenantId, ref, recette, typeof empreinte === 'string' ? empreinte : undefined, 'mcp', auteur,
      ));
    },
  },
  {
    ...ficheOutilMcp('delete_scenario'),
    fonction: 'scenarios',
    description: 'Deletes a scenario created through the API or by Claude. Refused while something uses it (an automation, '
      + 'the default responder, a scheduled campaign, an ad, a widget, a "Go to" step): the refusal names it.',
    annotations: ecriture('Delete a scenario', true, false),
    entree: { type: 'object', properties: { scenario: SCENARIO }, required: ['scenario'], additionalProperties: false },
    async executer(deps, tenantId, args, personne) {
      const auteur = { userId: signataire(personne), acces: null };
      return valeurOuRefus(await supprimerScenario(deps.scenariosApi, tenantId, texteObligatoire(args, 'scenario', 100), 'mcp', auteur));
    },
  },
];
