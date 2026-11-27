import { ficheOutilMcp } from '../../web/lib/partage/catalogue-mcp';
import type { OutilMcp, ProprieteEntree } from './outils';
import { RefusOutil, familleDuRefus, texteObligatoire } from './saisie';
import { ecriture, lecture, signataire } from './outils-agent';
import {
  creerSystemeHttp, eprouverSystemeHttp, modifierSystemeHttp, supprimerSystemeHttp, systemesHttp, type AgentSourcesRouteDeps,
} from '../http/agent-sources';
import type { Issue } from '../lib/issue';
import type { SourceVue } from '../agent/sources';
import { adresseEcran, LISTES } from './ecran';

/**
 * LES SYSTÈMES CONNECTÉS DES AGENTS DEPUIS CLAUDE (lot 1 du CSM virtuel, B10, livraison 4a, plan
 * `docs/superpowers/plans/2026-11-26-csm-lot1-i-reste-du-lot.md`). 🔴 Aucune logique propre : chaque outil passe par la
 * fonction de sa route (`src/http/agent-sources.ts`), sa trace d'audit comprise. Trois règles de plus, parce qu'un
 * connecteur est la sortie de l'espace vers un tiers, et que Claude lit des conversations de clients :
 *  1. 🔴 la clé ne passe jamais par Claude : aucun outil ne la prend (une clé proposée est refusée, `phraseCle`, jusque
 *     dans la connexion OAuth) ; un système se déclare sans elle, en brouillon, et la personne la colle sur la page
 *     Connecteurs API de la console, sous l'adresse vers laquelle elle partira, puis l'active (0331 : la base refuse un
 *     système actif sans sa clé) ;
 *  2. 🔴 l'adresse d'un système, et celle de son jeton OAuth, se posent à la déclaration et ne changent plus depuis
 *     Claude, comme l'adresse d'un webhook : une consigne glissée dans une conversation lue suffirait sinon à détourner
 *     la clé, ou les données que les agents y envoient ;
 *  3. retirer la clé d'un système (passer en `none`) se fait dans la console : elle serait détruite sans retour.
 * Fonction `console`, comme leurs routes (le module n'est pas ouvert à la Free) : la Free n'a pas la page où la clé se
 * colle, et un système qu'elle déclarerait ne s'activerait jamais.
 */
export interface DepsConnecteursMcp {
  /** Les systèmes connectés : les MÊMES dépendances que leurs routes (`PgSourceStore`, l'épreuve, le journal d'audit). */
  systemesApi: AgentSourcesRouteDeps;
}

const SYSTEME_ID: ProprieteEntree = {
  type: 'string', format: 'uuid', minLength: 1, maxLength: 100, description: 'The connected system id (list_connector_systems).',
};
const LABEL: ProprieteEntree = { type: 'string', minLength: 1, maxLength: 80, description: 'Its name in the workspace, unique.' };
const BASE_URL: ProprieteEntree = {
  type: 'string', minLength: 1, maxLength: 500,
  description: 'The base address of its API, public and in HTTPS; each saved call adds its path to it. Set once: it changes '
    + 'in the console only.',
};
const AUTH: ProprieteEntree = {
  type: 'string', enum: ['none', 'bearer', 'header', 'oauth_password'],
  description: 'How it authenticates: none; bearer (an Authorization: Bearer key); header (the key in the header named by '
    + 'auth_header_name); oauth_password (a token asked with a username and a password).',
};
const ENTETE: ProprieteEntree = {
  type: 'string', pattern: '^[A-Za-z0-9-]{1,64}$', description: 'For auth header: the header that carries the key (X-Api-Key).',
};
/** Les champs de la connexion OAuth qu'un outil accepte : jamais le mot de passe. */
const CHAMPS_OAUTH = ['token_url', 'client_id', 'username', 'scope'] as const;
const OAUTH: ProprieteEntree = {
  type: 'object',
  description: 'For auth oauth_password: the connection, without its password (pasted on the console page, like a key). '
    + 'Set once with the system: its token address changes in the console only.',
  properties: {
    token_url: { type: 'string', minLength: 1, maxLength: 500, description: 'The address that gives the token, public and in HTTPS.' },
    client_id: { type: 'string', minLength: 1, maxLength: 200, description: 'The client_id.' },
    username: { type: 'string', minLength: 1, maxLength: 200, description: 'The username.' },
    scope: { type: 'string', maxLength: 200, description: 'The scope, when the system asks for one.' },
  },
  required: ['token_url', 'client_id', 'username'],
  additionalProperties: false,
};

const page = (): string => adresseEcran(LISTES.connecteurs);

/** Une clé proposée à Claude : refusée, avec ce qu'il faut faire à la place. */
const PHRASE_CLE = 'une clé, un jeton ou un mot de passe ne passe jamais par Claude : la personne le colle sur la page '
  + 'Connecteurs API de la console (le système déplié, « Nouveau jeton » ou « Nouveau mot de passe », puis « Remplacer »)';
const phraseCle = (inconnues: readonly string[]): string | undefined =>
  (inconnues.some((k) => /secret|key|cle|token|jeton|password|mot_de_passe/i.test(k)) ? PHRASE_CLE : undefined);

/**
 * La connexion OAuth sous les noms de la route. 🔴 Un champ de plus (un `password`, un `client_secret`) est REFUSÉ, pas
 * jeté : le serveur ne vérifie que le premier niveau des arguments. Une forme fausse passe, et le schéma de la route la refuse.
 */
function oauthDeLaRoute(o: unknown): unknown {
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return o;
  const c = new Map<string, unknown>(Object.entries(o));
  const inconnues = [...c.keys()].filter((k) => !(CHAMPS_OAUTH as readonly string[]).includes(k));
  if (inconnues.length > 0) {
    throw new RefusOutil(phraseCle(inconnues) ?? `oauth : champ(s) inconnu(s) : ${inconnues.join(', ')}`, 'invalid_args');
  }
  return Object.fromEntries([
    ['tokenUrl', c.get('token_url')], ['clientId', c.get('client_id')], ['username', c.get('username')], ['scope', c.get('scope')],
  ].filter(([, v]) => v !== undefined));
}

/** Le nom de chaque argument dans la route (`creationSchema`, `patchSchema`). */
const NOMS_DE_LA_ROUTE = {
  label: 'label', base_url: 'baseUrl', auth: 'authKind', auth_header_name: 'authHeaderName', oauth: 'oauth', status: 'status',
} as const;

/**
 * Les arguments PERMIS à cet outil, sous les noms de la route, seulement ceux qui sont donnés (B0d). 🔴 Ce qui n'est pas
 * permis ne part pas : jamais une clé, et jamais une adresse depuis `update_connector_system`.
 */
function corpsDeLaRoute(args: Record<string, unknown>, permis: ReadonlyArray<keyof typeof NOMS_DE_LA_ROUTE>): Record<string, unknown> {
  const corps: Record<string, unknown> = {};
  for (const champ of permis) {
    if (args[champ] !== undefined) corps[NOMS_DE_LA_ROUTE[champ]] = champ === 'oauth' ? oauthDeLaRoute(args.oauth) : args[champ];
  }
  return corps;
}

/** Un refus de la fonction de la route, avec la page où la personne règle ce que Claude ne fait pas (la clé, l'adresse). */
function ouRefus<T>(r: Issue<T>): T {
  if (r.ok) return r.valeur;
  throw new RefusOutil(r.erreur, familleDuRefus(r.statut), { action: page() });
}

/** Ce que Claude dit de la clé d'un système : rien à coller, ou la page et le geste exact de la personne. */
function cleDe(s: SourceVue): { a_coller: false } | { a_coller: true; page: string; consigne: string } {
  if (s.authKind === 'none' || s.aAuthentification) return { a_coller: false };
  const champ = s.authKind === 'oauth_password' ? '« Nouveau mot de passe »' : s.authKind === 'bearer' ? '« Nouveau jeton »' : '« Nouveau secret pour l’en-tête »';
  return {
    a_coller: true, page: page(),
    consigne: `Écris ce lien EN ENTIER à la personne, seul sur sa ligne : ${page()} . Sur la page Connecteurs API, elle clique le `
      + `système « ${s.label} » pour le déplier, vérifie l'adresse affichée sous le champ (c'est là que la clé partira), colle `
      + `sa clé dans ${champ} et clique « Remplacer », puis « Activer ». Aucun agent ne l'appelle avant ; la clé ne passe `
      + 'jamais par Claude.',
  };
}

export const OUTILS_CONNECTEURS: OutilMcp[] = [
  {
    ...ficheOutilMcp('list_connector_systems'),
    fonction: 'console',
    description: 'The systems the AI agents of the workspace call (a CRM, an ERP, a booking tool), as the API connectors page '
      + 'shows them: base address, authentication mode, whether its key is stored (aAuthentification), status (draft, '
      + 'active, disabled), the last test, the active tools that depend on it. A key is never read back.',
    annotations: lecture('List the connected systems'),
    entree: { type: 'object', properties: {}, additionalProperties: false },
    async executer(deps, tenantId) {
      return { systemes: await systemesHttp(deps.systemesApi, tenantId) };
    },
  },
  {
    ...ficheOutilMcp('create_connector_system'),
    fonction: 'console',
    description: 'Declares a system that AI agents will call (its API): its name, its base address, how it authenticates. '
      + 'Its key never goes through Claude: the system is created as a draft, and when its mode needs a key the result '
      + 'gives the console page and the exact gesture of the person, who checks the address shown there and pastes the key, '
      + 'then activates the system. No agent calls it before. Its address, and its token address, are set here once: they '
      + 'change in the console only. test_connector_system then checks that it answers.',
    annotations: ecriture('Declare a connected system', false, false),
    entree: {
      type: 'object',
      properties: { label: LABEL, base_url: BASE_URL, auth: AUTH, auth_header_name: ENTETE, oauth: OAUTH },
      required: ['label', 'base_url', 'auth'],
      additionalProperties: false,
    },
    phraseClesInconnues: phraseCle,
    ecran: () => LISTES.connecteurs,
    async executer(deps, tenantId, args, personne) {
      const userId = signataire(personne);
      const corps = corpsDeLaRoute(args, ['label', 'base_url', 'auth', 'auth_header_name', 'oauth']);
      const systeme = ouRefus(await creerSystemeHttp(deps.systemesApi, tenantId, corps, { auth: { userId } }));
      return { systeme, cle: cleDe(systeme) };
    },
  },
  {
    ...ficheOutilMcp('update_connector_system'),
    fonction: 'console',
    description: 'Changes a connected system, as the API connectors page does. Only the fields provided change, what is '
      + 'omitted is not touched (auth_header_name null removes it). status active puts it into service, refused while its '
      + 'key is missing (the person pastes it on the console page first); disabled stops it. Its address and its OAuth '
      + 'connection change in the console only, like a webhook address; auth none on a system that holds a key is refused '
      + '(the key would be deleted: done in the console). Its key never goes through Claude.',
    annotations: ecriture('Update a connected system', true, false),
    entree: {
      type: 'object',
      properties: {
        system_id: SYSTEME_ID, label: LABEL, auth: AUTH,
        auth_header_name: { ...ENTETE, type: ['string', 'null'], description: 'For auth header: the header that carries the key; null removes it.' },
        status: { type: 'string', enum: ['draft', 'active', 'disabled'], description: 'active puts it into service (its key is required), disabled stops it.' },
      },
      required: ['system_id'],
      additionalProperties: false,
    },
    phraseClesInconnues: phraseCle,
    ecran: () => LISTES.connecteurs,
    async executer(deps, tenantId, args, personne) {
      const userId = signataire(personne);
      const id = texteObligatoire(args, 'system_id', 100);
      const corps = corpsDeLaRoute(args, ['label', 'auth', 'auth_header_name', 'status']);
      if (Object.keys(corps).length === 0) {
        throw new RefusOutil('rien à changer : label, auth, auth_header_name ou status (l’adresse se change dans la console)', 'invalid_args');
      }
      const systeme = ouRefus(await modifierSystemeHttp(deps.systemesApi, tenantId, id, corps, { auth: { userId } }, { cleGardee: true }));
      return { systeme, cle: cleDe(systeme) };
    },
  },
  {
    ...ficheOutilMcp('delete_connector_system'),
    fonction: 'console',
    description: 'Deletes a connected system, for good, with its key. Refused while active tools of an agent depend on it '
      + '(disable them first) or while calls are saved on it (delete them first, on the API connectors page).',
    annotations: ecriture('Delete a connected system', true, false),
    entree: { type: 'object', properties: { system_id: SYSTEME_ID }, required: ['system_id'], additionalProperties: false },
    ecran: () => LISTES.connecteurs,
    async executer(deps, tenantId, args, personne) {
      const userId = signataire(personne);
      return ouRefus(await supprimerSystemeHttp(deps.systemesApi, tenantId, texteObligatoire(args, 'system_id', 100), { auth: { userId } }));
    },
  },
  {
    ...ficheOutilMcp('test_connector_system'),
    fonction: 'console',
    description: 'Tests a connected system for real, as the Test button of the page: a GET on its address followed by path '
      + '(/ by default), with its key, and the result written on the system (ok, HTTP status, error). Nothing of its answer '
      + 'is returned. A system that does not answer is a result, not a failure of the tool; a system whose key is not '
      + 'pasted yet is not called, and the result says so.',
    annotations: ecriture('Test a connected system', true, true),
    entree: {
      type: 'object',
      properties: {
        system_id: SYSTEME_ID,
        path: { type: 'string', minLength: 1, maxLength: 500, description: 'The path to call under its address, / by default.' },
      },
      required: ['system_id'],
      additionalProperties: false,
    },
    ecran: () => LISTES.connecteurs,
    async executer(deps, tenantId, args, personne) {
      signataire(personne);
      const id = texteObligatoire(args, 'system_id', 100);
      return ouRefus(await eprouverSystemeHttp(deps.systemesApi, tenantId, id, args.path === undefined ? {} : { chemin: args.path }));
    },
  },
];
