import type { AuthSource } from '../agent/sources';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { gardeEtendue, type Guard, type PreHandler } from '../auth/middleware';
import { LabelSourceDejaPris } from '../agent/sources';
import type { RisqueOutil } from '../agent/catalog';
import type { SourceParam } from '../agent/llm/tool-schema';
import type { RafraichissementMcp } from '../agent/mcp/rafraichissement';
import { CHAMPS_CONTACT_AUTORISES, estChampContact } from '../agent/champs-contact';
import { preparerCreationSource } from '../agent/source-configuration';
import { espaceVerifie, estUuid } from './scope';
import { makeJournal, type AuditSink } from '../audit/journal';
import { corpsDuRefus, refus, type Issue } from '../lib/issue';

/**
 * Les connecteurs MCP : prévisualiser et importer le catalogue d'un serveur, régler ce qu'on en expose. Un serveur MCP est
 * une adresse que notre serveur appelle, un secret, et un catalogue d'outils écrit par un tiers dont les
 * descriptions entrent dans le contexte du modèle. Trois gardes :
 *  1. 🔴 l'adresse est vérifiée à l'écriture comme à l'appel, par la même fonction ;
 *  2. l'import montre avant d'écrire : `apercu` rend le plan, suppressions comprises ;
 *  3. un clouage désigne un champ qui existe.
 * La traduction d'une annonce en outil vit dans `src/agent/mcp/import.ts`, pure et testable.
 */

/** Un serveur MCP tel que l'écran le voit. Le secret n'y est pas, et il ne doit jamais y entrer. */
export interface ServeurMcpVue {
  id: string;
  label: string;
  baseUrl: string;
  /** Toujours l'un des trois premiers pour un serveur MCP (la route refuse `oauth_password`) ; le type est celui de la
   *  table, que le store des sources partage. */
  authKind: AuthSource;
  authHeaderName: string | null;
  status: string;
  lastOkAt: string | null;
  lastError: string | null;
}

/**
 * Un outil importé, tel que l'écran le montre. `annonce` part au client : c'est le schéma annoncé par le serveur,
 * sans secret, la seule chose qu'il puisse montrer à son fournisseur quand un outil est refusé.
 */
export interface OutilMcpVue {
  id: string;
  name: string;
  nomDistant: string;
  title: string;
  description: string;
  nePasUtiliser: string;
  params: Array<{ name: string; type: string; source: SourceParam; required?: boolean; description?: string; cle?: string; contactPath?: string; value?: string | number | boolean; cheminMcp?: string }>;
  risk: RisqueOutil;
  annonce: unknown;
  /** `null` = activable. Sinon la raison, affichée telle quelle. */
  nonActivable: string | null;
  indisponibleLe: string | null;
  consommateursActifs: number;
  /** Proposé aux agents de l'espace (0199) : décoché, il ne s'offre à aucun agent. */
  propose: boolean;
  /** Les agents qui l'ont (rattaché, actif ou non), par leur nom : « Agent de Meta », le nom d'un agent IA. */
  utilisePar: string[];
}

/** Ce que les routes lisent et écrivent des serveurs MCP et de leurs outils importés. */
export interface McpDep {
  listerServeurs(tenantId: string): Promise<ServeurMcpVue[]>;
  /**
   * Supprime un serveur MCP. Trois états, pas un booléen : « supprimé », « introuvable » et « outils actifs »
   * (409) doivent se distinguer, sinon un serveur utilisé se supprimerait avec ses outils et consentements.
   */
  supprimerServeur(tenantId: string, id: string): Promise<'supprime' | 'introuvable' | 'outils_actifs'>;
  /** Les outils importés, pour l'écran. Séparée de la lecture d'import, qui compare et rien de plus. */
  outilsPourEcran(tenantId: string, sourceId: string): Promise<OutilMcpVue[]>;
  /** Le réglage d'un outil importé. Rend `false` si l'outil n'est pas de cet espace. */
  reglerOutil(tenantId: string, outilId: string, patch: {
    params?: Array<{ name: string; source: SourceParam; cle?: string; contactPath?: string; value?: string | number | boolean }>;
    risk?: RisqueOutil;
    nePasUtiliser?: string;
  }): Promise<boolean>;
  /**
   * Proposer ou retirer un outil aux agents de l'espace. Retirer est refusé tant qu'un agent l'a : le refus rend
   * leurs noms. `null` = outil introuvable dans cet espace.
   */
  proposer(tenantId: string, outilId: string, propose: boolean): Promise<{ ok: true } | { utilisePar: string[] } | null>;
}

export interface AgentMcpRouteDeps {
  /**
   * Journal d'audit (les fixtures qui ne l'observent pas passent `journalMuet`). Un serveur MCP est une sortie de
   * l'espace, comme un connecteur API : le supprimer emporte par cascade ses outils et leurs consentements.
   * 🔴 Le `detail` ne porte jamais le secret ni l'adresse complète : seulement le mode d'authentification et l'hôte.
   */
  audit: AuditSink;
  mcp: McpDep;
  /** Le cycle distant et transactionnel de l'aperçu et de l'import. */
  rafraichissement: RafraichissementMcp;
  /**
   * Déclare un serveur MCP : seul chemin qui écrit `kind = 'mcp'` (la route des connecteurs API écrit
   * `kind: 'http'`).
   */
  creerServeur(tenantId: string, input: {
    label: string; baseUrl: string;
    authKind: 'none' | 'bearer' | 'header'; authHeaderName?: string; authSecret?: string;
  }): Promise<ServeurMcpVue>;
  /** Les clés des champs personnalisés déclarés par l'espace : un clouage doit en désigner une. */
  clesDeChamps(tenantId: string): Promise<string[]>;
}

export const creationSchema = z.object({
  label: z.string().trim().min(1).max(80),
  /** L'adresse du point MCP : une adresse unique, pas une racine sous laquelle on compose des chemins. */
  baseUrl: z.string().trim().min(1).max(500),
  authKind: z.enum(['none', 'bearer', 'header']),
  authHeaderName: z.string().trim().regex(/^[A-Za-z0-9-]{1,64}$/).optional(),
  authSecret: z.string().trim().min(1).max(500).optional(),
});

const CLE_CHAMP = z.string().trim().min(1).max(64);
export const reglageSchema = z.object({
  risk: z.enum(['read', 'write', 'irreversible']).optional(),
  nePasUtiliser: z.string().trim().max(2000).optional(),
  params: z.array(z.object({
    name: z.string().trim().min(1).max(64),
    source: z.enum(['modele', 'contact', 'champ', 'fixe']),
    cle: CLE_CHAMP.optional(),
    contactPath: z.string().trim().min(1).max(64).optional(),
    value: z.union([z.string().max(500), z.number(), z.boolean()]).optional(),
  })).max(100).optional(),
});

export const proposeSchema = z.object({ propose: z.boolean() }).strict();

/** L'auteur d'une écriture : la requête de la console, ou la personne d'un outil MCP (`{ auth: { userId } }`). */
type Auteur = Parameters<ReturnType<typeof makeJournal>>[1];

const IDENTIFIANT_INVALIDE = 'identifiant invalide';

/** Les serveurs MCP de l'espace (la route `GET` et `list_mcp_servers`, B10, livraison 4c). */
export async function serveursMcp(deps: Pick<AgentMcpRouteDeps, 'mcp'>, tenant: string): Promise<ServeurMcpVue[]> {
  return deps.mcp.listerServeurs(tenant);
}

/**
 * Déclarer un serveur MCP (la route `POST` et `create_mcp_server`). L'adresse est validée à l'écriture, par la même
 * fonction que les connecteurs API. Le secret est chiffré par le store, jamais ici.
 */
export async function creerServeurMcp(deps: AgentMcpRouteDeps, tenant: string, corps: unknown, auteur: Auteur): Promise<Issue<ServeurMcpVue>> {
  const parse = creationSchema.safeParse(corps ?? {});
  if (!parse.success) return refus(400, 'libellé, adresse et mode d’authentification requis');
  const { label, baseUrl, authKind, authHeaderName, authSecret } = parse.data;
  const preparation = preparerCreationSource({ baseUrl, authKind, authHeaderName, authSecret });
  if (!preparation.ok) return refus(400, preparation.erreur);
  /**
   * Un libellé déjà pris rend 409, pas 500 : l'index unique `(tenant_id, lower(label))` porte sur tous les
   * `kind`, connecteurs API compris.
   */
  let serveur: ServeurMcpVue;
  try {
    serveur = await deps.creerServeur(tenant, {
      label, baseUrl, authKind,
      ...(authHeaderName ? { authHeaderName } : {}),
      ...(authSecret ? { authSecret } : {}),
    });
  } catch (err) {
    if (err instanceof LabelSourceDejaPris) return refus(409, `le nom « ${label} » est déjà pris par un autre connecteur`);
    throw err;
  }
  await makeJournal(deps.audit)(tenant, auteur, 'connecteur.cree', { kind: 'connecteur', id: serveur.id }, {
    mcp: true, authKind: parse.data.authKind, hote: preparation.hote,
  });
  return { ok: true, valeur: serveur };
}

/**
 * Supprimer un serveur (la route `DELETE` et `delete_mcp_server`) : refusé tant qu'un outil actif en dépend (409), comme
 * un connecteur API. La garde vit dans la même transaction que la suppression.
 */
export async function supprimerServeurMcp(deps: AgentMcpRouteDeps, tenant: string, sourceId: string, auteur: Auteur): Promise<Issue<{ id: string; deleted: true }>> {
  if (!estUuid(sourceId)) return refus(400, IDENTIFIANT_INVALIDE);
  const verdict = await deps.mcp.supprimerServeur(tenant, sourceId);
  if (verdict === 'introuvable') return refus(404, 'serveur introuvable');
  if (verdict === 'outils_actifs') return refus(409, 'ce serveur porte encore des outils actifs : désactivez-les d’abord');
  await makeJournal(deps.audit)(tenant, auteur, 'connecteur.supprime', { kind: 'connecteur', id: sourceId }, { mcp: true });
  return { ok: true, valeur: { id: sourceId, deleted: true } };
}

/**
 * Les outils importés d'un serveur (la route `GET .../outils` et `list_mcp_server_tools`) : sans cette lecture, l'écran ne
 * pourrait ni les voir ni les clouer. Les deux listes de clouage partent avec : l'écran propose un choix, pas un champ
 * libre, et les recopier côté navigateur ferait diverger la liste proposée de la liste acceptée.
 */
export async function outilsDuServeurMcp(deps: Pick<AgentMcpRouteDeps, 'mcp' | 'clesDeChamps'>, tenant: string, sourceId: string) {
  if (!estUuid(sourceId)) return refus(400, IDENTIFIANT_INVALIDE);
  const [outils, champs] = await Promise.all([deps.mcp.outilsPourEcran(tenant, sourceId), deps.clesDeChamps(tenant)]);
  return { ok: true as const, valeur: { outils, champs, champsContact: [...CHAMPS_CONTACT_AUTORISES] } };
}

/**
 * L'aperçu (la route `POST .../apercu` et `preview_mcp_import`) : le plan, sans rien écrire dans le catalogue ; ou
 * l'import (`POST .../importer` et `import_mcp_tools`) : le même plan, appliqué, qui active un serveur en brouillon.
 */
export async function rafraichirServeurMcp(
  deps: Pick<AgentMcpRouteDeps, 'rafraichissement'>, tenant: string, sourceId: string, geste: 'apercevoir' | 'importer',
): Promise<Issue<{ plan: unknown; tronque: unknown }>> {
  if (!estUuid(sourceId)) return refus(400, IDENTIFIANT_INVALIDE);
  const r = geste === 'apercevoir' ? await deps.rafraichissement.apercevoir(tenant, sourceId) : await deps.rafraichissement.importer(tenant, sourceId);
  if (!r.ok && r.cause === 'introuvable') return refus(404, 'serveur introuvable');
  if (!r.ok) return refus(422, r.erreur);
  return { ok: true, valeur: { plan: r.plan, tronque: r.tronque } };
}

/**
 * Le réglage d'un outil importé (la route `PATCH` et `update_mcp_tool`) : la source de chaque paramètre, le risque, et
 * quand ne pas l'appeler. Un clouage désigne un champ qui existe, vérifié ici : sinon le paramètre partirait vide à
 * chaque appel.
 */
export async function reglerOutilMcp(deps: Pick<AgentMcpRouteDeps, 'mcp' | 'clesDeChamps'>, tenant: string, outilId: string, corps: unknown): Promise<Issue<{ ok: true }>> {
  if (!estUuid(outilId)) return refus(400, IDENTIFIANT_INVALIDE);
  const parse = reglageSchema.safeParse(corps);
  if (!parse.success) return refus(400, 'réglage invalide');
  const d = parse.data;
  if (d.params) {
    const cles = await deps.clesDeChamps(tenant);
    for (const p of d.params) {
      if (p.source === 'champ') {
        if (!p.cle) return refus(400, `le paramètre « ${p.name} » doit désigner un champ`);
        if (!cles.includes(p.cle)) return refus(400, `le champ « ${p.cle} » n’existe pas dans cet espace`);
      }
      /**
       * 🔴 Un clouage `contact` désigne un attribut de la liste fermée (`champs-contact.ts`), rien d'autre :
       * sinon `contactPath: 'champs'` enverrait tout le jsonb des champs du contact au serveur tiers. Et sans
       * `contactPath`, l'exécuteur chercherait `p.name` sur le contact et enverrait `null`.
       */
      if (p.source === 'contact') {
        if (!p.contactPath) return refus(400, `le paramètre « ${p.name} » doit désigner un attribut de la fiche`);
        if (!estChampContact(p.contactPath)) return refus(400, `« ${p.contactPath} » n’est pas un attribut de fiche autorisé`);
      }
      // `fixe` sans valeur est refusé, comme un `champ` sans clé : le paramètre partirait vide à chaque appel.
      if (p.source === 'fixe' && p.value === undefined) return refus(400, `le paramètre « ${p.name} » doit porter une valeur`);
    }
  }
  return (await deps.mcp.reglerOutil(tenant, outilId, d)) ? { ok: true, valeur: { ok: true } } : refus(404, 'outil introuvable');
}

/**
 * Proposer un outil importé aux agents de l'espace, ou le retirer (la route `PUT .../propose` et `set_mcp_tool_proposed` ;
 * Julien, 2026-10-02 : on choisit d'abord ici, puis sur chaque agent). Retirer un outil qu'un agent a déjà est refusé en
 * 409, avec les noms.
 */
export async function proposerOutilMcp(deps: Pick<AgentMcpRouteDeps, 'mcp'>, tenant: string, outilId: string, corps: unknown): Promise<Issue<{ propose: boolean }>> {
  if (!estUuid(outilId)) return refus(400, IDENTIFIANT_INVALIDE);
  const parse = proposeSchema.safeParse(corps);
  if (!parse.success) return refus(400, 'valeur booléenne requise');
  const r = await deps.mcp.proposer(tenant, outilId, parse.data.propose);
  if (r === null) return refus(404, 'outil introuvable');
  if ('utilisePar' in r) {
    return refus(409, `utilisé par ${r.utilisePar.join(', ')} : retirez-le d’abord de ${r.utilisePar.length > 1 ? 'ces agents' : 'cet agent'}`, { utilisePar: r.utilisePar });
  }
  return { ok: true, valeur: { propose: parse.data.propose } };
}

export function registerAgentMcp(
  app: FastifyInstance,
  deps: AgentMcpRouteDeps,
  garde: Guard,
  limiteCouteuse?: PreHandler,
): void {
  const opts = { preHandler: garde };
  // L'aperçu et l'import sont lourds (session vers un serveur tiers, catalogue paginé) : ils portent
  // `RATE_LIMIT_COUTEUX_PAR_MINUTE`, comme l'import CSV et l'aperçu d'un site.
  const lourd = gardeEtendue(garde, limiteCouteuse);
  type Reponse = { code(n: number): { send(b?: unknown): unknown } };
  const repondre = <T>(reply: Reponse, r: Issue<T>, code = 200) => (r.ok ? reply.code(code).send(r.valeur) : reply.code(r.statut).send(corpsDuRefus(r)));

  app.get('/tenants/:tenantId/mcp', opts, async (req, reply) => reply.code(200).send({ serveurs: await serveursMcp(deps, espaceVerifie(req)) }));

  app.post('/tenants/:tenantId/mcp', opts, async (req, reply) => {
    const r = await creerServeurMcp(deps, espaceVerifie(req), req.body, req);
    return r.ok ? reply.code(201).send({ serveur: r.valeur }) : reply.code(r.statut).send(corpsDuRefus(r));
  });

  app.delete('/tenants/:tenantId/mcp/:sourceId', opts, async (req, reply) => {
    const { sourceId } = req.params as { sourceId: string };
    const r = await supprimerServeurMcp(deps, espaceVerifie(req), sourceId, req);
    return r.ok ? reply.code(204).send() : reply.code(r.statut).send(corpsDuRefus(r));
  });

  app.get('/tenants/:tenantId/mcp/:sourceId/outils', opts, async (req, reply) => {
    const { sourceId } = req.params as { sourceId: string };
    return repondre(reply, await outilsDuServeurMcp(deps, espaceVerifie(req), sourceId));
  });

  /**
   * L'aperçu : le plan, sans rien écrire dans le catalogue. En `POST` : ce chemin ouvre une connexion sortante et
   * écrit `marquerEpreuve`, et en `GET` un préchargement ou un robot suffirait à le déclencher.
   */
  app.post('/tenants/:tenantId/mcp/:sourceId/apercu', lourd, async (req, reply) => {
    const { sourceId } = req.params as { sourceId: string };
    return repondre(reply, await rafraichirServeurMcp(deps, espaceVerifie(req), sourceId, 'apercevoir'));
  });

  /** L'import : le même plan, appliqué. */
  app.post('/tenants/:tenantId/mcp/:sourceId/importer', lourd, async (req, reply) => {
    const { sourceId } = req.params as { sourceId: string };
    return repondre(reply, await rafraichirServeurMcp(deps, espaceVerifie(req), sourceId, 'importer'));
  });

  app.patch('/tenants/:tenantId/mcp/outils/:outilId', opts, async (req, reply) => {
    const { outilId } = req.params as { outilId: string };
    return repondre(reply, await reglerOutilMcp(deps, espaceVerifie(req), outilId, req.body));
  });

  app.put('/tenants/:tenantId/mcp/outils/:outilId/propose', opts, async (req, reply) => {
    const { outilId } = req.params as { outilId: string };
    return repondre(reply, await proposerOutilMcp(deps, espaceVerifie(req), outilId, req.body));
  });
}
