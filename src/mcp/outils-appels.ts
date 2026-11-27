import { ficheOutilMcp } from '../../web/lib/partage/catalogue-mcp';
import type { OutilMcp, ProprieteEntree } from './outils';
import { RefusOutil, familleDuRefus, texteObligatoire } from './saisie';
import { AGENT_ID, ecriture, lecture, signataire } from './outils-agent';
import {
  corpsRequete, creerAppel, essayerAppel, listerAppels, modifierAppel, patchSchema, supprimerAppel, testSchema, type AgentRequetesRouteDeps,
} from '../http/agent-requetes';
import type { ZodError } from 'zod';
import { brancherConnecteur, type AgentToolsRouteDeps } from '../http/agent-tools';
import type { Issue } from '../lib/issue';
import { adresseEcran, ECRANS, LISTES } from './ecran';

/**
 * LES APPELS DES SYSTÈMES CONNECTÉS DEPUIS CLAUDE (lot 1 du CSM virtuel, B10, livraison 4b, plan
 * `docs/superpowers/plans/2026-11-26-csm-lot1-i-reste-du-lot.md`). 🔴 Aucune logique propre : chaque outil passe par la
 * fonction de sa route (`src/http/agent-requetes.ts`, et `brancherConnecteur` de `src/http/agent-tools.ts`). Deux
 * règles de plus, parce qu'un appel part chez un tiers et que Claude lit des conversations de clients :
 *  1. 🔴 un essai EXÉCUTE l'appel pour de vrai : depuis Claude, seul un appel qui lit (GET) s'essaie ; un appel qui
 *     écrit s'essaie dans la console, sous les yeux de la personne (`lectureSeule`) ;
 *  2. 🔴 un appel enregistré ne change pas de système depuis Claude (son adresse, comme celle du système, se pose à la
 *     déclaration) : `update_connector_call` ne prend pas `system_id` ; et un appel EN SERVICE ne change, depuis Claude,
 *     que son nom, ses champs lus et ses valeurs d'essai (`enServiceFige`) ;
 *  3. 🔴 une clé ne passe jamais par Claude, pas plus dans un appel que sur un système : un en-tête, un paramètre, une
 *     valeur fixe ou d'essai au nom de secret sont refusés à l'écriture, et masqués à la lecture (`masquerAppel`).
 * Fonction `console`, comme leurs routes. Les noms suivent ceux de la route (en français), comme ceux de la console.
 */
export interface DepsAppelsMcp {
  /** Les appels des systèmes : les MÊMES dépendances que leurs routes (`PgRequeteStore`, l'essai, les champs de l'espace). */
  appelsApi: AgentRequetesRouteDeps;
  /** Le branchement d'un appel sur un agent : le MÊME catalogue que l'onglet Outils (`PgToolCatalog`, `PgRequeteStore`). */
  branchementAppels: Pick<AgentToolsRouteDeps, 'outils' | 'requetes' | 'sortiesDeLAgent'>;
}

const APPEL_ID: ProprieteEntree = {
  type: 'string', format: 'uuid', minLength: 1, maxLength: 100, description: 'The saved call id (list_connector_calls).',
};
const SYSTEME_ID: ProprieteEntree = {
  type: 'string', format: 'uuid', minLength: 1, maxLength: 100, description: 'The connected system the call goes to (list_connector_systems).',
};
const VALEUR_ESSAI: Omit<ProprieteEntree, 'description'> = { type: ['string', 'number', 'boolean'], maxLength: 2000 };
const PAIRES: ProprieteEntree = {
  type: 'array', maxItems: 50, description: 'The query string parameters; a value may hold {variable}.',
  items: {
    type: 'object',
    properties: {
      cle: { type: 'string', maxLength: 200, description: 'The name.' },
      valeur: { type: 'string', maxLength: 2000, description: 'The value, {variable} allowed.' },
    },
    required: ['cle', 'valeur'],
    additionalProperties: false,
  },
};
/** Les champs d'un appel (`corpsRequete` de la route), sans le système, que `update_connector_call` ne prend pas. */
const CHAMPS_APPEL: Record<string, ProprieteEntree> = {
  label: { type: 'string', minLength: 1, maxLength: 80, description: 'Its name in the library, unique.' },
  methode: {
    type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    description: 'GET reads; POST, PUT and PATCH write in the system, DELETE removes (its tools are at least irreversible).',
  },
  chemin: { type: 'string', minLength: 1, maxLength: 500, description: 'The path under the system address, {variable} allowed (/customers/{telephone}).' },
  parametres: PAIRES,
  entetes: {
    type: 'array', maxItems: 30,
    description: 'The headers of the call, never its authentication: it lives on the system (authorization and the other reserved headers are refused).',
    items: {
      type: 'object',
      properties: {
        nom: { type: 'string', maxLength: 64, description: 'The header name.' },
        valeur: { type: 'string', maxLength: 2000, description: 'The value, {variable} allowed.' },
      },
      required: ['nom', 'valeur'],
      additionalProperties: false,
    },
  },
  corps: {
    type: 'object',
    description: 'The body: mode aucun; json, with gabarit (a JSON text, {variable} allowed); champs (form fields); formulaire '
      + '(multipart: a line with fichier true sends the file received in that variable). Replaced whole.',
    properties: {
      mode: { type: 'string', enum: ['aucun', 'json', 'champs', 'formulaire'], description: 'The body mode.' },
      gabarit: { type: 'string', maxLength: 20000, description: 'For json: the JSON text.' },
      champs: {
        type: 'array', maxItems: 50, description: 'For champs and formulaire: the fields.',
        items: {
          type: 'object',
          properties: {
            cle: { type: 'string', maxLength: 200, description: 'The name.' },
            valeur: { type: 'string', maxLength: 2000, description: 'The value, {variable} allowed.' },
            fichier: { type: 'boolean', description: 'For formulaire: send the file received in this variable.' },
          },
          required: ['cle', 'valeur'],
          additionalProperties: false,
        },
      },
    },
    required: ['mode'],
    additionalProperties: false,
  },
  variables: {
    type: 'array', maxItems: 50,
    description: 'The data the call carries, each with its origin: modele (the agent fills it), fiche (a field of the contact '
      + 'that may go out), champ (a custom field of the workspace), systeme (a value of the platform), fixe (a constant).',
    items: {
      type: 'object',
      properties: {
        nom: { type: 'string', pattern: '^[\\w.-]{1,64}$', description: 'Its name, used as {nom} in the path, the parameters, the headers or the body.' },
        type: { type: 'string', enum: ['string', 'number', 'integer', 'boolean', 'json'], description: 'Its type (json: from a custom field, only in a json body).' },
        origine: {
          type: 'object', description: 'Where its value comes from.',
          properties: {
            type: { type: 'string', enum: ['modele', 'fiche', 'champ', 'systeme', 'fixe'], description: 'The origin.' },
            cle: {
              type: 'string', minLength: 1, maxLength: 64,
              description: 'fiche: one of catalogue.fiche; systeme: one of catalogue.systeme; champ: a key of champs (list_connector_calls gives the three).',
            },
            valeur: { type: ['string', 'number', 'boolean'], maxLength: 500, description: 'For fixe: the value.' },
          },
          required: ['type'],
          additionalProperties: false,
        },
        description: { type: 'string', maxLength: 500, description: 'For modele: what the agent must give.' },
        requis: { type: 'boolean', description: 'For modele: the agent must give it.' },
        enum: { type: 'array', maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 120 }, description: 'For modele: the allowed values.' },
      },
      required: ['nom', 'type', 'origine'],
      additionalProperties: false,
    },
  },
  output_paths: {
    type: 'array', maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 120 },
    description: 'The fields of the answer an agent may read (a test gives them in chemins); empty keeps it a draft.',
  },
  valeurs_test: { type: 'object', additionalProperties: VALEUR_ESSAI, description: 'Test values by variable name, used by test_connector_call.' },
};

/** Le nom de chaque argument dans la route, quand il diffère (le reste porte le nom de la route). */
const NOMS_DE_LA_ROUTE: Record<string, string> = { system_id: 'sourceId', output_paths: 'outputPaths', valeurs_test: 'valeursTest' };

/** Les arguments PERMIS à cet outil, sous les noms de la route, seulement ceux qui sont donnés (B0d). */
function corpsDeLaRoute(args: Record<string, unknown>, permis: readonly string[]): Record<string, unknown> {
  const corps: Record<string, unknown> = {};
  for (const champ of permis) if (args[champ] !== undefined) corps[NOMS_DE_LA_ROUTE[champ] ?? champ] = args[champ];
  return corps;
}

const page = (): string => adresseEcran(LISTES.connecteurs);

/** Un refus de la fonction de la route, avec la page de la console où la personne règle le reste. */
function ouRefus<T>(r: Issue<T>, ecran: string = page()): T {
  if (r.ok) return r.valeur;
  throw new RefusOutil(r.erreur, familleDuRefus(r.statut), { action: ecran });
}

/**
 * Le refus d'un schéma de la route, détaillé : la route dit seulement « champs requis » ou « corps invalide », et un
 * modèle doit savoir QUOI corriger. Le même schéma que la route, jamais un second.
 */
function refusDuSchema(erreur: ZodError): RefusOutil {
  const details = erreur.issues.slice(0, 5).map((i) => `${i.path.join('.') || '(racine)'} : ${i.message}`).join(' ; ');
  return new RefusOutil(`champs refusés : ${details}`, 'invalid_args', { action: page() });
}

/** Un nom qui porte un secret (une clé, un jeton, un mot de passe), dans un en-tête, un paramètre ou une variable. */
const NOM_DE_SECRET = /secret|token|jeton|password|passwd|mot.?de.?passe|api.?key|apikey|(^|[^a-z])(cle|clef|key)([^a-z]|$)/i;
const VALEUR_MASQUEE = '••••';
const REFUS_CLE = 'une clé ne passe jamais par Claude : elle se déclare sur le système (mode en-tête ou jeton, '
  + 'create_connector_system) et la personne la colle sur la page Connecteurs API ; refusé dans cet appel : ';

/** Les noms de secret qu'un appel porterait : en-têtes, paramètres, champs de corps, variables fixes, valeurs d'essai. */
function secretsDe(corps: Record<string, unknown>): string[] {
  const noms = (liste: unknown, cle: string): string[] => (Array.isArray(liste)
    ? liste.flatMap((x) => (x !== null && typeof x === 'object' && typeof (x as Record<string, unknown>)[cle] === 'string' ? [String((x as Record<string, unknown>)[cle])] : []))
    : []);
  const champs = corps.corps !== null && typeof corps.corps === 'object' ? (corps.corps as Record<string, unknown>).champs : undefined;
  const fixes = Array.isArray(corps.variables)
    ? corps.variables.flatMap((v) => (v !== null && typeof v === 'object' && (v as Record<string, unknown>).origine !== null
      && typeof (v as Record<string, unknown>).origine === 'object'
      && ((v as Record<string, unknown>).origine as Record<string, unknown>).type === 'fixe' ? noms([v], 'nom') : []))
    : [];
  const essais = corps.valeursTest !== null && typeof corps.valeursTest === 'object' ? Object.keys(corps.valeursTest as object) : [];
  return [...noms(corps.entetes, 'nom'), ...noms(corps.parametres, 'cle'), ...noms(champs, 'cle'), ...fixes, ...essais]
    .filter((n) => NOM_DE_SECRET.test(n));
}

/** Un texte qui n'est qu'une variable (`{token}`) ne porte aucun secret : il est gardé. */
const masquer = (valeur: unknown): unknown => (typeof valeur === 'string' && /^\{[\w.-]+\}$/.test(valeur) ? valeur : VALEUR_MASQUEE);

/**
 * Un appel tel que Claude le lit : les valeurs au nom de secret (un en-tête `X-Api-Key`, un paramètre `api_key`, une
 * variable fixe `token`, une valeur d'essai) masquées. La console les montre à l'admin ; elles ne partent pas chez le
 * fournisseur de modèle.
 */
function masquerAppel<T extends object>(objet: T): T {
  const appel = objet as Record<string, unknown>;
  const paires = (liste: unknown, cle: string): unknown => (Array.isArray(liste)
    ? liste.map((x) => (x !== null && typeof x === 'object' && NOM_DE_SECRET.test(String((x as Record<string, unknown>)[cle] ?? ''))
      ? { ...(x as object), valeur: masquer((x as Record<string, unknown>).valeur) } : x))
    : liste);
  const variables = Array.isArray(appel.variables)
    ? appel.variables.map((v) => {
      const o = (v as { nom?: unknown; origine?: { type?: unknown; valeur?: unknown } });
      return o.origine?.type === 'fixe' && NOM_DE_SECRET.test(String(o.nom ?? '')) ? { ...o, origine: { ...o.origine, valeur: VALEUR_MASQUEE } } : v;
    })
    : appel.variables;
  const essais = appel.valeursTest !== null && typeof appel.valeursTest === 'object'
    ? Object.fromEntries(Object.entries(appel.valeursTest as Record<string, unknown>).map(([k, v]) => [k, NOM_DE_SECRET.test(k) ? VALEUR_MASQUEE : v]))
    : appel.valeursTest;
  return { ...appel, entetes: paires(appel.entetes, 'nom'), parametres: paires(appel.parametres, 'cle'), variables, valeursTest: essais } as T;
}

/** Ce qu'un essai rend, masqué : les en-têtes partis et les paramètres de l'adresse au nom de secret. */
function masquerEssai(resultat: Record<string, unknown>): Record<string, unknown> {
  const envoye = resultat.envoye;
  if (envoye === null || typeof envoye !== 'object') return resultat;
  const e = envoye as { url?: unknown; entetes?: unknown };
  const entetes = e.entetes !== null && typeof e.entetes === 'object'
    ? Object.fromEntries(Object.entries(e.entetes as Record<string, unknown>).map(([k, v]) => [k, NOM_DE_SECRET.test(k) ? VALEUR_MASQUEE : v]))
    : e.entetes;
  let url = e.url;
  if (typeof url === 'string') {
    try {
      const u = new URL(url);
      for (const k of [...u.searchParams.keys()]) if (NOM_DE_SECRET.test(k)) u.searchParams.set(k, VALEUR_MASQUEE);
      url = u.toString();
    } catch { /* une adresse illisible reste telle quelle : elle ne vient que de l'assemblage */ }
  }
  return { ...resultat, envoye: { ...(envoye as object), url, entetes } };
}

export const OUTILS_APPELS: OutilMcp[] = [
  {
    ...ficheOutilMcp('list_connector_calls'),
    fonction: 'console',
    description: 'The calls saved on the connected systems (requetes: method, path, body, variables, the fields an agent may '
      + 'read, the tools that use it), the keys of the custom fields a variable may take (champs), and the catalogue of '
      + 'origins (fiche: the contact fields that may go out, systeme, the reserved headers).',
    annotations: lecture('List the connector calls'),
    entree: { type: 'object', properties: {}, additionalProperties: false },
    async executer(deps, tenantId) {
      const r = await listerAppels(deps.appelsApi, tenantId);
      return { ...r, requetes: r.requetes.map((a) => masquerAppel(a)) };
    },
  },
  {
    ...ficheOutilMcp('create_connector_call'),
    fonction: 'console',
    description: 'Saves a call on a connected system, as the API connectors page does: method, path, parameters, headers, '
      + 'body and variables are checked at saving (an undeclared variable, a reserved header, a path off the system are '
      + 'refused). output_paths may stay empty: a test then gives the fields to read. A key never goes into a call: its '
      + 'authentication lives on the system, and a header, parameter or value named like a secret is refused. Nothing is '
      + 'sent: an agent uses it once attach_connector_call gives it to the agent and update_agent_tool enables it.',
    annotations: ecriture('Save a connector call', false, false),
    entree: {
      type: 'object',
      properties: { system_id: SYSTEME_ID, ...CHAMPS_APPEL },
      required: ['system_id', 'label', 'methode', 'chemin'],
      additionalProperties: false,
    },
    ecran: () => LISTES.connecteurs,
    async executer(deps, tenantId, args, personne) {
      signataire(personne);
      // Sans champs lus, un brouillon : la route les exige, l'outil fournit leur défaut, la liste vide.
      const corps = { outputPaths: [], ...corpsDeLaRoute(args, ['system_id', ...Object.keys(CHAMPS_APPEL)]) };
      const secrets = secretsDe(corps);
      if (secrets.length > 0) throw new RefusOutil(`${REFUS_CLE}${secrets.join(', ')}`, 'invalid_args', { action: page() });
      const schema = corpsRequete.safeParse(corps);
      if (!schema.success) throw refusDuSchema(schema.error);
      return { appel: masquerAppel(ouRefus(await creerAppel(deps.appelsApi, tenantId, corps))) };
    },
  },
  {
    ...ficheOutilMcp('update_connector_call'),
    fonction: 'console',
    description: 'Changes a saved call, checked on its state after the change. Only the fields provided change, what is '
      + 'omitted is not touched; a list or the body given replaces the whole list or body. A call in service (used by a '
      + 'tool of an agent, an API Call block or the opt-out push, which all read it at each use) changes only its label, '
      + 'output_paths and valeurs_test from Claude: the rest changes in the console. Its system never changes from Claude. '
      + 'A key never goes into a call: a header, parameter or value named like a secret is refused.',
    annotations: ecriture('Update a connector call', true, false),
    entree: {
      type: 'object',
      properties: { call_id: APPEL_ID, ...CHAMPS_APPEL },
      required: ['call_id'],
      additionalProperties: false,
    },
    ecran: () => LISTES.connecteurs,
    async executer(deps, tenantId, args, personne) {
      signataire(personne);
      const id = texteObligatoire(args, 'call_id', 100);
      const corps = corpsDeLaRoute(args, Object.keys(CHAMPS_APPEL));
      if (Object.keys(corps).length === 0) throw new RefusOutil('rien à changer : donnez au moins un champ de l’appel', 'invalid_args');
      const secrets = secretsDe(corps);
      if (secrets.length > 0) throw new RefusOutil(`${REFUS_CLE}${secrets.join(', ')}`, 'invalid_args', { action: page() });
      const schema = patchSchema.safeParse(corps);
      if (!schema.success) throw refusDuSchema(schema.error);
      return { appel: masquerAppel(ouRefus(await modifierAppel(deps.appelsApi, tenantId, id, corps, { enServiceFige: true }))) };
    },
  },
  {
    ...ficheOutilMcp('delete_connector_call'),
    fonction: 'console',
    description: 'Deletes a saved call, for good. Refused while a tool of an agent uses it, while an API Call block of a '
      + 'scenario designates it, or while it is the call warned at each unsubscription (Security > Consent).',
    annotations: ecriture('Delete a connector call', true, false),
    entree: { type: 'object', properties: { call_id: APPEL_ID }, required: ['call_id'], additionalProperties: false },
    ecran: () => LISTES.connecteurs,
    async executer(deps, tenantId, args, personne) {
      signataire(personne);
      return ouRefus(await supprimerAppel(deps.appelsApi, tenantId, texteObligatoire(args, 'call_id', 100)));
    },
  },
  {
    ...ficheOutilMcp('test_connector_call'),
    fonction: 'console',
    description: 'Runs a saved call for real, with its test values (valeurs overrides them), and returns what went out (envoye, '
      + 'without the system key) and what the system answered (httpStatus, apercu cut at 20,000 characters, chemins: the '
      + 'fields an agent may read). Only a call that reads (GET): a call that writes (POST, PUT, PATCH, DELETE) is tested '
      + 'in the console, in front of the person, since a test writes for real in the system.',
    annotations: ecriture('Test a connector call', true, true),
    entree: {
      type: 'object',
      properties: {
        call_id: APPEL_ID,
        valeurs: { type: 'object', additionalProperties: VALEUR_ESSAI, description: 'Test values by variable name, over its saved ones.' },
      },
      required: ['call_id'],
      additionalProperties: false,
    },
    ecran: () => LISTES.connecteurs,
    async executer(deps, tenantId, args, personne) {
      signataire(personne);
      const id = texteObligatoire(args, 'call_id', 100);
      const corps = args.valeurs === undefined ? {} : { valeurs: args.valeurs };
      const schema = testSchema.safeParse(corps);
      if (!schema.success) throw refusDuSchema(schema.error);
      return masquerEssai(ouRefus(await essayerAppel(deps.appelsApi, tenantId, id, corps, { lectureSeule: true })));
    },
  },
  {
    ...ficheOutilMcp('attach_connector_call'),
    fonction: 'console',
    description: 'Gives a saved call to an AI agent as a tool, disabled, as its Tools tab does: the words the model reads '
      + '(name, title, description, when not to call it), what the agent does with the answer (integre: reads the fields '
      + 'of output_paths; pousse: only sends) and its risk (at least the floor of its method). The result gives what the '
      + 'tool will send (envoi), which the person reads before update_agent_tool enables it.',
    annotations: ecriture('Give a connector call to an agent', false, false),
    entree: {
      type: 'object',
      properties: {
        agent_id: AGENT_ID,
        call_id: APPEL_ID,
        nature: { type: 'string', enum: ['pousse', 'integre'], description: 'integre: the agent reads fields of the answer; pousse: it only sends.' },
        output_paths: {
          type: 'array', maxItems: 50, items: { type: 'string', minLength: 1, maxLength: 120 },
          description: 'For integre: the fields of the answer the agent reads (at least one).',
        },
        name: { type: 'string', pattern: '^[a-z0-9_]{1,64}$', description: 'The tool name the model sees (lowercase, digits, underscores).' },
        title: { type: 'string', minLength: 1, maxLength: 120, description: 'Its title.' },
        description: { type: 'string', minLength: 1, maxLength: 2000, description: 'When the agent uses it.' },
        ne_pas_utiliser: { type: 'string', minLength: 1, maxLength: 2000, description: 'When the agent must not use it.' },
        risk: { type: 'string', enum: ['read', 'write', 'irreversible'], description: 'Its risk, at least the floor of the method (omitted: the floor).' },
      },
      required: ['agent_id', 'call_id', 'nature', 'name', 'title', 'description', 'ne_pas_utiliser'],
      additionalProperties: false,
    },
    ecran: (args) => ECRANS.agent(args.agent_id, 'outils'),
    async executer(deps, tenantId, args, personne) {
      signataire(personne);
      const agentId = texteObligatoire(args, 'agent_id', 100);
      const corps = {
        requeteId: args.call_id, nature: args.nature, name: args.name, title: args.title, description: args.description,
        nePasUtiliser: args.ne_pas_utiliser,
        ...(args.output_paths === undefined ? {} : { outputPaths: args.output_paths }),
        ...(args.risk === undefined ? {} : { risk: args.risk }),
      };
      const r = ouRefus(await brancherConnecteur(deps.branchementAppels, tenantId, agentId, corps), adresseEcran(ECRANS.agent(agentId, 'outils')));
      return {
        ...r,
        a_savoir: 'L’outil est rattaché inactif. Dis à la personne ce qu’il enverra (envoi), puis update_agent_tool avec '
          + 'enabled true l’active, à son nom.',
      };
    },
  },
];
