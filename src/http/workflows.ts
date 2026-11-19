import type { FastifyInstance } from 'fastify';
import { gardeEtendue, type Guard, type PreHandler } from '../auth/middleware';
import { parseGraph, isWorkflowNodeType } from '../workflow/graph';
import type { WorkflowGraph } from '../workflow/graph';
import type { WorkflowRow, MajScenario, Programmation } from '../workflow/store.pg';
import type { WorkflowResumeRow } from '../workflow/store.pg';
import { mintNodeCodes } from '../workflow/node-codes';
import { collectNodes } from '../workflow/node-list';
import { newTestToken, waMeTestLink } from '../workflow/test-token';
import { grapheEditable, WorkflowUtiliseParLienChaine } from '../workflow/store.pg';
import { makeJournal, type AuditSink } from '../audit/journal';
import { espaceVerifie, nonEmpty, estUuid } from './scope';
import { executerFonctionJs } from '../workflow/fonction-js';
import { sautsDeLaCopie } from '../workflow/aller-a';
import { controlesDePublication } from '../workflow/publication';
import {
  creerModeleDuBloc, jugerPublication, modelesDuGraphe, programmerMenage, type DepsCreationDeBloc, type DepsPublication,
} from '../workflow/modeles-de-bloc';
import { tagsInGraph } from '../workflow/tags-du-graphe';
import type { Rayon } from '../workflow/rayon';
import { departsDuScenario, type Lanceur } from '../../web/lib/partage/fenetre-scenario';
import { blocVerrouille, refusSelonLeVerrou } from '../shopify/premier-bloc';

/**
 * La sauvegarde n'exige pas qu'un scénario commence par un template : un scénario qui ouvre sur un message de
 * session est valide pour un déclenchement où la fenêtre est garantie. Les deux protections contre un envoi hors
 * fenêtre (Meta 131047) sont ailleurs : la garde de campagne (`http/campaigns.ts`, 400 si l'entrée n'est pas un
 * template) et la garde d'exécution (`workflow/executor.ts`, levée selon le type de lancement : `fenetreLevee`).
 */

/** Ce que les routes lisent et écrivent des scénarios. */
export interface ScenariosDep {
  insert(tenantId: string, name: string, graph: WorkflowGraph, rayon: Rayon): Promise<{ id: string }>;
  list(tenantId: string, rayon: Rayon): Promise<WorkflowRow[]>;
  /**
   * La liste résumée servie au navigateur : jamais les graphes, mais le nombre de blocs, l'existence d'un
   * brouillon et l'éligibilité en campagne, qui sont les trois seules choses que les écrans en tiraient.
   */
  listResume(tenantId: string, rayon: Rayon): Promise<WorkflowResumeRow[]>;
  /** Ce qui lance ce scénario (automations allumées, campagnes actives) : ses départs, pour les avertissements du builder. */
  lanceursDuScenario(tenantId: string, id: string): Promise<Lanceur[]>;
  getById(id: string, tenantId: string): Promise<WorkflowRow | null>;
  update(id: string, tenantId: string, patch: { name?: string; graph?: WorkflowGraph }): Promise<MajScenario>;
  /**
   * Met le brouillon en ligne, seul chemin de la console qui touche le graphe exécuté (et qui efface une version
   * programmée). Rend la ligne à jour, null si le scénario n'est pas au tenant.
   */
  publish(id: string, tenantId: string, graphe?: WorkflowGraph): Promise<WorkflowRow | null>;
  /** Programme la mise en ligne du graphe jugé (lot 3, décision 18). null si le scénario n'est pas au tenant. */
  programmer(id: string, tenantId: string, par: string | null, graphe: WorkflowGraph): Promise<{ le: string } | null>;
  /** La version programmée de ce scénario, ou null. */
  publicationProgrammee(id: string, tenantId: string): Promise<Programmation | null>;
  /** Annule la version programmée (à sa date, ou sans condition quand `le` est null). false : il n'y en avait pas. */
  annulerProgrammation(id: string, tenantId: string, le: string | null): Promise<boolean>;
  remove(id: string, tenantId: string): Promise<boolean>;
  /** Ce qui utilise ce scénario (automation, widget, répondeur, campagne, « Aller à »…), en phrases : vide = il peut partir. */
  utilisationsDuScenario(tenantId: string, id: string): Promise<string[]>;
  /** Pose (une fois) le jeton de test du scénario et le renvoie. null si le scénario n'est pas au tenant. */
  ensureTestToken(id: string, tenantId: string, token: string): Promise<string | null>;
}

/**
 * Les templates écrits depuis un bloc et la publication programmée (menu « Scénario », lot 3). Requis : la valeur inerte
 * des tests (`modelesDeBlocInertes`, aucune ligne) reproduit exactement la publication d'avant le lot.
 */
export interface ModelesDeBlocDep {
  creation: DepsCreationDeBloc;
  publication: DepsPublication;
}

export interface WorkflowRouteDeps {
  scenarios: ScenariosDep;
  /** Code client racine (tenants.public_code, self-heal) : sert à minter les codes publics des nodes au save. */
  tenantCode(tenantId: string): Promise<string>;
  publicites: {
    /**
     * Les publicités vivantes qui utilisent ce scénario, par leur nom ; vide = la suppression passe. Requise :
     * `publicites.workflow_id` est en `on delete set null`, donc un `delete` réussirait en silence et laisserait
     * une publicité dont les prospects, qui ont coûté un clic, n'arrivent nulle part. Les tests qui n'en parlent
     * pas déclarent `aucunePubliciteUtilise` (`tests/pubs-fixtures.ts`).
     */
    publicitesQuiUtilisent(tenantId: string, workflowId: string): Promise<string[]>;
  };
  /** Journal d'audit (les fixtures qui ne l'observent pas passent `journalMuet`). */
  audit: AuditSink;
  /** Déclare dans le référentiel Tags les tags saisis dans les blocs « ajout de tag » du graphe (best-effort). */
  declareTags(tenantId: string, tags: string[]): Promise<void>;
  /** Numéro WhatsApp affiché du tenant, pour construire le lien wa.me. null si aucun numéro connecté. */
  getDisplayPhoneNumber(tenantId: string): Promise<string | null>;
  modelesDeBloc: ModelesDeBlocDep;
}

/** L'identifiant d'un bloc tel que l'éditeur le pose (`n1`, `node_…`) : rien d'autre n'entre dans l'adresse. */
const ID_DE_BLOC = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * Ce que l'éditeur affiche d'une version programmée : les templates qu'elle attend encore (non approuvés), et, quand il
 * n'en reste aucun, les campagnes actives qui retiennent sa mise en ligne.
 */
async function vueDeLaProgrammation(
  deps: WorkflowRouteDeps, tenant: string, id: string, p: Programmation,
): Promise<{ le: string; attend: Array<{ modele: string; langue: string; etat: string; raison: string | null }>; campagnes: string[] }> {
  const lignes = await deps.modelesDeBloc.publication.lignes.desModeles(tenant, modelesDuGraphe(p.graphe));
  const attend = lignes.filter((l) => l.etat !== 'approuve').map(({ modele, langue, etat, raison }) => ({ modele, langue, etat, raison }));
  const campagnes = attend.length > 0 ? []
    : (await deps.scenarios.lanceursDuScenario(tenant, id)).filter((l) => l.type === 'campagne').map((l) => l.nom);
  return { le: p.le, attend, campagnes };
}

/**
 * Routes du bot builder (workflows), admin via `garde`, espace du JWT. Le graphe est toujours validé par
 * `parseGraph` avant persistance (400 si invalide). bodyLimit relevé : un graphe porte de la config par bloc.
 * `limiteCouteuse` borne la création d'un template chez Meta depuis un bloc, comme l'assistant Shopify.
 */
export function registerWorkflows(app: FastifyInstance, deps: WorkflowRouteDeps, garde: Guard, limiteCouteuse?: PreHandler): void {
  const opts = { preHandler: garde, bodyLimit: 2 * 1024 * 1024 };
  const optsLourds = gardeEtendue(garde, limiteCouteuse);
  const journal = makeJournal(deps.audit);

  /**
   * Éprouver une « Fonction JS » sur une valeur d'essai, depuis l'écran du bloc. Déclarée avant `/workflows/:id`
   * (sinon `js-test` serait lu comme un identifiant). 🔴 Du code écrit par le client tourne ici sur notre
   * infrastructure : par le même bac à sable et les mêmes plafonds que le parcours.
   */
  app.post('/tenants/:tenantId/workflows/js-test', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const b = (req.body ?? {}) as { code?: unknown; valeur?: unknown; champSource?: unknown };
    if (typeof b.code !== 'string') return reply.code(400).send({ error: 'code requis' });
    // La valeur d'essai est une chaîne, comme le sera le champ source à l'exécution : accepter un nombre ici
    // ferait réussir un essai que le parcours ne saurait pas reproduire.
    const valeur = typeof b.valeur === 'string' ? b.valeur : '';
    // 200 même en cas d'échec : l'erreur est le résultat de l'essai, pas une panne de la route. Le champ source
    // voyage jusqu'ici : le paramètre de la fonction porte son nom, comme à l'exécution. Il n'est pas validé ici,
    // `nomDeParametreSur` refuse déjà tout identifiant non sûr et retombe sur `valeur`.
    const champSource = typeof b.champSource === 'string' ? b.champSource : undefined;
    return reply.code(200).send(await executerFonctionJs(b.code, valeur,
      champSource ? { nomParametre: champSource } : {}));
  });

  app.post('/tenants/:tenantId/workflows', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const b = (req.body ?? {}) as { name?: unknown; graph?: unknown };
    if (!nonEmpty(b.name)) return reply.code(400).send({ error: 'name requis' });
    // graph optionnel à la création (démarrage vide) ; s'il est fourni, il doit être valide.
    const parsed = b.graph === undefined ? { nodes: [], edges: [] } : parseGraph(b.graph);
    if (parsed === null) return reply.code(400).send({ error: 'graphe invalide (nodes/edges, types, arêtes orphelines)' });
    // Mint serveur des codes publics de node (nod_<client>_<ulid>) : rempli/re-minté ici, jamais imposé par le client.
    const graph = mintNodeCodes(parsed, await deps.tenantCode(tenant));
    // Créé depuis le Builder : rayon général. Les rayons Shopify et HubSpot naissent de leur automation.
    const { id } = await deps.scenarios.insert(tenant, b.name.trim(), graph, 'general');
    // Rend les tags des blocs « ajout de tag » visibles tout de suite dans Contenus > Tags (best-effort : ne
    // fait jamais échouer la sauvegarde du workflow).
    try { await deps.declareTags(tenant, tagsInGraph(graph)); } catch { /* best-effort */ }
    return reply.code(201).send({ id, name: b.name.trim(), graph });
  });

  // Dupliquer un scénario : un nouveau scénario « X (copie) » (puis « (copie 2) »…). Codes de node re-mintés :
  // `mintNodeCodes` conserverait sinon les codes valides, et la copie partagerait les identifiants publics de
  // l'original (contrat API cassé). Le `code` du scénario est minté frais à l'insertion.
  app.post('/tenants/:tenantId/workflows/:id/duplicate', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const { id } = req.params as { id: string };
    if (!estUuid(id)) return reply.code(404).send({ error: 'workflow inconnu' });
    const source = await deps.scenarios.getById(id, tenant);
    if (!source) return reply.code(404).send({ error: 'workflow inconnu' });

    // La copie reste dans le rayon de l'original, où son nom doit être libre.
    const taken = new Set((await deps.scenarios.list(tenant, source.rayon)).map((w) => w.name));
    let name = `${source.name} (copie)`;
    for (let n = 2; taken.has(name); n += 1) name = `${source.name} (copie ${n})`;

    // Retire le code de chaque node avant de re-minter. On copie ce que l'auteur voit (le brouillon s'il y en a
    // un), pas la version en ligne ; la copie naît en brouillon (cf. `insert`).
    const modele = grapheEditable(source);
    const stripped: WorkflowGraph = {
      nodes: modele.nodes.map((node) => ({ ...node, data: { ...node.data, code: undefined } })),
      edges: modele.edges,
    };
    // Les « Aller à » internes suivent la copie (RC5) : sans ça, ils viseraient les blocs de l'original.
    const graph = sautsDeLaCopie(modele, mintNodeCodes(stripped, await deps.tenantCode(tenant)));
    const { id: newId } = await deps.scenarios.insert(tenant, name, graph, source.rayon);
    try { await deps.declareTags(tenant, tagsInGraph(graph)); } catch { /* best-effort */ }
    return reply.code(201).send({ id: newId, name, graph });
  });

  app.get('/tenants/:tenantId/workflows', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    // Le résumé, pas les graphes : les écrans de liste n'affichent qu'un nom, et le graphe complet reste sur
    // `GET /workflows/:id`.
    return reply.code(200).send({ workflows: await deps.scenarios.listResume(tenant, 'general') });
  });

  // Contenu > Blocs : liste à plat de tous les nodes des scénarios de l'espace, requêtable par ?type=. Chaque
  // node porte son code public (nod_..., ou null s'il n'a jamais été re-sauvegardé). Lecture dérivée des workflows.
  app.get('/tenants/:tenantId/nodes', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const q = (req.query ?? {}) as { type?: unknown; scenario?: unknown };
    const type = isWorkflowNodeType(q.type) ? q.type : undefined;
    // Les blocs du Builder : un code `nod_` ne se résout que là (`/v1`, décision 1 du menu « Scénario »). Le builder d'un
    // scénario d'automation demande ceux de SON rayon (`?scenario=`, jaune du lot 2) : un « Aller à » reste dans le rayon.
    let rayon: Rayon = 'general';
    if (typeof q.scenario === 'string' && estUuid(q.scenario)) rayon = (await deps.scenarios.getById(q.scenario, tenant))?.rayon ?? 'general';
    const workflows = await deps.scenarios.list(tenant, rayon);
    return reply.code(200).send({ nodes: collectNodes(workflows, type) });
  });

  app.get('/tenants/:tenantId/workflows/:id', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const { id } = req.params as { id: string };
    if (!estUuid(id)) return reply.code(404).send({ error: 'workflow inconnu' });
    const wf = await deps.scenarios.getById(id, tenant);
    if (!wf) return reply.code(404).send({ error: 'workflow inconnu' });
    // Les départs du scénario (menu « Scénario », lot 2) : la console en tire ses avertissements de fenêtre, sans jamais
    // refuser (décision 16). Une console plus ancienne ignore le champ.
    const departs = departsDuScenario(wf.rayon, await deps.scenarios.lanceursDuScenario(tenant, id));
    return reply.code(200).send({ workflow: wf, departs });
  });

  app.patch('/tenants/:tenantId/workflows/:id', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const { id } = req.params as { id: string };
    if (!estUuid(id)) return reply.code(404).send({ error: 'workflow inconnu' });
    const b = (req.body ?? {}) as { name?: unknown; graph?: unknown };

    const patch: { name?: string; graph?: WorkflowGraph } = {};
    if (b.name !== undefined) {
      if (!nonEmpty(b.name)) return reply.code(400).send({ error: 'name vide' });
      patch.name = b.name.trim();
    }
    if (b.graph !== undefined) {
      const graph = parseGraph(b.graph);
      if (graph === null) return reply.code(400).send({ error: 'graphe invalide (nodes/edges, types, arêtes orphelines)' });
      // Mint serveur des codes de node (code valide du tenant conservé, absent/étranger re-minté).
      patch.graph = mintNodeCodes(graph, await deps.tenantCode(tenant));
    }
    if (Object.keys(patch).length === 0) return reply.code(400).send({ error: 'rien à modifier (name/graph)' });
    // 🔴 Le verrou du premier bloc (rayons d'automation : Shopify au lot 5, HubSpot au lot 6 ; décisions 13 et 23) : le graphe
    // enregistré garde le bloc marqué du graphe en place, un template où rien ne mène. La marque n'est posée que par le serveur.
    // Lot 6b (décision 41) : seulement pour un scénario qui PORTE un bloc marqué (`refusSelonLeVerrou`).
    if (patch.graph) {
      const enPlace = await deps.scenarios.getById(id, tenant);
      if (!enPlace) return reply.code(404).send({ error: 'workflow inconnu' });
      if (enPlace.rayon !== 'general') {
        const refus = refusSelonLeVerrou(patch.graph, [enPlace.graph, enPlace.draftGraph], blocVerrouille(grapheEditable(enPlace))?.id ?? null);
        if (refus !== null) return reply.code(422).send({ error: `Enregistrement refusé : ${refus}.`, code: 'premier_bloc_verrouille' });
      }
    }

    const maj = await deps.scenarios.update(id, tenant, patch);
    if (!maj.trouve) return reply.code(404).send({ error: 'workflow inconnu' });
    if (patch.graph) { try { await deps.declareTags(tenant, tagsInGraph(patch.graph)); } catch { /* best-effort */ } }
    // `brouillon` : reste-t-il quelque chose à publier après cette écriture ? C'est la base qui répond, et
    // c'est ce qui allume (ou éteint) le bouton « Publier ». L'éditeur ne peut pas le déduire seul : un
    // enregistrement identique au publié n'y laisse rien, et il s'en produit un à la simple ouverture d'un
    // scénario (React Flow mesure les blocs au montage).
    return reply.code(200).send({ id, ...patch, brouillon: maj.brouillon });
  });

  /**
   * Met en ligne le brouillon (ou PROGRAMME sa mise en ligne, lot 3) : avec l'API et la mise en ligne d'une version
   * programmée, le seul chemin qui touche le graphe publié, donc qui change quelque chose pour les
   * contacts. Un parcours déjà en cours bascule sur la nouvelle version, une campagne programmée part avec la
   * version en ligne le jour de l'expédition. Sans retour arrière : la version précédente n'est conservée nulle part.
   */
  app.post('/tenants/:tenantId/workflows/:id/publish', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const { id } = req.params as { id: string };
    if (!estUuid(id)) return reply.code(404).send({ error: 'workflow inconnu' });
    /**
     * 🔴 LES BLOCS « ALLER À » SE VÉRIFIENT AVANT LA MISE EN LIGNE (RC5) : une cible inexistante, et la fenêtre de 24 h
     * qui suit le saut vers un autre scénario (`refusDePublication`). Seulement s'il y a un brouillon : sans lui, la
     * publication ne change rien. Les autres scénarios se lisent ici, scopés à l'espace, dans leur version PUBLIÉE. Un
     * scénario inconnu tombe plus bas, sur le 404 de `publish`, comme avant.
     */
    const avant = await deps.scenarios.getById(id, tenant);
    if (avant?.draftGraph) {
      const brouillon = avant.draftGraph;
      // Les contrôles du graphe (Question qui attend un fichier, « Puis, sans attendre », « Aller à » du même rayon) :
      // les mêmes que la mise en ligne d'une version programmée rejoue (`controlesDePublication`).
      const refus = await controlesDePublication(brouillon, id, () => deps.scenarios.list(tenant, avant.rayon), avant.rayon);
      if (refus !== null) return reply.code(422).send({ error: `Publication refusée : ${refus.message}.`, code: refus.code });
      // 🔴 Un template écrit depuis un bloc et encore en validation chez Meta (lot 3, décision 18) : la mise en ligne se
      // PROGRAMME (202), sous réserve qu'aucune campagne active n'utilise le scénario. Un scénario sans template de bloc
      // passe ici sans aucune lecture de plus, et se publie comme avant.
      const jugement = await jugerPublication(deps.modelesDeBloc.publication, tenant, id, brouillon);
      if (jugement.type === 'refus') return reply.code(422).send({ error: `Publication refusée : ${jugement.erreur}`, code: jugement.code });
      if (jugement.type === 'programmer') {
        const programmee = await deps.scenarios.programmer(id, tenant, req.auth?.userId ?? null, brouillon);
        if (!programmee) return reply.code(404).send({ error: 'workflow inconnu' });
        await journal(tenant, req, 'workflow.publication_programmee', { kind: 'workflow', id }, { modeles: jugement.attend.length });
        return reply.code(202).send({ id, programmee: { le: programmee.le, attend: jugement.attend } });
      }
    }
    // Le brouillon JUGÉ, pas celui du moment (relecture de 3a) : un enregistrement tombé pendant le jugement reste un brouillon.
    const row = await deps.scenarios.publish(id, tenant, avant?.draftGraph ?? undefined);
    if (!row) return reply.code(404).send({ error: 'workflow inconnu' });
    // Le ménage des templates que cette version remplace (rayons d'automation, spec § 5.1) : best-effort, il ne bloque rien.
    if (avant) await programmerMenage(deps.modelesDeBloc.publication.menage, tenant, avant.rayon, avant.graph, row.graph);
    // Le journal porte qui a publié : la table `workflows`, elle, ne garde que la date. Détail non identifiant
    // (un nombre de blocs), comme partout dans ce journal.
    await journal(tenant, req, 'workflow.published', { kind: 'workflow', id }, { blocs: row.graph.nodes.length });
    return reply.code(200).send({ id, graph: row.graph, publishedAt: row.publishedAt ?? null });
  });

  /**
   * ─── Écrire un template depuis un bloc (menu « Scénario », lot 3) ───
   *
   * Le corps est celui de `POST /templates`, sans le nom : il naît côté serveur (décision 19). Le bloc doit exister dans
   * le graphe que l'éditeur ouvre : la console vide son enregistrement automatique avant d'appeler. Sous le plafond des
   * opérations coûteuses (une création chez Meta par appel).
   */
  app.post('/tenants/:tenantId/workflows/:id/blocs/:nodeId/modele', optsLourds, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const { id, nodeId } = req.params as { id: string; nodeId: string };
    if (!estUuid(id)) return reply.code(404).send({ error: 'workflow inconnu' });
    if (!ID_DE_BLOC.test(nodeId)) return reply.code(404).send({ error: 'bloc inconnu' });
    const corps = (req.body ?? {}) as Record<string, unknown>;
    const issue = await creerModeleDuBloc(deps.modelesDeBloc.creation, tenant, { workflowId: id, nodeId, corps, par: req.auth?.userId ?? null });
    if (!issue.ok) return reply.code(issue.statut).send({ error: issue.erreur });
    await journal(tenant, req, 'workflow.modele_soumis', { kind: 'workflow', id }, { etat: issue.etat });
    return reply.code(201).send({ modele: issue.modele, langue: issue.langue, etat: issue.etat, categorie: issue.categorie, boutons: issue.boutons });
  });

  /**
   * L'état des templates de bloc que NOMME le brouillon (par nom : un scénario dupliqué voit ceux qu'un autre a créés,
   * comme le jugement de « Publier »), et la version programmée : l'éditeur les sonde.
   */
  app.get('/tenants/:tenantId/workflows/:id/modeles', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const { id } = req.params as { id: string };
    if (!estUuid(id)) return reply.code(404).send({ error: 'workflow inconnu' });
    const scenario = await deps.scenarios.getById(id, tenant);
    if (!scenario) return reply.code(404).send({ error: 'workflow inconnu' });
    const lignes = await deps.modelesDeBloc.publication.lignes.desModeles(tenant, modelesDuGraphe(grapheEditable(scenario)));
    const p = await deps.scenarios.publicationProgrammee(id, tenant);
    return reply.code(200).send({
      modeles: lignes.map(({ modele, langue, etat, raison, creeLe }) => ({ modele, langue, etat, raison, creeLe })),
      programmee: p ? await vueDeLaProgrammation(deps, tenant, id, p) : null,
    });
  });

  /** Annuler la mise en ligne programmée : la version en ligne ne change pas, le brouillon non plus. */
  app.delete('/tenants/:tenantId/workflows/:id/programmation', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const { id } = req.params as { id: string };
    if (!estUuid(id)) return reply.code(404).send({ error: 'workflow inconnu' });
    if (!(await deps.scenarios.annulerProgrammation(id, tenant, null))) return reply.code(404).send({ error: 'aucune mise en ligne programmée' });
    await journal(tenant, req, 'workflow.programmation_annulee', { kind: 'workflow', id });
    return reply.code(204).send();
  });

  app.delete('/tenants/:tenantId/workflows/:id', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const { id } = req.params as { id: string };
    if (!estUuid(id)) return reply.code(404).send({ error: 'workflow inconnu' });
    /**
     * 🔴 Le refus se pose avant la suppression : la clé étrangère des publicités est en `on delete set null`, et
     * placé après, ce contrôle regarderait une publicité qui a déjà perdu son scénario.
     */
    const pubs = await deps.publicites.publicitesQuiUtilisent(tenant, id);
    if (pubs.length > 0) {
      return reply.code(409).send({
        error: `ce scénario répond aux prospects de ${pubs.length > 1 ? 'ces publicités' : 'cette publicité'} : ${pubs.slice(0, 3).join(', ')}${pubs.length > 3 ? '…' : ''}. Changez leur destination, ou supprimez-les, puis réessayez.`,
        code: 'utilise_par_publicite',
      });
    }
    // La même garde que l'API (`supprimerParApi`) : une automation partait en cascade, un widget ou le répondeur
    // perdaient leur scénario sans bruit.
    const utilise = await deps.scenarios.utilisationsDuScenario(tenant, id);
    if (utilise.length > 0) {
      return reply.code(409).send({
        error: `ce scénario sert encore : ${utilise.slice(0, 5).join(', ')}${utilise.length > 5 ? '…' : ''}. Retirez-le d’abord de là, puis réessayez.`,
        code: 'scenario_in_use',
      });
    }
    try {
      const ok = await deps.scenarios.remove(id, tenant);
      if (!ok) return reply.code(404).send({ error: 'workflow inconnu' });
      return reply.code(200).send({ ok: true });
    } catch (err) {
      // `channelsme_links.workflow_id` est en `on delete restrict` : sans cette traduction, la violation 23503
      // sortirait en 500, sans dire qu'un lien de chaîne bloque.
      if (err instanceof WorkflowUtiliseParLienChaine) {
        return reply.code(409).send({ error: 'ce scénario est utilisé par un lien de chaîne WhatsApp : éteins le lien, puis réessaie' });
      }
      throw err;
    }
  });

  /**
   * Lien de test d'un scénario : le jeton, le lien wa.me et le numéro, pour tester depuis son téléphone sans
   * campagne. POST : le premier appel pose le jeton, idempotent ensuite. `link` null = aucun numéro connecté ; le
   * jeton est rendu quand même (le testeur peut écrire le mot à la main).
   */
  app.post('/tenants/:tenantId/workflows/:id/test-link', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const { id } = req.params as { id: string };
    if (!estUuid(id)) return reply.code(404).send({ error: 'workflow inconnu' });
    const token = await deps.scenarios.ensureTestToken(id, tenant, newTestToken());
    if (token === null) return reply.code(404).send({ error: 'workflow inconnu' });
    const phone = await deps.getDisplayPhoneNumber(tenant);
    return reply.code(200).send({ token, phone, link: waMeTestLink(phone, token) });
  });
}
