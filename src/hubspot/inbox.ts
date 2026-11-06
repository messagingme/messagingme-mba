import type { Pool } from 'pg';
import { classifyWaId } from '../crm/identity';
import { e164DepuisSaisie } from '../crm/phone';
import { journaliser } from '../lib/journal';
import type { OrigineMessage } from '../inbox/origine';
import type { IssueInbox, MessageInboxHubspot } from '../crm/hubspot-service';

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
 * La ligne WhatsApp est le premier numéro de l'espace, la règle de la poussée d'analyse et du passage à l'équipe
 * (`getEnrichment`, `getEtatPassage`) : une conversation ne porte pas son numéro.
 */

export const RETARD_S = 30;
export const LOT_INBOX = 50;
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
}

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
      `insert into tenant_settings (tenant_id, hubspot_inbox_boite, hubspot_inbox_curseur_le, hubspot_inbox_curseur_id)
       values ($1, $2, now(), $3::uuid)
       on conflict (tenant_id) do update set hubspot_inbox_boite = excluded.hubspot_inbox_boite,
         hubspot_inbox_curseur_le = excluded.hubspot_inbox_curseur_le, hubspot_inbox_curseur_id = excluded.hubspot_inbox_curseur_id`,
      [tenantId, boite, UUID_ZERO],
    );
  }

  async debrancher(tenantId: string): Promise<void> {
    await this.pool.query(
      `update tenant_settings set hubspot_inbox_boite = null, hubspot_inbox_curseur_le = null, hubspot_inbox_curseur_id = null
        where tenant_id = $1`,
      [tenantId],
    );
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
    const r = await this.pool.query<{
      id: string; conversation_id: string; direction: 'in' | 'out'; type: string | null; body: string | null;
      button_payload: string | null; origin: OrigineMessage | null; created_at: string; wa_id: string; nom: string | null; membre: string | null;
    }>(
      `select m.id, m.conversation_id, m.direction, m.type, m.body, m.button_payload, m.origin,
              to_char(m.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at, c.wa_id,
              ct.profile_name as nom, coalesce(nullif(u.name, ''), split_part(u.email, '@', 1)) as membre
         from conversation_messages m
         join conversations c on c.id = m.conversation_id
         left join contacts ct on ct.id = c.contact_id and ct.tenant_id = c.tenant_id
         left join users u on u.id = m.sender_user_id and u.tenant_id = c.tenant_id
        where c.tenant_id = $1
          and m.channel = 'whatsapp'
          and c.is_test is not true
          and (m.created_at, m.id) > ($2::timestamptz, $3::uuid)
          and m.created_at <= $4::timestamptz
        order by m.created_at, m.id
        limit $5`,
      [e.tenantId, e.curseurLe, e.curseurId, borne, limite],
    );
    return r.rows.map((x) => ({
      id: x.id, conversationId: x.conversation_id, direction: x.direction, type: x.type, body: x.body, buttonPayload: x.button_payload,
      origin: x.origin, createdAt: x.created_at, waId: x.wa_id, nom: x.nom, membre: x.membre,
    }));
  }

  async avancer(tenantId: string, le: string, id: string): Promise<void> {
    await this.pool.query(
      `update tenant_settings set hubspot_inbox_curseur_le = $2::timestamptz, hubspot_inbox_curseur_id = $3::uuid
        where tenant_id = $1 and hubspot_inbox_boite is not null
          and (hubspot_inbox_curseur_le, hubspot_inbox_curseur_id) < ($2::timestamptz, $3::uuid)`,
      [tenantId, le, id],
    );
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
 * Un tour du balayage `hubspot-inbox` : pour chaque espace branché, un lot au plus. Rend le nombre de messages publiés.
 * Un échec sur un espace est journalisé et n'arrête pas le tour ; son curseur ne bouge pas, le tour suivant rejoue.
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
      if (issue.issue === 'fait') {
        publies += issue.publies;
        if (issue.refuses > 0) journaliser('warn', 'hubspot_inbox_messages_refuses', { tenantId: e.tenantId, refuses: issue.refuses });
        await deps.store.avancer(e.tenantId, dernier.createdAt, dernier.id);
      } else if (issue.issue === 'non_branche' || issue.issue === 'non_relie') {
        // Le connecteur n'a plus de compte de canal pour cette ligne (portail désinstallé, délié) : l'espace est
        // débranché ici aussi, la console le montre, et le balayage cesse de pousser dans le vide.
        journaliser('warn', 'hubspot_inbox_debranche_par_le_connecteur', { tenantId: e.tenantId, issue: issue.issue });
        await deps.store.debrancher(e.tenantId);
      } else if (issue.issue === 'portees') {
        journaliser('warn', 'hubspot_inbox_portees_manquantes', { tenantId: e.tenantId });
        await deps.store.avancer(e.tenantId, borne, UUID_ZERO);
      } else if (issue.status === 400 || issue.status === 413 || issue.status === 422) {
        // Un refus du CONTRAT (corps invalide) : rejouer donnerait le même refus. Le lot est sauté, en erreur.
        journaliser('error', 'hubspot_inbox_lot_refuse', { tenantId: e.tenantId, status: issue.status, code: issue.code });
        await deps.store.avancer(e.tenantId, dernier.createdAt, dernier.id);
      } else {
        // 401 (secret ou horloge), 403, 404 sans code (routes pas montées), `portal_disconnected` : un état qui se répare.
        // Le curseur ne bouge pas, le tour suivant rejoue : sauter le lot effacerait en silence ce qui a été écrit pendant.
        journaliser('error', 'hubspot_inbox_lot_en_attente', { tenantId: e.tenantId, status: issue.status, code: issue.code });
      }
    } catch (err) {
      journaliser('error', 'hubspot_inbox_balayage_impossible', { err, tenantId: e.tenantId });
    }
  }
  return publies;
}
