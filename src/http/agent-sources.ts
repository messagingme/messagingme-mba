import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Guard } from '../auth/middleware';
import { LabelSourceDejaPris, SourcePorteDesAppels, type AuthSource, type ConfigOAuth, type SourceVue } from '../agent/sources';
import {
  preparerCreationSource,
  preparerPatchSource,
  verifierAdresseSource,
} from '../agent/source-configuration';
import { corpsDuRefus, refus, type Issue } from '../lib/issue';
import { espaceVerifie, estUuid } from './scope';
import { makeJournal, type AuditSink } from '../audit/journal';

/**
 * Les sources externes d'outils : déclarer le système du client, et savoir qu'il répond encore. Une source est
 * une adresse que le serveur appellera depuis le réseau Docker du VPS, et un secret. Trois gardes :
 *  1. 🔴 l'adresse est validée à l'écriture, par la même fonction que le résolveur (`construireCible`) ;
 *  2. le secret ne se relit jamais ; un champ vide dans un patch veut dire « inchangé » ; il peut attendre tant que le
 *     système n'est pas actif (déclaré depuis Claude, qui ne le voit jamais : B10, livraison 4a) ;
 *  3. supprimer une source dont des outils actifs dépendent est refusé (409) : la cascade rendrait l'agent muet
 *     sur ces gestes, sans que personne l'ait décidé. Une source qui porte encore des appels enregistrés aussi
 *     (409) : la base la retient, et ses appels se suppriment d'abord.
 * La route et les outils MCP passent par les MÊMES fonctions (`creerSystemeHttp`, `modifierSystemeHttp`,
 * `supprimerSystemeHttp`, `eprouverSystemeHttp`, B10, livraison 4a) : une seule règle, une seule trace.
 */

export interface AgentSourcesRouteDeps {
  /**
   * Journal d'audit (les fixtures qui ne l'observent pas passent `journalMuet`). Un connecteur est la sortie de
   * l'espace : changer son adresse change la destination de tout ce qui part.
   * 🔴 Le `detail` ne porte jamais le secret ni l'adresse complète : seulement le mode d'authentification et
   * l'hôte (le chemin et le secret permettraient de rejouer l'appel depuis une table jamais purgée).
   */
  audit: AuditSink;
  sources: {
    lister(tenantId: string): Promise<SourceVue[]>;
    parId(tenantId: string, id: string): Promise<SourceVue | null>;
    creer(tenantId: string, input: { kind: 'http'; label: string; baseUrl: string; authKind: AuthSource; authHeaderName?: string; oauth?: ConfigOAuth; authSecret?: string }): Promise<SourceVue>;
    patch(tenantId: string, id: string, patch: Record<string, unknown>): Promise<SourceVue | null>;
    supprimer(tenantId: string, id: string): Promise<boolean>;
  };
  /**
   * Éprouve la source pour de vrai : un appel, et le résultat écrit sur la ligne. Seul moyen de voir un jeton
   * mort avant qu'un contact ne le découvre (l'agent dégrade en silence).
   */
  eprouver(tenantId: string, id: string, chemin: string): Promise<ResultatEpreuve>;
}

/** Le verdict d'une épreuve : une information, jamais une erreur (un système qui ne répond pas rend `ok: false`). */
export interface ResultatEpreuve { ok: boolean; httpStatus?: number; erreur?: string }

const LABEL = z.string().trim().min(1).max(80);
const URL_BASE = z.string().trim().min(1).max(500);
const SECRET = z.string().trim().min(1).max(500);
const NOM_ENTETE = z.string().trim().regex(/^[A-Za-z0-9-]{1,64}$/, 'nom d’en-tête invalide');
const AUTH = z.enum(['none', 'bearer', 'header', 'oauth_password']);
/** La connexion OAuth sans le mot de passe (le secret). L'adresse du jeton est vérifiée par `source-configuration`. */
const OAUTH = z.object({
  tokenUrl: URL_BASE,
  clientId: z.string().trim().min(1).max(200),
  username: z.string().trim().min(1).max(200),
  scope: z.string().trim().max(200).default(''),
});

export const creationSchema = z.object({
  label: LABEL,
  baseUrl: URL_BASE,
  authKind: AUTH,
  authHeaderName: NOM_ENTETE.optional(),
  oauth: OAUTH.optional(),
  authSecret: SECRET.optional(),
});
export const patchSchema = z.object({
  label: LABEL.optional(),
  baseUrl: URL_BASE.optional(),
  authKind: AUTH.optional(),
  authHeaderName: NOM_ENTETE.nullable().optional(),
  oauth: OAUTH.optional(),
  authSecret: SECRET.optional(),
  status: z.enum(['draft', 'active', 'disabled']).optional(),
});
export const epreuveSchema = z.object({ chemin: z.string().trim().min(1).max(500).default('/') });

/** L'auteur d'une écriture : la requête de la console, ou la personne d'un outil MCP (`{ auth: { userId } }`). */
type Auteur = Parameters<ReturnType<typeof makeJournal>>[1];

const INTROUVABLE = 'source introuvable';

/**
 * Les connecteurs HTTP de l'espace, seulement : cet écran compose des chemins sous une adresse de base et éprouve par un
 * GET, gestes sans objet pour un serveur MCP. Filtré ici et non dans `lister` : l'inventaire de l'assistant de
 * configuration compte les serveurs MCP (`src/agent/setup/couverture.ts`).
 */
export async function systemesHttp(deps: Pick<AgentSourcesRouteDeps, 'sources'>, tenant: string): Promise<SourceVue[]> {
  return (await deps.sources.lister(tenant)).filter((s) => s.kind === 'http');
}

/**
 * 🔴 La source de cet espace, à condition qu'elle soit un connecteur HTTP (miroir de la garde côté MCP) : `parId`
 * ne filtre pas le `kind`, et l'identifiant d'un serveur MCP ferait sinon envoyer une requête HTTP sur son point
 * MCP avec son secret, réécrire son adresse, ou le supprimer sans la garde du store MCP.
 * `tests/sources-kind.test.ts` tient l'inventaire des lecteurs. Introuvable : pour cet écran, un serveur MCP n'existe pas.
 */
export async function connecteurHttp(deps: Pick<AgentSourcesRouteDeps, 'sources'>, tenant: string, id: string): Promise<SourceVue | null> {
  const s = await deps.sources.parId(tenant, id);
  return s && s.kind === 'http' ? s : null;
}

/** Déclarer un système (la route `POST` et `create_connector_system`). Il naît en brouillon ; sa clé peut attendre. */
export async function creerSystemeHttp(deps: AgentSourcesRouteDeps, tenant: string, corps: unknown, auteur: Auteur): Promise<Issue<SourceVue>> {
  const parse = creationSchema.safeParse(corps ?? {});
  if (!parse.success) return refus(400, 'libellé, adresse et mode d’authentification requis');
  const { label, baseUrl, authKind, authHeaderName, oauth, authSecret } = parse.data;
  const preparation = preparerCreationSource({ baseUrl, authKind, authHeaderName, oauth, authSecret }, { cleDifferee: true });
  if (!preparation.ok) return refus(400, preparation.erreur);
  try {
    const source = await deps.sources.creer(tenant, {
      kind: 'http', label, baseUrl, authKind,
      ...(authHeaderName ? { authHeaderName } : {}),
      ...(authKind === 'oauth_password' && oauth ? { oauth } : {}),
      ...(authSecret ? { authSecret } : {}),
    });
    // L'hôte, pas l'adresse complète : il répond à « où partent les données » sans graver le chemin.
    await makeJournal(deps.audit)(tenant, auteur, 'connecteur.cree', { kind: 'connecteur', id: source.id }, {
      authKind, hote: preparation.hote,
    });
    return { ok: true, valeur: source };
  } catch (err) {
    if (err instanceof LabelSourceDejaPris) return refus(409, err.message);
    throw err;
  }
}

export interface OptionsModificationSysteme {
  /**
   * Depuis Claude (B10, livraison 4a) : retirer la clé d'un système qui en porte une (passer en `none`) est refusé. Elle
   * serait détruite sans retour, et ses appels partiraient sans authentification ; la console le fait sous les yeux de la
   * personne. (Une adresse n'arrive jamais de Claude ici : `update_connector_system` ne la prend pas.)
   */
  readonly cleGardee?: boolean;
}

/** Modifier un système (la route `PATCH` et `update_connector_system`) : la configuration EFFECTIVE après écriture. */
export async function modifierSystemeHttp(
  deps: AgentSourcesRouteDeps, tenant: string, id: string, corps: unknown, auteur: Auteur, options: OptionsModificationSysteme = {},
): Promise<Issue<SourceVue>> {
  if (!estUuid(id)) return refus(404, INTROUVABLE);
  const parse = patchSchema.safeParse(corps ?? {});
  if (!parse.success) return refus(400, 'corps invalide');
  const p = parse.data;
  if (p.baseUrl !== undefined) {
    const adresse = verifierAdresseSource(p.baseUrl);
    if (!adresse.ok) return refus(400, adresse.erreur);
  }
  // L'état effectif après écriture, jamais le seul corps : sans ça, passer en `bearer` sans renvoyer le
  // secret (qui existe déjà) serait refusé à tort, et le refus ne fermerait le trou que dans un sens.
  const actuelle = await connecteurHttp(deps, tenant, id);
  if (!actuelle) return refus(404, INTROUVABLE);
  if (options.cleGardee === true && actuelle.aAuthentification && p.authKind === 'none') {
    return refus(409, 'ce système porte une clé : la retirer la détruirait sans retour ; ce geste se fait dans la console (page Connecteurs API)');
  }
  const preparation = preparerPatchSource(actuelle, p);
  if (!preparation.ok) return refus(400, preparation.erreur);
  try {
    const source = await deps.sources.patch(tenant, id, p);
    if (!source) return refus(404, INTROUVABLE);
    // `adresseChangee` est le fait qui compte : c'est le seul geste qui redirige tout ce qui part.
    await makeJournal(deps.audit)(tenant, auteur, 'connecteur.modifie', { kind: 'connecteur', id }, {
      authKind: preparation.authKind, adresseChangee: preparation.adresseChangee,
      ...(preparation.hote !== undefined ? { hote: preparation.hote } : {}),
    });
    return { ok: true, valeur: source };
  } catch (err) {
    if (err instanceof LabelSourceDejaPris) return refus(409, err.message);
    throw err;
  }
}

/** Supprimer un système (la route `DELETE` et `delete_connector_system`), refusé tant que des outils actifs ou des appels en dépendent. */
export async function supprimerSystemeHttp(
  deps: AgentSourcesRouteDeps, tenant: string, id: string, auteur: Auteur,
): Promise<Issue<{ id: string; deleted: boolean }>> {
  if (!estUuid(id)) return refus(404, INTROUVABLE);
  const actuelle = await connecteurHttp(deps, tenant, id);
  if (!actuelle) return refus(404, INTROUVABLE);
  // La cascade emporterait les outils sans bruit : on refuse et on nomme le nombre (le client désactive d'abord,
  // il supprime ensuite).
  if (actuelle.outilsActifs > 0) {
    return refus(409, `${actuelle.outilsActifs} outil(s) actif(s) utilisent cette source : désactivez-les d’abord`);
  }
  // Ses appels enregistrés le retiennent (0105, `on delete restrict`) : le store le dit, on le rend lisible.
  let supprime: boolean;
  try {
    supprime = await deps.sources.supprimer(tenant, id);
  } catch (err) {
    if (err instanceof SourcePorteDesAppels) return refus(409, err.message);
    throw err;
  }
  if (supprime) await makeJournal(deps.audit)(tenant, auteur, 'connecteur.supprime', { kind: 'connecteur', id });
  return { ok: true, valeur: { id, deleted: supprime } };
}

/** Éprouver un système (la route `POST .../epreuve` et `test_connector_system`) : un appel réel, sur son adresse. */
export async function eprouverSystemeHttp(deps: AgentSourcesRouteDeps, tenant: string, id: string, corps: unknown): Promise<Issue<ResultatEpreuve>> {
  if (!estUuid(id)) return refus(404, INTROUVABLE);
  const parse = epreuveSchema.safeParse(corps ?? {});
  if (!parse.success) return refus(400, 'chemin invalide');
  if (!(await connecteurHttp(deps, tenant, id))) return refus(404, INTROUVABLE);
  // Le résultat d'une épreuve est une information, pas une erreur de la console : un connecteur qui ne répond
  // pas rend 200 avec `ok: false`.
  return { ok: true, valeur: await deps.eprouver(tenant, id, parse.data.chemin) };
}

export function registerAgentSources(app: FastifyInstance, deps: AgentSourcesRouteDeps, garde: Guard): void {
  const opts = { preHandler: garde };
  const base = '/tenants/:tenantId/agent-sources';

  app.get(base, opts, async (req, reply) => reply.code(200).send({ sources: await systemesHttp(deps, espaceVerifie(req)) }));

  app.post(base, opts, async (req, reply) => {
    const r = await creerSystemeHttp(deps, espaceVerifie(req), req.body, req);
    return r.ok ? reply.code(201).send({ source: r.valeur }) : reply.code(r.statut).send(corpsDuRefus(r));
  });

  app.patch(`${base}/:id`, opts, async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await modifierSystemeHttp(deps, espaceVerifie(req), id, req.body, req);
    return r.ok ? reply.code(200).send({ source: r.valeur }) : reply.code(r.statut).send(corpsDuRefus(r));
  });

  app.delete(`${base}/:id`, opts, async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await supprimerSystemeHttp(deps, espaceVerifie(req), id, req);
    return r.ok ? reply.code(200).send(r.valeur) : reply.code(r.statut).send(corpsDuRefus(r));
  });

  app.post(`${base}/:id/epreuve`, opts, async (req, reply) => {
    const { id } = req.params as { id: string };
    const r = await eprouverSystemeHttp(deps, espaceVerifie(req), id, req.body);
    return r.ok ? reply.code(200).send(r.valeur) : reply.code(r.statut).send(corpsDuRefus(r));
  });
}
