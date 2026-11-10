import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgInboxHubspotStore, ENTREES_PAR_TOUR } from '../../src/hubspot/inbox';
import { PgATraiterHubspot } from '../../src/inbox/a-traiter-hubspot.pg';

const url = process.env.DATABASE_URL ?? '';

/**
 * LOT 1 BIS DE L'INBOX HUBSPOT, EN BASE : seules les conversations qui attendent un humain entrent dans l'Inbox
 * (plan `~/mm-hubspot/docs/2026-11-09-inbox-hubspot-lot1bis-humain-plan.md`). Ce qu'un faux store ne peut qu'affirmer :
 *  - 🔴 une conversation que l'agent IA tient n'entre pas, une conversation escaladée vers l'équipe entre ;
 *  - 🔴 le prédicat est celui de la page « Messaging Me » : la même liste, conversation par conversation ;
 *  - rien de ce qui précède le branchement n'entre ; un contact STOP n'entre pas ; un autre espace jamais ;
 *  - la suite du balayage ne lit que les conversations entrées ; une sortie (« Traité ») ferme l'entrée ;
 *  - le contexte : les 24 dernières heures, dans l'ordre ; une seconde entrée ouverte est impossible.
 *
 * Jamais joué en local contre la production (le `DATABASE_URL` local pointe une ancienne production), joué par le job
 * `integration` sur un Postgres jetable.
 */
describe.skipIf(!url)('Inbox HubSpot : seules les conversations qui attendent un humain entrent (Postgres)', () => {
  let pool: Pool;
  let store: PgInboxHubspotStore;
  let t1 = '';
  let t2 = '';
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 4 });
    store = new PgInboxHubspotStore(pool);
    t1 = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-inbox-entrees') returning id`)).rows[0]!.id;
    t2 = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-inbox-entrees-autre') returning id`)).rows[0]!.id;
    await store.brancher(t1, '77');
    await store.brancher(t2, '78');
    // Le branchement il y a une heure : ce qui est actif depuis entre, ce qui est plus ancien non.
    await pool.query(`update tenant_settings set hubspot_inbox_branche_le = now() - interval '1 hour' where tenant_id in ($1, $2)`, [t1, t2]);

    const contact = async (t: string, tel: string, stop = false) => (await pool.query<{ id: string }>(
      `insert into contacts (tenant_id, phone_e164, profile_name, opt_in_status) values ($1, $2, 'Claire', $3) returning id`,
      [t, tel, stop ? 'opted_out' : 'unknown'],
    )).rows[0]!.id;
    const fil = async (nom: string, t: string, wa: string, o: { owner?: string; sens?: string; escalade?: boolean; ilYa?: string; stop?: boolean } = {}) => {
      const c = await contact(t, `+${wa}`, o.stop);
      ids[nom] = (await pool.query<{ id: string }>(
        `insert into conversations (tenant_id, wa_id, contact_id, last_message_at, last_direction, control_owner, escaladee_le)
         values ($1, $2, $3, now() - $4::interval, $5, $6, case when $7::boolean then now() - $4::interval end) returning id`,
        [t, wa, c, o.ilYa ?? '10 minutes', o.sens ?? 'in', o.owner ?? 'app_human', o.escalade ?? false],
      )).rows[0]!.id;
      return ids[nom]!;
    };
    const msg = (conv: string, sens: 'in' | 'out', ilYa: string, corps = 'x') => pool.query(
      `insert into conversation_messages (conversation_id, direction, type, body, created_at, channel)
       values ($1, $2, 'text', $3, now() - $4::interval, 'whatsapp')`,
      [conv, sens, corps, ilYa],
    );

    // Escaladée vers l'équipe : son contexte, dont un message d'hier soir hors des 24 h.
    const escaladee = await fil('escaladee', t1, '33600009201', { escalade: true });
    await msg(escaladee, 'in', '30 hours', 'trop ancien');
    await msg(escaladee, 'in', '20 minutes', 'bonjour');
    await msg(escaladee, 'out', '19 minutes', 'réponse de l’agent IA');
    await msg(escaladee, 'in', '10 minutes', 'je veux un conseiller');
    // Tenue par l'agent IA : n'entre pas, même si le client vient d'écrire.
    const robot = await fil('robot', t1, '33600009202', { owner: 'app_workflow' });
    await msg(robot, 'in', '5 minutes');
    // Attend l'équipe, mais depuis AVANT le branchement : aucun rattrapage.
    await fil('avant', t1, '33600009203', { ilYa: '3 hours' });
    // Le contact a dit STOP.
    await fil('stop', t1, '33600009204', { stop: true });
    // Un autre espace.
    await fil('ailleurs', t2, '33600009205', { escalade: true });
  });

  afterAll(async () => {
    for (const t of [t1, t2]) if (t) await pool.query('delete from tenants where id = $1', [t]).catch(() => {});
    await pool.end().catch(() => {});
  });

  it('🔴 n’entrent que les conversations qui attendent un humain, actives depuis le branchement, de CET espace', async () => {
    expect(await store.aFaireEntrer(t1, ENTREES_PAR_TOUR)).toEqual([ids['escaladee']]);
  });

  it('🔴 le prédicat est celui de la page « Messaging Me » : parmi ce qui suit le branchement, la même liste', async () => {
    const page = await new PgATraiterHubspot(pool).lister(t1, 200);
    // `avant` est dans la page (elle n'a pas de branchement) et pas dans l'Inbox (aucun rattrapage) : c'est la seule
    // différence permise.
    expect(page.lignes.map((l) => l.conversationId).filter((id) => id !== ids['avant']).sort())
      .toEqual(await store.aFaireEntrer(t1, ENTREES_PAR_TOUR));
  });

  it('le contexte : les messages des 24 dernières heures, dans l’ordre', async () => {
    const ctx = await store.contexte(t1, ids['escaladee']!);
    expect(ctx.map((m) => m.body)).toEqual(['bonjour', 'réponse de l’agent IA', 'je veux un conseiller']);
    expect(await store.contexte(t2, ids['escaladee']!)).toEqual([]);
  });

  it('🔴 une seule entrée ouverte par conversation, et jamais pour la conversation d’un autre espace', async () => {
    expect(await store.ouvrirEntree(t1, ids['escaladee']!)).toBe(true);
    expect(await store.ouvrirEntree(t1, ids['escaladee']!)).toBe(false);
    expect(await store.ouvrirEntree(t2, ids['escaladee']!)).toBe(false);
    expect(await store.aFaireEntrer(t1, ENTREES_PAR_TOUR)).toEqual([]);
  });

  it('🔴 la suite du balayage ne lit QUE les conversations entrées', async () => {
    const [e] = (await store.espacesBranches()).filter((x) => x.tenantId === t1);
    await pool.query(`update tenant_settings set hubspot_inbox_curseur_le = now() - interval '1 hour' where tenant_id = $1`, [t1]);
    const [espace] = (await store.espacesBranches()).filter((x) => x.tenantId === t1);
    expect(e).toBeDefined();
    const lus = await store.messagesApres(espace!, await store.borne(), 50);
    expect(new Set(lus.map((m) => m.conversationId))).toEqual(new Set([ids['escaladee']]));
  });

  it('🔴 « Traité » fait sortir : la réponse du conseiller qui le PRÉCÈDE part encore, un message d’après non', async () => {
    // Le conseiller a répondu : plus « à traiter », mais l'équipe tient le fil, l'entrée reste ouverte.
    await pool.query(
      `insert into conversation_messages (conversation_id, direction, type, body, created_at, channel)
       values ($1, 'out', 'text', 'réponse du conseiller', now() - interval '2 minutes', 'whatsapp')`, [ids['escaladee']],
    );
    await pool.query(`update conversations set last_direction = 'out' where id = $1`, [ids['escaladee']]);
    expect(await store.fermerSorties(t1)).toBe(0);
    await pool.query(`update conversations set traitee_le = now() where id = $1`, [ids['escaladee']]);
    expect(await store.fermerSorties(t1)).toBe(1);
    // Après la sortie, la conversation écrit encore (un robot l'a reprise) : rien de cela ne doit partir.
    await pool.query(
      `insert into conversation_messages (conversation_id, direction, type, body, created_at, channel)
       values ($1, 'in', 'text', 'après la sortie', now() + interval '1 second', 'whatsapp')`, [ids['escaladee']],
    );
    await pool.query(`update tenant_settings set hubspot_inbox_curseur_le = now() - interval '1 hour' where tenant_id = $1`, [t1]);
    const [espace] = (await store.espacesBranches()).filter((x) => x.tenantId === t1);
    const lus = (await store.messagesApres(espace!, '2100-01-01T00:00:00.000000Z', 50)).map((m) => m.body);
    expect(lus).toContain('réponse du conseiller');
    expect(lus).not.toContain('après la sortie');
  });

  it('🔴 un contact qui dit STOP pendant que sa conversation est dans l’Inbox l’en fait sortir', async () => {
    await pool.query(`update conversations set traitee_le = null, last_direction = 'in' where id = $1`, [ids['escaladee']]);
    expect(await store.ouvrirEntree(t1, ids['escaladee']!)).toBe(true);
    expect(await store.fermerSorties(t1)).toBe(0);
    await pool.query(`update contacts set opt_in_status = 'opted_out' where id = (select contact_id from conversations where id = $1)`, [ids['escaladee']]);
    expect(await store.fermerSorties(t1)).toBe(1);
    await pool.query(`update contacts set opt_in_status = 'unknown' where id = (select contact_id from conversations where id = $1)`, [ids['escaladee']]);
  });

  it('🔴 lot 2 : une réponse tapée dans l’Inbox, MARQUÉE, n’est relue ni par la suite ni par le contexte ; un autre espace ne la marque pas', async () => {
    await pool.query(`update conversations set traitee_le = null, last_direction = 'in' where id = $1`, [ids['escaladee']]);
    await store.ouvrirEntree(t1, ids['escaladee']!);
    await pool.query(
      `insert into conversation_messages (conversation_id, direction, type, body, created_at, channel, meta_message_id)
       values ($1, 'out', 'text', 'réponse depuis l’Inbox', now() - interval '1 minute', 'whatsapp', 'wamid.itest-inbox-1')`, [ids['escaladee']],
    );
    expect(await store.marquerReponseInbox(t2, 'wamid.itest-inbox-1', '111')).toBe(false);
    expect(await store.marquerReponseInbox(t1, 'wamid.itest-inbox-1', '987654321')).toBe(true);
    await pool.query(`update tenant_settings set hubspot_inbox_curseur_le = now() - interval '1 hour' where tenant_id = $1`, [t1]);
    const [espace] = (await store.espacesBranches()).filter((x) => x.tenantId === t1);
    expect((await store.messagesApres(espace!, '2100-01-01T00:00:00.000000Z', 50)).map((m) => m.body)).not.toContain('réponse depuis l’Inbox');
    expect((await store.contexte(t1, ids['escaladee']!)).map((m) => m.body)).not.toContain('réponse depuis l’Inbox');
    // Rendre l'état aux tests suivants : l'entrée fermée, le message retiré.
    await pool.query(`update inbox_hubspot_entrees set sortie_le = now() where tenant_id = $1 and sortie_le is null`, [t1]);
    await pool.query(`delete from conversation_messages where meta_message_id = 'wamid.itest-inbox-1'`);
  });

  it('rebrancher (une autre boîte) ferme les entrées ouvertes', async () => {
    await pool.query(`update conversations set traitee_le = null, last_direction = 'in' where id = $1`, [ids['escaladee']]);
    expect(await store.ouvrirEntree(t1, ids['escaladee']!)).toBe(true);
    await store.brancher(t1, '79');
    const ouvertes = await pool.query(`select count(*)::int as n from inbox_hubspot_entrees where tenant_id = $1 and sortie_le is null`, [t1]);
    expect(ouvertes.rows[0]!.n).toBe(0);
  });

  it('débrancher ferme les entrées : un rebranchement repart de zéro', async () => {
    expect(await store.ouvrirEntree(t1, ids['escaladee']!)).toBe(true);
    await store.debrancher(t1);
    const ouvertes = await pool.query(`select count(*)::int as n from inbox_hubspot_entrees where tenant_id = $1 and sortie_le is null`, [t1]);
    expect(ouvertes.rows[0]!.n).toBe(0);
  });
});
