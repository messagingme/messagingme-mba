import type { Pool } from 'pg';
import type { WorkflowGraph } from './graph';
import { parseGraph } from './graph';
import { evenementValide, lireEvenement, sansVariables, type EvenementDuParcours } from './evenement';

/** Le nom de l'index unique de 0298 : une seule place d'événement active par contact. */
const INDEX_EVENEMENT_ACTIF = 'workflow_runs_evenement_actif_uniq';

/**
 * Les variables d'un parcours s'effacent quand il se termine (décision 28 : des liens à clé d'accès), son origine reste.
 * TOUTE écriture du magasin qui pose un statut passe par l'un de ces deux fragments (`tests/run-store-claims.test.ts` en
 * fait l'inventaire) : `EFFACER_VARIABLES` quand le statut écrit est `done` en littéral, `EFFACER_VARIABLES_SI_TERMINAL`
 * quand il vient d'un paramètre. `null - 'variables'` reste `null` : un parcours ordinaire n'est pas touché.
 */
const EFFACER_VARIABLES = `evenement = evenement - 'variables'`;
/** Lot 5 : la même fin, et la marque d'un premier message non livré (une nouvelle tentative pourra le faire renaître). */
const EFFACER_VARIABLES_PREMIER_NON_LIVRE = `evenement = (evenement - 'variables') || '{"premierNonLivre": true}'::jsonb`;

/**
 * 🔴 LA MÊME ORIGINE DÉJÀ NÉE POUR CE CONTACT (lot 5, naissance idempotente, servie par l'index 0300) : un parcours de
 * cette origine existe, quel que soit son statut, sauf s'il a été clos sur un premier message non livré. UN SEUL texte,
 * pour la naissance (`start`, la garde de course) et pour la garde qui la précède (`evenementDejaNe`) : ils ne doivent
 * jamais diverger. `t`, `w`, `o` : les paramètres de l'espace, du contact et de l'origine.
 */
const ORIGINE_DEJA_NEE = (t: string, w: string, o: string): string => `select 1 from workflow_runs d
             where d.tenant_id = ${t}::uuid and d.wa_id = ${w}::text and d.evenement is not null
               and d.evenement->>'origine' = ${o}::text
               and not coalesce((d.evenement->>'premierNonLivre')::boolean, false)`;
function EFFACER_VARIABLES_SI_TERMINAL(statut: string): string {
  return `evenement = case when ${statut} in ('done', 'inbox') then evenement - 'variables' else evenement end`;
}

/**
 * Relit le graphe figé d'un parcours. `null` = ce parcours n'en porte pas, le cas de tous les parcours réels.
 *
 * Un refus de `parseGraph` se journalise : sinon la lecture retomberait sur le publié sans un mot. Seul ce
 * jsonb est reparsé : `workflows.graph` et `.draft_graph` sont la source (écrites via `parseGraph`), sans
 * repli possible, alors qu'ici le repli sur le publié existe et est correct.
 */
function relireGrapheFige(brut: unknown, runId: string): WorkflowGraph | null {
  if (brut === null || brut === undefined) return null;
  const graphe = parseGraph(brut);
  if (graphe === null) {
    // eslint-disable-next-line no-console
    console.error(`workflow_runs ${runId}: graphe_fige illisible, le parcours retombe sur le scénario PUBLIÉ (il peut donc changer de version en cours de route)`);
  }
  return graphe;
}

/** Une ligne de `workflow_runs` telle que la lisent `findWaitingByWaId` et `byId`. */
interface LigneRun {
  id: string; workflow_id: string; tenant_id: string; wa_id: string; contact_id: string | null;
  current_node: string | null; status: RunStatus; last_message_id: string | null;
  channel: RunChannel | null; graphe_fige: WorkflowGraph | null; accord_marketing_exige: boolean; ne_en_masse: boolean;
  evenement: unknown;
}

/**
 * La garde marketing du parcours (migration 0272), lue « !== false » : une lecture qui oublierait la colonne dans son
 * `select` ou son `returning` la rendrait `undefined`, et le parcours REFUSERAIT un Marketing sans accord (une panne qui
 * se voit) au lieu de le laisser partir (une panne muette). Le seul `false` vient de la base.
 */
function accordExigeDe(r: { accord_marketing_exige?: boolean | null }): boolean {
  return r.accord_marketing_exige !== false;
}

function runDeLigne(r: LigneRun): WorkflowRunRow {
  return {
    id: r.id, workflowId: r.workflow_id, tenantId: r.tenant_id, waId: r.wa_id,
    // La fiche du parcours : un « Aller à » vers un autre scénario la transmet au parcours qu'il démarre (RC5).
    contactId: r.contact_id,
    currentNode: r.current_node, status: r.status, lastMessageId: r.last_message_id,
    channel: r.channel ?? 'whatsapp', grapheFige: relireGrapheFige(r.graphe_fige, r.id), exigeAccordMarketing: accordExigeDe(r),
    neEnMasse: r.ne_en_masse === true,
    evenement: lireEvenement(r.evenement, r.id),
  };
}

/** Une ligne rendue par une réclamation (balayage ou réveil court) : celle de `LigneRun`, sans le statut, que la
 *  réclamation connaît par construction. */
type LigneReclamee = Omit<LigneRun, 'status'>;

function ligneReclamee(r: LigneReclamee, statut: 'sleeping' | 'waiting'): WorkflowRunRow {
  return {
    id: r.id, workflowId: r.workflow_id, tenantId: r.tenant_id, waId: r.wa_id, contactId: r.contact_id,
    currentNode: r.current_node, status: statut, lastMessageId: r.last_message_id, channel: r.channel ?? 'whatsapp', grapheFige: parseGraph(r.graphe_fige),
    exigeAccordMarketing: accordExigeDe(r),
    neEnMasse: r.ne_en_masse === true,
    evenement: lireEvenement(r.evenement, r.id),
  };
}

/** `sleeping` = le run attend que le temps passe (bloc Attente), `waiting` qu'un contact réponde. */
export type RunStatus = 'waiting' | 'inbox' | 'done' | 'sleeping';

/**
 * Canal sur lequel la conversation se poursuit, porté par le run et non par le bloc : un message rapide
 * existe en WhatsApp comme en RCS, et l'envoyer en WhatsApp après un échange RCS serait refusé par Meta
 * (fenêtre de 24 h). Un envoi RCS met le parcours sur `rcs`, un envoi de template le remet sur `whatsapp`
 * (c'est ainsi qu'on bascule volontairement). Tout le reste suit.
 */
export type RunChannel = 'whatsapp' | 'rcs';

export interface WorkflowRunRow {
  id: string;
  workflowId: string;
  tenantId: string;
  waId: string;
  contactId?: string | null;
  currentNode: string | null;
  status: RunStatus;
  lastMessageId: string | null;
  /** Canal courant. Absent (ligne ancienne) -> WhatsApp. */
  channel?: RunChannel;
  /**
   * Le graphe que ce parcours joue, figé à son démarrage. `null` = on lit le publié (le cas normal).
   *
   * Relu par `parseGraph`, jamais rendu tel quel : ce jsonb est une entrée non fiable, et `parseGraph` rend
   * `null` sur tout ce qui n'est pas un graphe (retour propre au publié). Requis et non optionnel : un store
   * qui oublierait de le lire rendrait `undefined`, et un parcours de test changerait de version en silence.
   */
  grapheFige: WorkflowGraph | null;
  /**
   * La garde marketing figée à la naissance du parcours (`workflow_runs.accord_marketing_exige`, migration 0272) : un
   * modèle Marketing n'y part qu'à une fiche `opted_in`. Requise, comme `grapheFige` : les reprises n'ont pas d'autre
   * moyen de savoir que le parcours vient d'une automation.
   */
  exigeAccordMarketing: boolean;
  /**
   * Le parcours est né d'un chemin de masse (`workflow_runs.ne_en_masse`, migration 0295, spec décision 24) : son réveil
   * « Pas de réponse » n'émet rien tant que le contact n'a pas répondu. Lu « === true » : une lecture qui oublierait la
   * colonne retombe sur le comportement d'avant (émettre), jamais sur un silence qui couperait une automation unitaire ;
   * c'est le SQL exact de `tests/run-store-claims.test.ts` qui tient la colonne dans chaque lecture.
   */
  neEnMasse: boolean;
  /**
   * L'événement dont le parcours est né (`workflow_runs.evenement`, migration 0297, menu « Scénario », lot 4) : son
   * origine et ses variables, `null` pour un parcours ordinaire. REQUIS, comme `neEnMasse` : perdu au balayage, un
   * parcours d'événement se réveillerait ordinaire, remplaçable et sans ses variables. Relu par `safeParse`.
   */
  evenement: EvenementDuParcours | null;
}

export interface RunState {
  currentNode: string | null;
  status: RunStatus;
  lastMessageId?: string | null;
  /** Canal sur lequel la suite du parcours doit partir. Absent -> inchangé en base. */
  channel?: RunChannel;
  /** Échéance de reprise (statut `sleeping`). Absente -> la colonne est remise à NULL. */
  resumeAt?: Date | null;
}

/** Suivi des runs (exécution par contact) d'un workflow. Le webhook avance un run en attente par (tenant, wa_id). */
export class PgWorkflowRunStore {
  constructor(private readonly pool: Pool) {}

  /**
   * `grapheFige`, `exigeAccordMarketing`, `neEnMasse` et `evenement` sont des paramètres à part, pas des champs de
   * `RunState` : ils s'écrivent une seule fois, à la naissance du parcours, et `setState` et ses variantes les auraient
   * ignorés en silence.
   *
   * Un second parcours d'événement actif pour le même contact viole l'index unique de 0298 (deux événements joués en
   * parallèle : l'index est la seule garantie, décision 21) : le 23505 devient le refus `evenement_actif`, que le
   * démarrage rend comme « aucun parcours », jamais un échec de campagne. Un parcours ORDINAIRE (`evenement` à `null`)
   * ne peut pas le violer : la première surcharge le dit au compilateur.
   *
   * 🔴 LOT 5, LA NAISSANCE IDEMPOTENTE PAR ORIGINE (relecture de 4b) : la relance automatique d'un envoi redemandait la
   * naissance. Un parcours d'événement ne naît pas si un parcours de la MÊME origine existe déjà pour ce contact, quel
   * que soit son statut (`deja_ne`), sauf s'il a été clos parce que son premier message n'a pas été livré
   * (`premierNonLivre`) : la nouvelle tentative le fait alors renaître, et un parcours terminé normalement ne rejoue
   * jamais sa suite. Dans la même instruction que l'insertion ; le prédicat `evenement is not null` est celui de l'index
   * partiel 0300 qui la sert, écrit tel quel.
   */
  start(
    tenantId: string, workflowId: string, waId: string, contactId: string | null, state: RunState, grapheFige: WorkflowGraph | null,
    exigeAccordMarketing: boolean, neEnMasse: boolean, evenement: null,
  ): Promise<{ id: string }>;
  start(
    tenantId: string, workflowId: string, waId: string, contactId: string | null, state: RunState, grapheFige: WorkflowGraph | null,
    exigeAccordMarketing: boolean, neEnMasse: boolean, evenement: EvenementDuParcours | null,
  ): Promise<{ id: string } | { refus: 'evenement_actif' | 'deja_ne' | 'evenement_invalide' }>;
  async start(
    tenantId: string, workflowId: string, waId: string, contactId: string | null, state: RunState, grapheFige: WorkflowGraph | null,
    exigeAccordMarketing: boolean, neEnMasse: boolean, evenement: EvenementDuParcours | null,
  ): Promise<{ id: string } | { refus: 'evenement_actif' | 'deja_ne' | 'evenement_invalide' }> {
    // `resume_at` est écrit dès la création : un scénario dont le premier passage tombe sur un bloc Attente
    // naît en sommeil, et sans échéance le balayage (`resume_at <= now()`) ne le réveillerait jamais.
    // `last_message_id` aussi : le message qui démarre un parcours (le répondeur) y naît déjà reçu, et sa redélivrance
    // par Meta n'est pas prise pour une réponse par `advance`. Absent, `null` : le cas de tous les autres démarrages.
    // Lot 5 (jaunes de 4a) : un événement illisible n'est jamais écrit (il se relirait ordinaire en tenant la place unique) ;
    // un parcours qui NAÎT terminé (la suite mène tout de suite à « Passer à un humain ») n'écrit pas ses variables.
    if (evenement !== null && !evenementValide(evenement)) return { refus: 'evenement_invalide' };
    const evenementEcrit = evenement === null ? null
      : state.status === 'done' || state.status === 'inbox' ? sansVariables(evenement) : evenement;
    const valeurs = [workflowId, tenantId, contactId, waId, state.currentNode, state.status, state.resumeAt ?? null, state.channel ?? 'whatsapp',
      grapheFige === null ? null : JSON.stringify(grapheFige), state.lastMessageId ?? null, exigeAccordMarketing, neEnMasse,
      evenementEcrit === null ? null : JSON.stringify(evenementEcrit)];
    try {
      if (evenement === null) {
        const res = await this.pool.query<{ id: string }>(
          `insert into workflow_runs (workflow_id, tenant_id, contact_id, wa_id, current_node, status, resume_at, channel, graphe_fige, last_message_id, accord_marketing_exige, ne_en_masse, evenement)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id`,
          valeurs,
        );
        return { id: res.rows[0]!.id };
      }
      const res = await this.pool.query<{ id: string }>(
        `insert into workflow_runs (workflow_id, tenant_id, contact_id, wa_id, current_node, status, resume_at, channel, graphe_fige, last_message_id, accord_marketing_exige, ne_en_masse, evenement)
         select $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text, $7::timestamptz, $8::text, $9::jsonb, $10::text, $11::boolean, $12::boolean, $13::jsonb
          where not exists (
            ${ORIGINE_DEJA_NEE('$2', '$4', '$14')}
          )
         returning id`,
        [...valeurs, evenement.origine],
      );
      const ne = res.rows[0];
      return ne === undefined ? { refus: 'deja_ne' } : { id: ne.id };
    } catch (err) {
      const e = err as { code?: unknown; constraint?: unknown };
      if (e.code === '23505' && e.constraint === INDEX_EVENEMENT_ACTIF) return { refus: 'evenement_actif' };
      throw err;
    }
  }

  /**
   * Le run en attente d'un contact (par tenant + numéro), le plus récent. Depuis le lot 4, un parcours d'événement et un
   * parcours ordinaire peuvent attendre ensemble (décision 21) : l'avance route un clic par le message qu'il cite.
   */
  async findWaitingByWaId(tenantId: string, waId: string): Promise<WorkflowRunRow | null> {
    const res = await this.pool.query<LigneRun>(
      `select id, workflow_id, tenant_id, wa_id, contact_id, current_node, status, last_message_id, channel, graphe_fige, accord_marketing_exige, ne_en_masse, evenement
       from workflow_runs where tenant_id = $1 and wa_id = $2 and status = 'waiting'
       order by created_at desc limit 1`,
      [tenantId, waId],
    );
    const r = res.rows[0];
    return r ? runDeLigne(r) : null;
  }

  /**
   * Le parcours de ce contact qui attend sur CE bloc de CE scénario (lot 4) : deux parcours peuvent attendre ensemble (un
   * parcours d'événement et un ordinaire qui coexiste, décision 21), et un clic se route par le message qu'il cite. Même
   * clause d'index que `findWaitingByWaId` (0023), plus le bloc.
   */
  async findWaitingSurBloc(tenantId: string, waId: string, workflowId: string, nodeId: string): Promise<WorkflowRunRow | null> {
    const res = await this.pool.query<LigneRun>(
      `select id, workflow_id, tenant_id, wa_id, contact_id, current_node, status, last_message_id, channel, graphe_fige, accord_marketing_exige, ne_en_masse, evenement
       from workflow_runs where tenant_id = $1 and wa_id = $2 and status = 'waiting' and workflow_id = $3 and current_node = $4
       order by created_at desc limit 1`,
      [tenantId, waId, workflowId, nodeId],
    );
    const r = res.rows[0];
    return r ? runDeLigne(r) : null;
  }

  /**
   * Un run par son identifiant, quel que soit son statut. Sert la garde du tour d'agent, qui exige que le run
   * attende toujours sur son bloc avant d'envoyer : c'est ce qui rend inoffensif tout chemin qui tue un run
   * `waiting` sans rien savoir des sessions d'agent. Tous les statuts, pour distinguer un run mort d'un run
   * introuvable.
   */
  async byId(tenantId: string, id: string): Promise<WorkflowRunRow | null> {
    const res = await this.pool.query<LigneRun>(
      `select id, workflow_id, tenant_id, wa_id, contact_id, current_node, status, last_message_id, channel, graphe_fige, accord_marketing_exige, ne_en_masse, evenement
       from workflow_runs where tenant_id = $1 and id = $2`,
      [tenantId, id],
    );
    const r = res.rows[0];
    return r ? runDeLigne(r) : null;
  }

  /**
   * Clôt tous les parcours encore actifs d'un contact (`waiting` ou `sleeping`) et rend leurs identifiants.
   *
   * Appelée par `runFrom` pour les démarrages qui REMPLACENT (Inbox, lien de test, campagnes, chaîne, publicité, widget :
   * la colonne `devantUnEvenement` de la table des lancements ; la migration 0115 porte l'index qui sert sa clause). Sans
   * elle, deux runs coexistent : `findWaitingByWaId` ne rend que le plus récent, l'autre devient orphelin pour toujours
   * pendant que le contact reçoit les messages des deux. Les démarrages qui COEXISTENT avec un parcours d'événement
   * passent par `closeOrdinairesByWaId` (décision 21).
   */
  async closeActiveByWaId(tenantId: string, waId: string): Promise<string[]> {
    // `returning id` : l'appelant doit clore les sessions d'agent rattachées à ces parcours, sinon une session
    // reste `en_cours` avec un tour jamais commencé, invisible de la reprise des tours bloqués.
    const res = await this.pool.query<{ id: string }>(
      `update workflow_runs set status = 'done', current_node = null, resume_at = null, ${EFFACER_VARIABLES}, updated_at = now()
       where tenant_id = $1 and wa_id = $2 and status in ('waiting', 'sleeping')
       returning id`,
      [tenantId, waId],
    );
    return res.rows.map((r) => r.id);
  }

  /**
   * Clôt les parcours ORDINAIRES actifs d'un contact et épargne son parcours d'événement : un répondeur, un outil d'agent
   * ou un saut coexistent avec lui (décision 21). Même clause que `closeActiveByWaId` (index 0115), plus le filtre.
   */
  async closeOrdinairesByWaId(tenantId: string, waId: string): Promise<string[]> {
    const res = await this.pool.query<{ id: string }>(
      `update workflow_runs set status = 'done', current_node = null, resume_at = null, ${EFFACER_VARIABLES}, updated_at = now()
       where tenant_id = $1 and wa_id = $2 and status in ('waiting', 'sleeping') and evenement is null
       returning id`,
      [tenantId, waId],
    );
    return res.rows.map((r) => r.id);
  }

  /**
   * Clôt les autres parcours actifs du contact, sauf celui qui prend la main : un parcours d'événement qui naît ou se
   * réveille ferme le parcours du répondeur qui coexistait (décision 21).
   */
  async cloreAutresActifs(tenantId: string, waId: string, saufId: string): Promise<string[]> {
    const res = await this.pool.query<{ id: string }>(
      `update workflow_runs set status = 'done', current_node = null, resume_at = null, ${EFFACER_VARIABLES}, updated_at = now()
       where tenant_id = $1 and wa_id = $2 and status in ('waiting', 'sleeping') and id <> $3
       returning id`,
      [tenantId, waId, saufId],
    );
    return res.rows.map((r) => r.id);
  }

  /**
   * Le parcours d'événement actif de ce contact, s'il en a un. La clause reprend MOT POUR MOT le prédicat de l'index
   * unique de 0298 (`tests/run-store-claims.test.ts` les compare) : un index partiel est un contrat avec une requête.
   */
  /**
   * Relecture de 5a (jaune 5) : la naissance de cette origine a-t-elle déjà eu lieu ? Lue par la garde du départ
   * `deja_envoye`, AVANT la reprise du fil et la suite synchrone ; `start` garde le même prédicat contre une course.
   */
  async evenementDejaNe(tenantId: string, waId: string, origine: string): Promise<boolean> {
    const res = await this.pool.query<{ ne: boolean }>(
      `select exists (
         ${ORIGINE_DEJA_NEE('$1', '$2', '$3')}
       ) as ne`,
      [tenantId, waId, origine],
    );
    return res.rows[0]?.ne === true;
  }

  async parcoursDEvenementActif(tenantId: string, waId: string): Promise<{ id: string } | null> {
    const res = await this.pool.query<{ id: string }>(
      `select id from workflow_runs where tenant_id = $1 and wa_id = $2 and evenement is not null and status in ('waiting', 'sleeping') limit 1`,
      [tenantId, waId],
    );
    return res.rows[0] ?? null;
  }

  /**
   * Décision 35 : le parcours d'événement de ce contact s'il DORT dans une Attente, avec l'origine par laquelle on l'arrête.
   * Le prédicat de l'index unique de 0298 écrit tel quel, plus le sommeil (`tests/run-store-claims.test.ts`). Sans origine,
   * rien ne pourrait l'arrêter : il n'est pas rendu, et la remise ordinaire garde la main.
   */
  async parcoursDEvenementEndormi(tenantId: string, waId: string): Promise<{ id: string; origine: string } | null> {
    const res = await this.pool.query<{ id: string; origine: string | null }>(
      `select id, evenement->>'origine' as origine from workflow_runs
        where tenant_id = $1 and wa_id = $2 and evenement is not null and status in ('waiting', 'sleeping') and status = 'sleeping'
        limit 1`,
      [tenantId, waId],
    );
    const r = res.rows[0];
    return r && r.origine !== null ? { id: r.id, origine: r.origine } : null;
  }

  /**
   * 🔴 LOT 5 : LE PREMIER MESSAGE D'UN PARCOURS D'ÉVÉNEMENT N'A PAS ÉTÉ LIVRÉ (accusé `failed` de Meta, relecture de 4b).
   * Le parcours est né quand Meta a ACCEPTÉ le template ; resté sur son bloc de départ, il est clos (aucun envoi : rien
   * n'est parti de lui), ses variables effacées et la marque `premierNonLivre` posée, pour qu'une nouvelle tentative
   * d'envoi le fasse renaître (`start`, naissance idempotente). 🔴 Il est clos aussi quand il a quitté ce bloc SANS un mot
   * du contact (`last_message_id` vide, relecture de 5a) : un premier bloc sans choix part dans la naissance et le parcours
   * dort déjà sur l'attente qui suit, alors que le contact n'a rien reçu. Un parcours que le contact a fait avancer en
   * répondant continue. L'accusé ne connaît que l'identifiant du message : l'espace et le contact se lisent dans sa mesure « envoyé »,
   * écrite par nous à l'envoi (comme `recordStatusForMessage`, index partiel `idx_wf_node_events_message`), puis la
   * clôture filtre par eux, au prédicat de l'index 0298 écrit tel quel. Rend le nombre de parcours clos (0 ou 1).
   */
  async clorePremierNonLivre(metaMessageId: string): Promise<number> {
    const res = await this.pool.query(
      `update workflow_runs r set status = 'done', current_node = null, resume_at = null, ${EFFACER_VARIABLES_PREMIER_NON_LIVRE}, updated_at = now()
         from (select tenant_id, wa_id from workflow_node_events
                where meta_message_id = $1 and kind = 'sent' limit 1) m
        where r.tenant_id = m.tenant_id and r.wa_id = m.wa_id
          and r.evenement is not null and r.status in ('waiting', 'sleeping')
          and r.evenement->>'messageId' = $1
          and (r.current_node = r.evenement->>'noeudDepart' or r.last_message_id is null)`,
      [metaMessageId],
    );
    return res.rowCount ?? 0;
  }

  /**
   * Clôt les parcours d'événement actifs nés de cette origine (une commande née du panier arrête le parcours du panier,
   * décision 4 ; appelée au lot 5). Rend les identifiants clos, pour fermer leurs sessions d'agent.
   */
  async cloreParOrigine(tenantId: string, origine: string): Promise<string[]> {
    const res = await this.pool.query<{ id: string }>(
      `update workflow_runs set status = 'done', current_node = null, resume_at = null, ${EFFACER_VARIABLES}, updated_at = now()
       where tenant_id = $1 and status in ('waiting', 'sleeping') and evenement is not null and evenement->>'origine' = $2
       returning id`,
      [tenantId, origine],
    );
    return res.rows.map((r) => r.id);
  }

  /**
   * Clôt les parcours d'événement actifs de ces scénarios (boutique en pause, ligne éteinte : décision 15 ; appelée au
   * lot 5). Une liste vide ne clôt rien, sans requête.
   */
  async cloreParScenarios(tenantId: string, workflowIds: readonly string[]): Promise<string[]> {
    if (workflowIds.length === 0) return [];
    const res = await this.pool.query<{ id: string }>(
      `update workflow_runs set status = 'done', current_node = null, resume_at = null, ${EFFACER_VARIABLES}, updated_at = now()
       where tenant_id = $1 and status in ('waiting', 'sleeping') and evenement is not null and workflow_id = any($2::uuid[])
       returning id`,
      [tenantId, workflowIds],
    );
    return res.rows.map((r) => r.id);
  }

  /**
   * Lot 5 : clôt les parcours d'événement actifs dont l'origine COMMENCE par ce préfixe (`shopify:<domaine>:` pour la
   * boutique en pause, `shopify:<domaine>:checkouts/abandoned:` pour la ligne du panier éteinte ou les autres paniers d'un
   * contact, décisions 15 et 33), pour un contact ou pour tout l'espace. `starts_with` et jamais `like`, où `_` serait un
   * joker. Un saut change le scénario d'un parcours, jamais son origine : c'est elle qui se lit. Prédicat de l'index 0298
   * écrit tel quel (servi pour un contact). Rend les identifiants clos, pour fermer leurs sessions d'agent.
   */
  async cloreParPrefixe(tenantId: string, prefixe: string, waId?: string): Promise<string[]> {
    if (prefixe === '') return [];
    const res = await this.pool.query<{ id: string }>(
      `update workflow_runs set status = 'done', current_node = null, resume_at = null, ${EFFACER_VARIABLES}, updated_at = now()
       where tenant_id = $1 and evenement is not null and status in ('waiting', 'sleeping')
         and starts_with(evenement->>'origine', $2) and ($3::text is null or wa_id = $3::text)
       returning id`,
      [tenantId, prefixe, waId ?? null],
    );
    return res.rows.map((r) => r.id);
  }

  /**
   * Réserve le tour d'avance d'un parcours, avant tout envoi : c'est ce qui ferme le double envoi, que
   * `setStateSiEncoreSur` (qui arrive après les envois) ne peut pas empêcher.
   *
   * Rend `null` quand un autre traitement tient déjà le tour : l'appelant sort alors sans rien faire (même
   * convention que `prendreLeTour` d'une session d'agent). Les trois pièces du verrou :
   * - le bail (`avance_jusqu_a`) : un worker tué ne bloque pas le parcours à vie ;
   * - le jeton, rendu à l'appelant, seul moyen de libérer : un porteur de bail périmé ne peut pas libérer le
   *   verrou de celui qui l'a repris ;
   * - la garde sur `current_node`, qui refuse le tour si le parcours a bougé pendant qu'on lisait.
   */
  async reserverAvance(
    tenantId: string, id: string, nodeId: string | null, bailSecondes: number, siDernierMessage?: { lastMessageId: string | null },
  ): Promise<string | null> {
    // `siDernierMessage` : la reprise d'une échéance réserve SOUS la condition du dernier message qu'elle a réclamé. Une
    // réponse traitée entre la réclamation et la reprise, qui laisse le parcours sur son bloc, la fait renoncer
    // (relecture de 2b-1). `advance` ne la passe pas.
    const res = await this.pool.query<{ avance_token: string }>(
      // 🔴 La réservation ne date PAS l'activité du parcours (`updated_at`, que lit la règle « un parcours tient le fil ») :
      // elle précède la garde du gel, et un parcours gelé, ou qui attend sur un autre canal, se remettrait à tenir le fil
      // à chaque message du contact (relecture de 5a, `tests/integration/reservation-avance-gel.integration.test.ts`).
      `update workflow_runs
          set avance_token = gen_random_uuid(),
              avance_jusqu_a = now() + make_interval(secs => $4::double precision)
        where id = $1 and tenant_id = $2 and status = 'waiting'
          and current_node is not distinct from $3
          and (avance_jusqu_a is null or avance_jusqu_a <= now())
          and ($5::boolean is not true or last_message_id is not distinct from $6::text)
        returning avance_token`,
      [id, tenantId, nodeId, bailSecondes, siDernierMessage !== undefined, siDernierMessage?.lastMessageId ?? null],
    );
    return res.rows[0]?.avance_token ?? null;
  }

  /**
   * Prolonge le bail tant que l'avance travaille (cadence et raison : `bail-avance.ts`).
   *
   * Le jeton est la seule garde, sans condition sur `avance_jusqu_a` : un bail expiré que personne n'a repris
   * est encore le nôtre (un battement en retard), on peut le reprolonger. Si un autre l'a repris, le jeton a
   * changé, aucune ligne ne bouge, et `false` arrête le battement.
   */
  async prolongerAvance(id: string, token: string, bailSecondes: number): Promise<boolean> {
    const res = await this.pool.query(
      `update workflow_runs
          set avance_jusqu_a = now() + make_interval(secs => $3::double precision)
        where id = $1 and avance_token = $2`,
      [id, token, bailSecondes],
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Rend le tour. Le jeton est dans le `where` : un porteur de bail périmé, revenu tard, ne peut pas libérer
   * le verrou de celui qui l'a repris. Best-effort chez l'appelant : un échec coûte au pire l'attente du bail.
   */
  async libererAvance(id: string, token: string): Promise<void> {
    await this.pool.query(
      `update workflow_runs set avance_token = null, avance_jusqu_a = null where id = $1 and avance_token = $2`,
      [id, token],
    );
  }

  /**
   * Écrit l'état d'un run seulement s'il attend encore sur le bloc qu'on croit, avec le jeton d'avance. Rend
   * `false` si rien n'a bougé.
   *
   * Un tour d'agent dure de 3 à 30 s et écrit son état à la fin ; entre-temps, tout démarrage de scénario
   * (`closeActiveByWaId`) peut avoir tué le run. Un `setState` inconditionnel le ressusciterait en `waiting`
   * avec une échéance, que `claimDueQuestions` réveillerait plus tard en parallèle du nouveau parcours. Le
   * jeton empêche en plus un porteur de bail périmé d'écrire par-dessus celui qui a repris le tour.
   *
   * `token` à `null` = l'appelant ne tient pas de réservation (l'échéance d'inactivité écrite par un tour d'agent,
   * `majRun` dans `src/worker.ts`) : la garde du jeton ne s'applique pas. L'avance d'un parcours, elle, réserve
   * toujours (`reserverAvance` est requise depuis la piste 8 du rapport d'architecture du 2026-10-02). Le
   * `is null` porte sur le paramètre, pas sur la colonne : un appelant qui tient un jeton est toujours confronté à
   * celui de la ligne.
   */
  async setStateSiEncoreSur(tenantId: string, id: string, nodeId: string | null, state: RunState, token: string | null = null): Promise<boolean> {
    const res = await this.pool.query(
      `update workflow_runs set current_node = $4, status = $5,
              last_message_id = coalesce($6, last_message_id), resume_at = $7,
              channel = coalesce($8, channel), ${EFFACER_VARIABLES_SI_TERMINAL('$5::text')}, updated_at = now()
        -- « is not distinct from » et non « = » : un run peut légitimement attendre AVEC current_node à
        -- null (parcours sans position, clôture). Avec « = », null = null vaut NULL, donc la garde ne
        -- trouvait jamais la ligne et l'écriture était silencieusement PERDUE. Pour toute valeur non nulle,
        -- les deux opérateurs sont identiques : la garde n'est pas affaiblie.
        where id = $1 and tenant_id = $2 and status = 'waiting' and current_node is not distinct from $3
          and ($9::uuid is null or avance_token = $9::uuid)`,
      [id, tenantId, nodeId, state.currentNode, state.status, state.lastMessageId ?? null, state.resumeAt ?? null, state.channel ?? null, token],
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Écrit l'état d'un run seulement s'il est encore vivant (`waiting` ou `sleeping`). Rend `false` s'il a été
   * clos entre-temps.
   *
   * La reprise d'un parcours endormi (`resume`) écrit à la fin, après des envois qui prennent du temps. Si
   * `closeActiveByWaId` est passé entre-temps (une fois par destinataire de campagne), un `setState`
   * réécrirait `waiting`/`sleeping` avec une échéance sur un run `done` : invisible de `findWaitingByWaId`,
   * mais réveillable par les balayages, il parlerait au client depuis un scénario abandonné. Pendant de
   * `setStateSiEncoreSur`, qui garde le bloc attendu ; ici la reprise change de bloc par construction.
   */
  async setStateSiVivant(tenantId: string, id: string, state: RunState): Promise<boolean> {
    const res = await this.pool.query(
      `update workflow_runs set current_node = $3, status = $4, last_message_id = coalesce($5, last_message_id),
              resume_at = $6, channel = coalesce($7, channel), ${EFFACER_VARIABLES_SI_TERMINAL('$4::text')}, updated_at = now()
       where id = $1 and tenant_id = $2 and status in ('waiting', 'sleeping')`,
      [id, tenantId, state.currentNode, state.status, state.lastMessageId ?? null, state.resumeAt ?? null, state.channel ?? null],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async setState(id: string, state: RunState): Promise<void> {
    // `resume_at` sans coalesce : quitter le sommeil doit effacer l'échéance, sinon un run réveillé resterait
    // éligible au balayage suivant.
    await this.pool.query(
      // `channel` avec coalesce : un état écrit sans canal (clôture, remontée en inbox) ne doit pas ramener le
      // parcours sur WhatsApp par omission.
      `update workflow_runs set current_node = $2, status = $3, last_message_id = coalesce($4, last_message_id),
              resume_at = $5, channel = coalesce($6, channel), ${EFFACER_VARIABLES_SI_TERMINAL('$3::text')}, updated_at = now()
       where id = $1`,
      [id, state.currentNode, state.status, state.lastMessageId ?? null, state.resumeAt ?? null, state.channel ?? null],
    );
  }

  /**
   * Réclame les runs dormants dus (bail, voir `claimDue`) et rend les lignes prises, en une requête : un
   * `select` puis un `update` séparés réveilleraient le même parcours deux fois, donc enverraient en double.
   */
  async claimDueSleeping(limit: number): Promise<WorkflowRunRow[]> {
    return this.claimDue('sleeping', limit);
  }

  /**
   * Réclame les parcours qui attendent une réponse et dont le délai « pas de réponse » a expiré (bloc
   * Question, bloc template à délai, inactivité d'un agent). Le nom est historique : la Question fut la première.
   *
   * Même bail que `claimDueSleeping` : consommer l'échéance (`resume_at = null`) perdrait pour toujours une
   * reprise ratée (refus de Meta, worker redéployé), le parcours restant `waiting` sans échéance. Avec le bail,
   * une reprise interrompue redevient due 15 minutes plus tard ; c'est la reprise elle-même qui efface
   * l'échéance (ses écritures passent `resume_at` sans coalesce). Une reprise qui n'obtient pas le tour n'écrit rien :
   * la ligne redevient due au bout du bail.
   *
   * Le run reste `waiting`, donc une réponse du contact peut le reprendre à tout instant : on n'avale jamais
   * une réponse, et l'ordre inverse (réponse puis échéance) est sûr, `advance` effaçant `resume_at`.
   */
  async claimDueQuestions(limit: number): Promise<WorkflowRunRow[]> {
    return this.claimDue('waiting', limit);
  }

  /**
   * La réclamation commune aux deux balayages : un bail de 15 minutes sur les runs dus du statut donné, pris
   * d'un bloc et rendus en une requête.
   *
   * Bail, pas changement de statut. Passer un dormant à `waiting` le mettrait à portée de `advance` (un
   * message pendant la reprise rejouerait le même bloc et enverrait deux fois), et un worker tué laisserait un
   * run `waiting` figé que n'importe quel message ressusciterait. Avec le bail, un worker tué rend simplement
   * la ligne due à nouveau.
   *
   * Le bail doit couvrir la reprise de tout un lot (`batchSize`, 50) au pire cas, relances Meta comprises
   * (withRetry + Retry-After) : sinon la passe suivante re-réclame les derniers runs et deux reprises tournent
   * sur le même parcours.
   *
   * `created_at` borné à 90 jours : deux blocs Attente qui se pointent l'un l'autre se relanceraient pour
   * toujours (le sweeper clôt ces runs à part). Le statut est écrit en littéral, jamais en paramètre : un
   * paramètre priverait le planificateur des index partiels posés sur `status`.
   */
  private async claimDue(statut: 'sleeping' | 'waiting', limit: number): Promise<WorkflowRunRow[]> {
    const res = await this.pool.query<LigneReclamee>(
      `update workflow_runs r set resume_at = now() + interval '15 minutes', updated_at = now()
       from (
         select id from workflow_runs
         where status = '${statut}' and resume_at is not null and resume_at <= now()
           and created_at > now() - interval '90 days'
         order by resume_at
         for update skip locked
         limit $1
       ) due
       where r.id = due.id
       returning r.id, r.workflow_id, r.tenant_id, r.wa_id, r.contact_id, r.current_node, r.last_message_id, r.channel, r.graphe_fige, r.accord_marketing_exige, r.ne_en_masse, r.evenement`,
      [limit],
    );
    return res.rows.map((r) => ligneReclamee(r, statut));
  }

  /**
   * Réclame UN parcours dormant par son identifiant : c'est le réveil court (`reveil-court.ts`) qui l'appelle à
   * l'échéance d'une pause de moins d'une minute. Même bail et mêmes bornes que `claimDue`, donc le balayage et le
   * minuteur ne peuvent pas reprendre le même parcours deux fois : celui qui obtient la ligne la sort des dus.
   *
   * La tolérance de 2 s couvre l'écart entre l'horloge du processus, qui a calculé `resume_at`, et celle de Postgres :
   * sans elle, un minuteur un peu en avance trouverait l'échéance future et laisserait la pause au balayage, jusqu'à
   * une minute plus tard. Le balayage garde sa condition stricte. Rend `null` quand la ligne n'est pas prise.
   */
  async claimSleepingById(tenantId: string, id: string): Promise<WorkflowRunRow | null> {
    const res = await this.pool.query<LigneReclamee>(
      `update workflow_runs r set resume_at = now() + interval '15 minutes', updated_at = now()
       from (
         select id from workflow_runs
         where tenant_id = $1 and id = $2 and status = 'sleeping' and resume_at is not null
           and resume_at <= now() + interval '2 seconds'
           and created_at > now() - interval '90 days'
         for update skip locked
       ) due
       where r.id = due.id
       returning r.id, r.workflow_id, r.tenant_id, r.wa_id, r.contact_id, r.current_node, r.last_message_id, r.channel, r.graphe_fige, r.accord_marketing_exige, r.ne_en_masse, r.evenement`,
      [tenantId, id],
    );
    const r = res.rows[0];
    return r ? ligneReclamee(r, 'sleeping') : null;
  }

  /**
   * Clôt les parcours dormants trop vieux. `created_at` est l'âge du run, pas du sommeil : cela clôt surtout
   * un parcours abandonné, et accessoirement une chaîne d'attentes sans fin. Rend le nombre de parcours clos.
   */
  async closeStaleSleeping(maxAgeDays = 90): Promise<number> {
    const res = await this.pool.query(
      `update workflow_runs set status = 'done', resume_at = null, ${EFFACER_VARIABLES}, updated_at = now()
       where status = 'sleeping' and created_at <= now() - make_interval(days => $1)`,
      [maxAgeDays],
    );
    return res.rowCount ?? 0;
  }

  /**
   * Purge les parcours terminés plus vieux que la rétention (ils portent le `wa_id`, donnée personnelle, et
   * plus rien ne les relit).
   *
   * 🔴 Un parcours vivant n'est jamais effacé, quel que soit son âge : le filtre porte sur les statuts
   * terminaux (`done`, `inbox`), comme l'index partiel de la migration 0097. Un run `waiting` ou `sleeping`
   * très vieux est une anomalie à corriger ailleurs, pas une ligne à supprimer sous les pieds d'un contact.
   */
  async purgeTerminesOlderThan(days: number, maxParPassage = 50_000): Promise<number> {
    if (days <= 0) return 0;
    const res = await this.pool.query(
      `delete from workflow_runs
        where id in (
          select id from workflow_runs
           where status in ('done', 'inbox') and updated_at < now() - make_interval(days => $1)
           limit $2
        )`,
      [Math.floor(days), Math.max(1, maxParPassage)],
    );
    return res.rowCount ?? 0;
  }
}
