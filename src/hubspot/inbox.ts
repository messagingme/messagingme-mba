import type { Pool } from 'pg';
import { classifyWaId } from '../crm/identity';
import { e164DepuisSaisie } from '../crm/phone';
import { journaliser } from '../lib/journal';
import type { OrigineMessage } from '../inbox/origine';
import type { IssueInbox, MessageInboxHubspot } from '../crm/hubspot-service';
import { ATTEND_UN_HUMAIN_SQL, CONTACT_JOIGNABLE_SQL } from '../inbox/a-traiter-hubspot.pg';

/**
 * LES CONVERSATIONS WHATSAPP DANS L'INBOX HUBSPOT, CÔTÉ mba (lot 1 de l'Inbox, tâche 6 du plan
 * `~/mm-hubspot/docs/2026-11-06-inbox-hubspot-lot1-plan.md`).
 *
 * 🔴 AUCUN CHEMIN D'ENVOI N'EST TOUCHÉ : le balayage `hubspot-inbox` RELIT `conversation_messages` et pousse au
 * connecteur ce qui est apparu depuis son curseur. Le curseur est le couple (created_at, id) du dernier message poussé,
 * et la lecture s'arrête à `now() - 30 s` : chaque écriture de message est une instruction unique commitée aussitôt
 * (`recordInbound`, `recordOutboundByWaId`, la journalisation des réponses), donc un message n'apparaît jamais avec un
 * `created_at` antérieur de plus de 30 s à l'instant où il devient visible. Un rejeu après panne repousse le même lot :
 * HubSpot le déduplique par l'identifiant du message (`integrationIdempotencyId`).
 *
 * 🔴 LE CURSEUR EST UN TEXTE À LA MICROSECONDE, jamais un `Date` : Postgres stocke `created_at` à la microseconde, le
 * pilote `pg` le rendrait tronqué à la milliseconde, et le dernier message poussé repasserait le curseur à chaque tour
 * (relu, republié toutes les 15 s). Le piège et sa preuve : `tests/integration/curseur-precision.integration.test.ts`.
 * Le curseur ne recule jamais (`avancer` ne réécrit qu'un instant plus récent).
 *
 * 🔴 LOT 1 BIS (2026-11-09, décision de Julien) : SEULES LES CONVERSATIONS QUI ATTENDENT UN HUMAIN entrent dans l'Inbox,
 * selon le prédicat de la page « Messaging Me » (`ATTEND_UN_HUMAIN_SQL`, importé, jamais recopié). À l'entrée, leur
 * contexte part (24 h, 20 messages au plus) ; ensuite tout ce qu'elles écrivent, tant que l'équipe les tient. Une
 * conversation rendue à un robot, « Traité » ou archivée sort (`inbox_hubspot_entrees.sortie_le`) : plus rien ne part.
 *
 * La ligne WhatsApp est le premier numéro de l'espace, la règle de la poussée d'analyse et du passage à l'équipe
 * (`getEnrichment`, `getEtatPassage`) : une conversation ne porte pas son numéro.
 */

export const RETARD_S = 30;
export const LOT_INBOX = 50;
/** Le contexte publié à l'entrée d'une conversation : ses messages des dernières 24 h, 20 au plus. */
export const CONTEXTE_HEURES = 24;
export const CONTEXTE_MAX = 20;
/** Au plus autant de conversations entrent par espace et par tour : chacune coûte un lot chez le connecteur. */
export const ENTREES_PAR_TOUR = 10;
/** Un identifiant plus petit que tout uuid : le curseur « tout ce qui suit cet instant ». */
export const UUID_ZERO = '00000000-0000-0000-0000-000000000000';

/** `curseurLe` : un instant UTC à la MICROSECONDE (`2026-11-06T12:00:00.043689Z`), jamais un `Date`. */
export interface EspaceBranche { tenantId: string; boite: string; curseurLe: string; curseurId: string }
export interface LigneEspace { affichage: string; connectee: boolean; enPause: boolean }
export interface LigneMessage {
  id: string;
  conversationId: string;
  direction: 'in' | 'out';
  type: string | null;
  body: string | null;
  buttonPayload: string | null;
  origin: OrigineMessage | null;
  /** À la microseconde, comme le curseur qu'il deviendra. */
  createdAt: string;
  waId: string;
  nom: string | null;
  membre: string | null;
}

export interface InboxHubspotStore {
  espacesBranches(): Promise<EspaceBranche[]>;
  lireBoite(tenantId: string): Promise<string | null>;
  /** Branche (ou rebranche) l'espace sur une boîte ; le curseur part de maintenant (aucun historique publié). */
  brancher(tenantId: string, boite: string): Promise<void>;
  debrancher(tenantId: string): Promise<void>;
  /** La première ligne de l'espace et sa porte HubSpot, null sans numéro. */
  ligne(tenantId: string): Promise<LigneEspace | null>;
  /** `now() - RETARD_S` selon l'horloge de la BASE, celle qui écrit `created_at`. */
  borne(): Promise<string>;
  /** Les messages WhatsApp de l'espace après le curseur et jusqu'à la borne, dans l'ordre du curseur. */
  messagesApres(e: EspaceBranche, borne: string, limite: number): Promise<LigneMessage[]>;
  /** Avance le curseur, seulement si l'espace est toujours branché et sans jamais le faire reculer. */
  avancer(tenantId: string, le: string, id: string): Promise<void>;
  /**
   * Ferme les entrées des conversations que l'équipe ne tient plus (robot, « Traité », archivée) ou dont le contact a dit
   * STOP ou a été bloqué. Rend leur nombre.
   */
  fermerSorties(tenantId: string): Promise<number>;
  /**
   * Les conversations qui attendent un humain (`ATTEND_UN_HUMAIN_SQL`), actives depuis le branchement, sans entrée
   * ouverte : celles qui doivent entrer.
   */
  aFaireEntrer(tenantId: string, limite: number): Promise<string[]>;
  /** Le contexte d'une conversation qui entre : ses messages WhatsApp des dernières 24 h, 20 au plus, dans l'ordre. */
  contexte(tenantId: string, conversationId: string): Promise<LigneMessage[]>;
  /** Ouvre l'entrée ; faux si une entrée ouverte existait déjà (une autre copie du balayage). */
  ouvrirEntree(tenantId: string, conversationId: string): Promise<boolean>;
}

/** Les colonnes d'un message à publier, avec sa conversation, sa fiche et l'auteur d'une réponse humaine. */
const COLONNES_MESSAGE = `m.id, m.conversation_id, m.direction, m.type, m.body, m.button_payload, m.origin,
              to_char(m.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at, c.wa_id,
              ct.profile_name as nom, coalesce(nullif(u.name, ''), split_part(u.email, '@', 1)) as membre
         from conversation_messages m
         join conversations c on c.id = m.conversation_id
         left join contacts ct on ct.id = c.contact_id and ct.tenant_id = c.tenant_id
         left join users u on u.id = m.sender_user_id and u.tenant_id = c.tenant_id`;

interface RangeeMessage {
  id: string; conversation_id: string; direction: 'in' | 'out'; type: string | null; body: string | null;
  button_payload: string | null; origin: OrigineMessage | null; created_at: string; wa_id: string; nom: string | null; membre: string | null;
}
const versLigne = (x: RangeeMessage): LigneMessage => ({
  id: x.id, conversationId: x.conversation_id, direction: x.direction, type: x.type, body: x.body, buttonPayload: x.button_payload,
  origin: x.origin, createdAt: x.created_at, waId: x.wa_id, nom: x.nom, membre: x.membre,
});

export class PgInboxHubspotStore implements InboxHubspotStore {
  constructor(private readonly pool: Pool) {}

  async espacesBranches(): Promise<EspaceBranche[]> {
    const r = await this.pool.query<{ tenant_id: string; hubspot_inbox_boite: string; hubspot_inbox_curseur_le: string; hubspot_inbox_curseur_id: string }>(
      `select tenant_id, hubspot_inbox_boite, to_char(hubspot_inbox_curseur_le at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as hubspot_inbox_curseur_le, hubspot_inbox_curseur_id
         from tenant_settings
        where hubspot_inbox_boite is not null and hubspot_inbox_curseur_le is not null`,
    );
    return r.rows.map((x) => ({ tenantId: x.tenant_id, boite: x.hubspot_inbox_boite, curseurLe: x.hubspot_inbox_curseur_le, curseurId: x.hubspot_inbox_curseur_id ?? UUID_ZERO }));
  }

  async lireBoite(tenantId: string): Promise<string | null> {
    const r = await this.pool.query<{ b: string | null }>(`select hubspot_inbox_boite as b from tenant_settings where tenant_id = $1`, [tenantId]);
    return r.rows[0]?.b ?? null;
  }

  async brancher(tenantId: string, boite: string): Promise<void> {
    await this.pool.query(
      `insert into tenant_settings (tenant_id, hubspot_inbox_boite, hubspot_inbox_curseur_le, hubspot_inbox_curseur_id, hubspot_inbox_branche_le)
       values ($1, $2, now(), $3::uuid, now())
       on conflict (tenant_id) do update set hubspot_inbox_boite = excluded.hubspot_inbox_boite,
         hubspot_inbox_curseur_le = excluded.hubspot_inbox_curseur_le, hubspot_inbox_curseur_id = excluded.hubspot_inbox_curseur_id,
         hubspot_inbox_branche_le = excluded.hubspot_inbox_branche_le`,
      [tenantId, boite, UUID_ZERO],
    );
    // Une autre boîte, ou la même rebranchée : on repart de zéro, comme après un débranchement (relecture du lot 1 bis).
    await this.pool.query(`update inbox_hubspot_entrees set sortie_le = now() where tenant_id = $1 and sortie_le is null`, [tenantId]);
  }

  async debrancher(tenantId: string): Promise<void> {
    await this.pool.query(
      `update tenant_settings set hubspot_inbox_boite = null, hubspot_inbox_curseur_le = null, hubspot_inbox_curseur_id = null,
         hubspot_inbox_branche_le = null
        where tenant_id = $1`,
      [tenantId],
    );
    // Débranché, rien n'est plus dans l'Inbox : un rebranchement repart de zéro (les conversations rentreront avec leur
    // contexte), jamais d'une entrée restée ouverte qui publierait sans contexte.
    await this.pool.query(`update inbox_hubspot_entrees set sortie_le = now() where tenant_id = $1 and sortie_le is null`, [tenantId]);
  }

  async ligne(tenantId: string): Promise<LigneEspace | null> {
    const r = await this.pool.query<{ display_phone_number: string; hubspot_connected: boolean; hubspot_paused_at: Date | null }>(
      `select display_phone_number, hubspot_connected, hubspot_paused_at from phone_numbers
        where tenant_id = $1 order by created_at asc limit 1`,
      [tenantId],
    );
    const x = r.rows[0];
    return x ? { affichage: x.display_phone_number, connectee: x.hubspot_connected, enPause: x.hubspot_paused_at !== null } : null;
  }

  async borne(): Promise<string> {
    const r = await this.pool.query<{ borne: string }>(`select to_char((now() - make_interval(secs => $1)) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as borne`, [RETARD_S]);
    return r.rows[0]!.borne;
  }

  async messagesApres(e: EspaceBranche, borne: string, limite: number): Promise<LigneMessage[]> {
    const r = await this.pool.query<RangeeMessage>(
      `select ${COLONNES_MESSAGE}
        where c.tenant_id = $1
          and m.channel = 'whatsapp'
          and c.is_test is not true
          -- Une conversation entrée, y compris SORTIE après ce message : la réponse du conseiller qui précède « Traité »
          -- de quelques secondes (le curseur a 30 s de retard) part quand même (relecture du lot 1 bis).
          and exists (select 1 from inbox_hubspot_entrees e
                       where e.conversation_id = m.conversation_id and e.tenant_id = $1
                         and (e.sortie_le is null or m.created_at <= e.sortie_le))
          and (m.created_at, m.id) > ($2::timestamptz, $3::uuid)
          and m.created_at <= $4::timestamptz
        order by m.created_at, m.id
        limit $5`,
      [e.tenantId, e.curseurLe, e.curseurId, borne, limite],
    );
    return r.rows.map(versLigne);
  }

  async avancer(tenantId: string, le: string, id: string): Promise<void> {
    await this.pool.query(
      `update tenant_settings set hubspot_inbox_curseur_le = $2::timestamptz, hubspot_inbox_curseur_id = $3::uuid
        where tenant_id = $1 and hubspot_inbox_boite is not null
          and (hubspot_inbox_curseur_le, hubspot_inbox_curseur_id) < ($2::timestamptz, $3::uuid)`,
      [tenantId, le, id],
    );
  }

  async fermerSorties(tenantId: string): Promise<number> {
    // La sortie : l'équipe ne tient plus le fil (un robot l'a repris), « Traité », archivée, ou le contact a dit STOP ou a
    // été bloqué (décision de Julien, 2026-11-09 : le conseiller n'a plus rien à y faire, comme dans la page). PAS le
    // prédicat d'entrée inversé : une conversation à laquelle le conseiller vient de répondre n'est plus « à traiter »
    // mais reste à lui, elle reste.
    const r = await this.pool.query(
      `update inbox_hubspot_entrees e set sortie_le = now()
         from conversations c
         left join contacts ct on ct.id = c.contact_id
        where e.tenant_id = $1 and e.sortie_le is null and c.id = e.conversation_id and c.tenant_id = $1
          and (c.control_owner <> 'app_human' or c.traitee_le is not null or c.archived_at is not null
               or not (${CONTACT_JOIGNABLE_SQL}))`,
      [tenantId],
    );
    return r.rowCount ?? 0;
  }

  async aFaireEntrer(tenantId: string, limite: number): Promise<string[]> {
    const r = await this.pool.query<{ id: string }>(
      `select c.id
         from conversations c
         left join contacts ct on ct.id = c.contact_id
         join tenant_settings s on s.tenant_id = c.tenant_id
        where c.tenant_id = $1
          and c.is_test is not true
          and ${ATTEND_UN_HUMAIN_SQL}
          and greatest(c.last_message_at, c.escaladee_le) >= coalesce(s.hubspot_inbox_branche_le, '-infinity'::timestamptz)
          and not exists (select 1 from inbox_hubspot_entrees e where e.conversation_id = c.id and e.sortie_le is null)
        order by c.last_message_at asc
        limit $2`,
      [tenantId, limite],
    );
    return r.rows.map((x) => x.id);
  }

  async contexte(tenantId: string, conversationId: string): Promise<LigneMessage[]> {
    const r = await this.pool.query<RangeeMessage>(
      `select * from (
         select ${COLONNES_MESSAGE}
          where c.tenant_id = $1 and m.conversation_id = $2 and m.channel = 'whatsapp'
            and m.created_at >= now() - make_interval(hours => $3)
          order by m.created_at desc, m.id desc
          limit $4
       ) d order by d.created_at, d.id`,
      [tenantId, conversationId, CONTEXTE_HEURES, CONTEXTE_MAX],
    );
    return r.rows.map(versLigne);
  }

  async ouvrirEntree(tenantId: string, conversationId: string): Promise<boolean> {
    const r = await this.pool.query(
      `insert into inbox_hubspot_entrees (tenant_id, conversation_id)
       select $1, c.id from conversations c where c.id = $2 and c.tenant_id = $1
       on conflict (conversation_id) where sortie_le is null do nothing`,
      [tenantId, conversationId],
    );
    return (r.rowCount ?? 0) > 0;
  }
}

/** Qui parle, pour un message sortant : un membre par son nom, un automate par sa nature. */
export function expediteur(origin: OrigineMessage | null, membre: string | null): string {
  switch (origin) {
    case 'humain': return membre ?? 'Équipe';
    case 'ia': return 'Agent IA';
    case 'mba': return 'Meta Business Agent';
    case 'scenario': return 'Scénario';
    case 'campagne': return 'Campagne';
    case 'mcp': return membre ?? 'Assistant';
    case 'api': return 'API';
    default: return membre ?? 'Messaging Me';
  }
}

/**
 * Le message tel que le connecteur l'attend, ou null s'il ne peut pas être publié : un contact connu par son seul
 * identifiant d'entreprise (BSUID) n'a pas de numéro, et le canal identifie chaque participant par son numéro.
 */
export function versConnecteur(m: LigneMessage): MessageInboxHubspot | null {
  const e164 = classifyWaId(m.waId).phoneE164;
  if (!e164) return null;
  const texte = (m.body?.trim() || m.buttonPayload?.trim() || `[${m.type ?? 'message'}]`).slice(0, 20_000);
  return {
    id: m.id,
    conversationId: m.conversationId,
    sens: m.direction,
    texte,
    le: new Date(m.createdAt).toISOString(),
    contactE164: e164,
    // Le connecteur refuse un nom de plus de 200 caractères, et son refus ferait sauter tout le lot.
    contactNom: m.nom?.trim().slice(0, 200) || null,
    expediteur: m.direction === 'out' ? expediteur(m.origin, m.membre).slice(0, 200) : null,
  };
}

/** La ligne de l'espace en E.164, ou null (pas de numéro, ou un affichage illisible). */
export function ligneE164(l: LigneEspace | null): string | null {
  return l ? e164DepuisSaisie(l.affichage) : null;
}

export interface BalayageInboxDeps {
  store: InboxHubspotStore;
  /** `pousserMessagesInbox` : rend une issue, LÈVE sur 429, 5xx et réseau. */
  pousser(corps: { tenantId: string; ligne: string; messages: MessageInboxHubspot[] }): Promise<IssueInbox>;
}

/**
 * Ce qu'un tour fait d'une issue du connecteur. `suite` : on continue avec cet espace. `sauter` : un refus du CONTRAT
 * (400, 413, 422), rejouer donnerait le même refus, le lot est abandonné et le tour continue. `arret` : on s'arrête là pour
 * cet espace (débranché par le connecteur, portées manquantes, ou un état qui se répare : 401, 403, 404 sans code).
 */
type Reaction = 'suite' | 'sauter' | 'arret';

async function reagir(deps: BalayageInboxDeps, tenantId: string, issue: IssueInbox): Promise<Reaction> {
  if (issue.issue === 'fait') {
    if (issue.refuses > 0) journaliser('warn', 'hubspot_inbox_messages_refuses', { tenantId, refuses: issue.refuses });
    return 'suite';
  }
  if (issue.issue === 'non_branche' || issue.issue === 'non_relie') {
    // Le connecteur n'a plus de compte de canal pour cette ligne (portail désinstallé, délié) : l'espace est débranché ici
    // aussi, la console le montre, et le balayage cesse de pousser dans le vide.
    journaliser('warn', 'hubspot_inbox_debranche_par_le_connecteur', { tenantId, issue: issue.issue });
    await deps.store.debrancher(tenantId);
    return 'arret';
  }
  if (issue.issue === 'portees') {
    journaliser('warn', 'hubspot_inbox_portees_manquantes', { tenantId });
    return 'arret';
  }
  if (issue.status === 400 || issue.status === 413 || issue.status === 422) {
    journaliser('error', 'hubspot_inbox_lot_refuse', { tenantId, status: issue.status, code: issue.code });
    return 'sauter';
  }
  // 401 (secret ou horloge), 403, 404 sans code (routes pas montées), `portal_disconnected` : un état qui se répare. Rien
  // n'avance, le tour suivant rejoue : sauter effacerait en silence ce qui a été écrit pendant.
  journaliser('error', 'hubspot_inbox_lot_en_attente', { tenantId, status: issue.status, code: issue.code });
  return 'arret';
}

/**
 * Un tour du balayage `hubspot-inbox`. Pour chaque espace branché, dans cet ordre :
 *  1. les SORTIES : les conversations que l'équipe ne tient plus (robot, « Traité », archivée) quittent l'Inbox ;
 *  2. les ENTRÉES : les conversations qui attendent un humain (`aFaireEntrer`, `ENTREES_PAR_TOUR` au plus) publient leur
 *     contexte, PUIS leur entrée s'inscrit. Dans cet ordre : une panne fait rejouer l'entrée entière au tour suivant, jamais
 *     une conversation « entrée » sans contexte ; le contexte rejoué, HubSpot le déduplique par l'identifiant du message ;
 *  3. la SUITE : les messages des conversations entrées, après le curseur, un lot au plus.
 * Rend le nombre de messages publiés. Un échec sur un espace est journalisé et n'arrête pas le tour ; son curseur ne
 * bouge pas, le tour suivant rejoue.
 *
 * Le curseur AVANCE sans rien pousser dans trois cas, délibérément sans rattrapage (comme la poussée d'analyse) : la
 * ligne n'est pas reliée à HubSpot ou est en pause, le portail n'a pas les portées de l'Inbox, ou rien n'est arrivé.
 * Le dernier évite qu'un espace silencieux relise demain tout ce que les autres ont écrit depuis.
 */
export async function balayerInbox(deps: BalayageInboxDeps): Promise<number> {
  let publies = 0;
  for (const e of await deps.store.espacesBranches()) {
    try {
      const borne = await deps.store.borne();
      const l = await deps.store.ligne(e.tenantId);
      const ligne = ligneE164(l);
      if (!l || !ligne || !l.connectee || l.enPause) {
        await deps.store.avancer(e.tenantId, borne, UUID_ZERO);
        continue;
      }

      await deps.store.fermerSorties(e.tenantId);

      let arret = false;
      for (const conversationId of await deps.store.aFaireEntrer(e.tenantId, ENTREES_PAR_TOUR)) {
        const contexte = (await deps.store.contexte(e.tenantId, conversationId))
          .map(versConnecteur).filter((m): m is MessageInboxHubspot => m !== null);
        if (contexte.length > 0) {
          const issue = await deps.pousser({ tenantId: e.tenantId, ligne, messages: contexte });
          const reaction = await reagir(deps, e.tenantId, issue);
          if (reaction === 'arret') {
            if (issue.issue === 'portees') await deps.store.avancer(e.tenantId, borne, UUID_ZERO);
            arret = true;
            break;
          }
          if (issue.issue === 'fait') publies += issue.publies;
        }
        // Un refus du CONTRAT sur le contexte (`sauter`) inscrit l'entrée quand même : rejouer rendrait le même refus, et la
        // suite de la conversation doit partir. Ce contexte-là est perdu pour HubSpot, le journal le dit.
        await deps.store.ouvrirEntree(e.tenantId, conversationId);
      }
      if (arret) continue;

      const lignes = await deps.store.messagesApres(e, borne, LOT_INBOX);
      if (lignes.length === 0) {
        await deps.store.avancer(e.tenantId, borne, UUID_ZERO);
        continue;
      }
      const dernier = lignes[lignes.length - 1]!;
      const messages = lignes.map(versConnecteur).filter((m): m is MessageInboxHubspot => m !== null);
      if (messages.length === 0) {
        await deps.store.avancer(e.tenantId, dernier.createdAt, dernier.id);
        continue;
      }
      const issue = await deps.pousser({ tenantId: e.tenantId, ligne, messages });
      const reaction = await reagir(deps, e.tenantId, issue);
      if (issue.issue === 'fait') publies += issue.publies;
      if (reaction === 'suite' || reaction === 'sauter') await deps.store.avancer(e.tenantId, dernier.createdAt, dernier.id);
      else if (issue.issue === 'portees') await deps.store.avancer(e.tenantId, borne, UUID_ZERO);
    } catch (err) {
      journaliser('error', 'hubspot_inbox_balayage_impossible', { err, tenantId: e.tenantId });
    }
  }
  return publies;
}
