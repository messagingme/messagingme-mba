import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { PgWorkflowRunStore } from '../src/workflow/run-store.pg';

/**
 * Les deux RÉCLAMATIONS du balayage de réveil (`claimDueSleeping`, `claimDueQuestions`) et les deux lectures
 * d'un run (`findWaitingByWaId`, `byId`) passent par une seule écriture (audit ponytail du 2026-09-25). Ce
 * test fige, sans base, la requête EXACTE que chacune envoie et la ligne qu'elle rend : le statut LITTÉRAL
 * (un paramètre à sa place priverait le planificateur des index partiels sur `status`), le bail de 15 minutes,
 * la borne de 90 jours, `skip locked`, et le statut rendu. Les tests d'intégration (stores, question-timeout)
 * restent ceux qui voient une base.
 */
function fauxPool(lignes: unknown[]) {
  const appels: Array<{ sql: string; params: unknown[] }> = [];
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      appels.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      return { rows: lignes, rowCount: lignes.length };
    },
  } as unknown as Pool;
  return { pool, appels };
}

const reclamation = (statut: string) =>
  `update workflow_runs r set resume_at = now() + interval '15 minutes', updated_at = now() from ( select id from workflow_runs where status = '${statut}' and resume_at is not null and resume_at <= now() and created_at > now() - interval '90 days' order by resume_at for update skip locked limit $1 ) due where r.id = due.id returning r.id, r.workflow_id, r.tenant_id, r.wa_id, r.contact_id, r.current_node, r.last_message_id, r.channel, r.graphe_fige, r.accord_marketing_exige`;

const ligne = {
  id: 'r1', workflow_id: 'w1', tenant_id: 't1', wa_id: '336', contact_id: 'c1', current_node: 'n2',
  last_message_id: 'wamid.1', channel: null, graphe_fige: null, accord_marketing_exige: false,
};

describe('PgWorkflowRunStore : les réclamations du balayage de réveil', () => {
  it.each([
    ['claimDueSleeping', 'sleeping'],
    ['claimDueQuestions', 'waiting'],
  ] as const)('%s réclame les runs `%s` dus, sous bail, et les rend avec ce statut', async (methode, statut) => {
    const { pool, appels } = fauxPool([ligne]);
    const rendus = await new PgWorkflowRunStore(pool)[methode](50);
    expect(appels).toEqual([{ sql: reclamation(statut), params: [50] }]);
    expect(rendus).toEqual([{
      id: 'r1', workflowId: 'w1', tenantId: 't1', waId: '336', contactId: 'c1', currentNode: 'n2',
      status: statut, lastMessageId: 'wamid.1', channel: 'whatsapp', grapheFige: null, exigeAccordMarketing: false,
    }]);
  });
});

describe('PgWorkflowRunStore : la réclamation d’UN parcours par le réveil court', () => {
  const parId = `update workflow_runs r set resume_at = now() + interval '15 minutes', updated_at = now() from ( select id from workflow_runs where tenant_id = $1 and id = $2 and status = 'sleeping' and resume_at is not null and resume_at <= now() + interval '2 seconds' and created_at > now() - interval '90 days' for update skip locked ) due where r.id = due.id returning r.id, r.workflow_id, r.tenant_id, r.wa_id, r.contact_id, r.current_node, r.last_message_id, r.channel, r.graphe_fige, r.accord_marketing_exige`;

  it('même bail que le balayage, sur CE parcours, avec 2 s de tolérance d’horloge', async () => {
    const { pool, appels } = fauxPool([ligne]);
    const rendu = await new PgWorkflowRunStore(pool).claimSleepingById('t1', 'r1');
    expect(appels).toEqual([{ sql: parId, params: ['t1', 'r1'] }]);
    expect(rendu).toEqual({
      id: 'r1', workflowId: 'w1', tenantId: 't1', waId: '336', contactId: 'c1', currentNode: 'n2',
      status: 'sleeping', lastMessageId: 'wamid.1', channel: 'whatsapp', grapheFige: null, exigeAccordMarketing: false,
    });
  });

  it('`null` quand la ligne n’est pas prise (déjà réclamée, close, pas encore due)', async () => {
    expect(await new PgWorkflowRunStore(fauxPool([]).pool).claimSleepingById('t1', 'r1')).toBeNull();
  });
});

describe('PgWorkflowRunStore : la lecture d’un run', () => {
  const lu = { ...ligne, status: 'waiting', channel: 'rcs' };
  // `contactId` : la fiche du parcours, qu'un « Aller à » vers un autre scénario transmet au parcours qu'il démarre (RC5).
  const attendu = {
    id: 'r1', workflowId: 'w1', tenantId: 't1', waId: '336', contactId: 'c1', currentNode: 'n2', status: 'waiting',
    lastMessageId: 'wamid.1', channel: 'rcs', grapheFige: null, exigeAccordMarketing: false,
  };

  it('findWaitingByWaId : le plus récent en attente de CE contact', async () => {
    const { pool, appels } = fauxPool([lu]);
    expect(await new PgWorkflowRunStore(pool).findWaitingByWaId('t1', '336')).toEqual(attendu);
    expect(appels[0]!.params).toEqual(['t1', '336']);
    expect(appels[0]!.sql).toBe("select id, workflow_id, tenant_id, wa_id, contact_id, current_node, status, last_message_id, channel, graphe_fige, accord_marketing_exige from workflow_runs where tenant_id = $1 and wa_id = $2 and status = 'waiting' order by created_at desc limit 1");
  });

  it('byId : quel que soit son statut, et `null` quand il n’existe pas', async () => {
    const { pool, appels } = fauxPool([lu]);
    expect(await new PgWorkflowRunStore(pool).byId('t1', 'r1')).toEqual(attendu);
    expect(appels[0]!.sql).toBe('select id, workflow_id, tenant_id, wa_id, contact_id, current_node, status, last_message_id, channel, graphe_fige, accord_marketing_exige from workflow_runs where tenant_id = $1 and id = $2');
    expect(await new PgWorkflowRunStore(fauxPool([]).pool).byId('t1', 'r1')).toBeNull();
  });
});

/**
 * 🔴 LA GARDE MARKETING DU PARCOURS (migration 0272) se lit « !== false » : une lecture dont le SQL oublierait la colonne
 * rend une ligne SANS elle, et le parcours doit alors REFUSER un Marketing sans accord (une panne qui se voit), jamais le
 * laisser partir. Seul un `false` venu de la base libère. Les quatre lectures passent par la même conversion.
 */
describe('PgWorkflowRunStore : la garde marketing se lit fail-closed', () => {
  const { accord_marketing_exige: _colonne, ...sansLaColonne } = ligne;
  const lectures = [
    ['findWaitingByWaId', (s: PgWorkflowRunStore) => s.findWaitingByWaId('t1', '336')],
    ['byId', (s: PgWorkflowRunStore) => s.byId('t1', 'r1')],
    ['claimDueSleeping', async (s: PgWorkflowRunStore) => (await s.claimDueSleeping(50))[0] ?? null],
    ['claimSleepingById', (s: PgWorkflowRunStore) => s.claimSleepingById('t1', 'r1')],
  ] as const;
  for (const [nom, lire] of lectures) {
    it(`${nom} : colonne absente de la ligne -> exigée ; true -> exigée ; false -> libre`, async () => {
      const exige = async (l: Record<string, unknown>) => (await lire(new PgWorkflowRunStore(fauxPool([{ ...l, status: 'waiting' }]).pool)))?.exigeAccordMarketing;
      expect(await exige(sansLaColonne)).toBe(true);
      expect(await exige({ ...ligne, accord_marketing_exige: true })).toBe(true);
      expect(await exige({ ...ligne, accord_marketing_exige: false })).toBe(false);
    });
  }
});
