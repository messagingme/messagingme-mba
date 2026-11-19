import { describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { readFileSync } from 'node:fs';
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
  `update workflow_runs r set resume_at = now() + interval '15 minutes', updated_at = now() from ( select id from workflow_runs where status = '${statut}' and resume_at is not null and resume_at <= now() and created_at > now() - interval '90 days' order by resume_at for update skip locked limit $1 ) due where r.id = due.id returning r.id, r.workflow_id, r.tenant_id, r.wa_id, r.contact_id, r.current_node, r.last_message_id, r.channel, r.graphe_fige, r.accord_marketing_exige, r.ne_en_masse, r.evenement`;

const ligne = {
  id: 'r1', workflow_id: 'w1', tenant_id: 't1', wa_id: '336', contact_id: 'c1', current_node: 'n2',
  last_message_id: 'wamid.1', channel: null, graphe_fige: null, accord_marketing_exige: false, ne_en_masse: true, evenement: null,
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
      status: statut, lastMessageId: 'wamid.1', channel: 'whatsapp', grapheFige: null, exigeAccordMarketing: false, neEnMasse: true, evenement: null,
    }]);
  });
});

describe('PgWorkflowRunStore : la réclamation d’UN parcours par le réveil court', () => {
  const parId = `update workflow_runs r set resume_at = now() + interval '15 minutes', updated_at = now() from ( select id from workflow_runs where tenant_id = $1 and id = $2 and status = 'sleeping' and resume_at is not null and resume_at <= now() + interval '2 seconds' and created_at > now() - interval '90 days' for update skip locked ) due where r.id = due.id returning r.id, r.workflow_id, r.tenant_id, r.wa_id, r.contact_id, r.current_node, r.last_message_id, r.channel, r.graphe_fige, r.accord_marketing_exige, r.ne_en_masse, r.evenement`;

  it('même bail que le balayage, sur CE parcours, avec 2 s de tolérance d’horloge', async () => {
    const { pool, appels } = fauxPool([ligne]);
    const rendu = await new PgWorkflowRunStore(pool).claimSleepingById('t1', 'r1');
    expect(appels).toEqual([{ sql: parId, params: ['t1', 'r1'] }]);
    expect(rendu).toEqual({
      id: 'r1', workflowId: 'w1', tenantId: 't1', waId: '336', contactId: 'c1', currentNode: 'n2',
      status: 'sleeping', lastMessageId: 'wamid.1', channel: 'whatsapp', grapheFige: null, exigeAccordMarketing: false, neEnMasse: true, evenement: null,
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
    lastMessageId: 'wamid.1', channel: 'rcs', grapheFige: null, exigeAccordMarketing: false, neEnMasse: true, evenement: null,
  };

  it('findWaitingByWaId : le plus récent en attente de CE contact', async () => {
    const { pool, appels } = fauxPool([lu]);
    expect(await new PgWorkflowRunStore(pool).findWaitingByWaId('t1', '336')).toEqual(attendu);
    expect(appels[0]!.params).toEqual(['t1', '336']);
    expect(appels[0]!.sql).toBe("select id, workflow_id, tenant_id, wa_id, contact_id, current_node, status, last_message_id, channel, graphe_fige, accord_marketing_exige, ne_en_masse, evenement from workflow_runs where tenant_id = $1 and wa_id = $2 and status = 'waiting' order by created_at desc limit 1");
  });

  it('byId : quel que soit son statut, et `null` quand il n’existe pas', async () => {
    const { pool, appels } = fauxPool([lu]);
    expect(await new PgWorkflowRunStore(pool).byId('t1', 'r1')).toEqual(attendu);
    expect(appels[0]!.sql).toBe('select id, workflow_id, tenant_id, wa_id, contact_id, current_node, status, last_message_id, channel, graphe_fige, accord_marketing_exige, ne_en_masse, evenement from workflow_runs where tenant_id = $1 and id = $2');
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

/**
 * LE PARCOURS D'ÉVÉNEMENT (menu « Scénario », lot 4, migrations 0297 et 0298, décisions 21, 28 et 29). `evenement` est
 * REQUIS dans chaque lecture et chaque réclamation : perdu au balayage, un parcours d'événement se réveillerait ordinaire,
 * remplaçable et sans ses variables. Le jsonb est une entrée non fiable : relu par `safeParse`, et un refus se journalise
 * SANS la valeur (des liens à clé d'accès).
 */
describe('PgWorkflowRunStore : l’événement d’un parcours', () => {
  const evenement = { origine: 'shopify:boutique.myshopify.com:checkouts/create:42', variables: { checkout_url: 'https://x/secret-1' } };
  const lectures = [
    ['findWaitingByWaId', (s: PgWorkflowRunStore) => s.findWaitingByWaId('t1', '336')],
    ['byId', (s: PgWorkflowRunStore) => s.byId('t1', 'r1')],
    ['claimDueSleeping', async (s: PgWorkflowRunStore) => (await s.claimDueSleeping(50))[0] ?? null],
    ['claimDueQuestions', async (s: PgWorkflowRunStore) => (await s.claimDueQuestions(50))[0] ?? null],
    ['claimSleepingById', (s: PgWorkflowRunStore) => s.claimSleepingById('t1', 'r1')],
  ] as const;
  const lu = async (lire: (s: PgWorkflowRunStore) => Promise<{ evenement: unknown } | null>, valeur: unknown) =>
    (await lire(new PgWorkflowRunStore(fauxPool([{ ...ligne, status: 'waiting', evenement: valeur }]).pool)))?.evenement;

  for (const [nom, lire] of lectures) {
    it(`${nom} : rend l’origine et les variables ; null pour un parcours ordinaire`, async () => {
      expect(await lu(lire, evenement)).toEqual(evenement);
      expect(await lu(lire, null)).toBeNull();
    });
  }

  it('un parcours terminé a perdu ses variables : il rend son origine et des variables vides', async () => {
    expect(await lu(lectures[1][1], { origine: evenement.origine })).toEqual({ origine: evenement.origine, variables: {} });
  });

  it('🔴 un jsonb illisible : lu comme ordinaire, journalisé SANS la valeur', async () => {
    const erreurs: string[] = [];
    const avant = console.error;
    console.error = (...a: unknown[]) => { erreurs.push(a.map(String).join(' ')); };
    try {
      expect(await lu(lectures[1][1], { origine: 7, variables: { checkout_url: 'https://x/secret-2' } })).toBeNull();
    } finally {
      console.error = avant;
    }
    expect(erreurs.length).toBe(1);
    expect(erreurs[0]).toContain('r1');
    expect(erreurs[0]).not.toContain('secret-2');
  });
});

describe('PgWorkflowRunStore : start et la place unique d’un parcours d’événement', () => {
  const etat = { currentNode: 'n1', status: 'waiting' as const };
  const evenement = { origine: 'shopify:b:orders/paid:7', variables: { order_url: 'https://x/o' } };

  it('écrit l’événement en jsonb, et null pour un parcours ordinaire', async () => {
    for (const ev of [evenement, null]) {
      const { pool, appels } = fauxPool([{ id: 'r9' }]);
      expect(await new PgWorkflowRunStore(pool).start('t1', 'w1', '336', null, etat, null, false, false, ev)).toEqual({ id: 'r9' });
      expect(appels[0]!.sql).toContain('accord_marketing_exige, ne_en_masse, evenement)');
      // Le 13e paramètre est l'événement ; le 14e, pour un parcours d'événement seulement, son origine (lot 5).
      expect(appels[0]!.params[12]).toBe(ev === null ? null : JSON.stringify(ev));
      expect(appels[0]!.params).toHaveLength(ev === null ? 13 : 14);
    }
  });

  it('🔴 lot 5 (jaune de 4a) : un parcours qui NAÎT terminé n’écrit pas les variables (des liens à clé d’accès)', async () => {
    for (const status of ['done', 'inbox'] as const) {
      const { pool, appels } = fauxPool([{ id: 'r9' }]);
      await new PgWorkflowRunStore(pool).start('t1', 'w1', '336', null, { currentNode: null, status }, null, false, false, evenement);
      expect(JSON.parse(appels[0]!.params[12] as string)).toEqual({ origine: evenement.origine });
    }
  });

  it('🔴 lot 5 (jaune de 4a) : un événement illisible n’est jamais écrit (refus nommé, aucune requête)', async () => {
    const { pool, appels } = fauxPool([{ id: 'r9' }]);
    const illisible = { origine: 'x'.repeat(201), variables: {} };
    expect(await new PgWorkflowRunStore(pool).start('t1', 'w1', '336', null, etat, null, false, false, illisible)).toEqual({ refus: 'evenement_invalide' });
    expect(appels).toEqual([]);
  });

  it('🔴 lot 5 : la naissance idempotente, dans la même instruction, au prédicat de l’index 0300 écrit tel quel', async () => {
    const { pool, appels } = fauxPool([]);
    expect(await new PgWorkflowRunStore(pool).start('t1', 'w1', '336', null, etat, null, false, false, evenement)).toEqual({ refus: 'deja_ne' });
    const sql = appels[0]!.sql.replace(/\s+/g, ' ');
    expect(sql).toContain('where not exists ( select 1 from workflow_runs d where d.tenant_id = $2::uuid and d.wa_id = $4::text and d.evenement is not null');
    expect(sql).toContain("and not coalesce((d.evenement->>'premierNonLivre')::boolean, false)");
    expect(appels[0]!.params.at(-1)).toBe(evenement.origine);
  });

  it('🔴 relecture de 5a (jaune 5) : la garde qui précède la naissance lit le MÊME prédicat, dans l’espace et pour le contact', async () => {
    const { pool, appels } = fauxPool([{ ne: true }]);
    expect(await new PgWorkflowRunStore(pool).evenementDejaNe('t1', '336', evenement.origine)).toBe(true);
    const sql = appels[0]!.sql.replace(/\s+/g, ' ');
    expect(sql).toContain('select 1 from workflow_runs d where d.tenant_id = $1::uuid and d.wa_id = $2::text and d.evenement is not null');
    expect(sql).toContain("and d.evenement->>'origine' = $3::text");
    expect(sql).toContain("and not coalesce((d.evenement->>'premierNonLivre')::boolean, false)");
    expect(appels[0]!.params).toEqual(['t1', '336', evenement.origine]);
  });

  it('🔴 le 23505 de l’index unique devient un refus typé, jamais une exception', async () => {
    const pool = { query: async () => { throw Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'workflow_runs_evenement_actif_uniq' }); } } as unknown as Pool;
    expect(await new PgWorkflowRunStore(pool).start('t1', 'w1', '336', null, etat, null, false, false, evenement)).toEqual({ refus: 'evenement_actif' });
  });

  it('toute autre erreur remonte telle quelle', async () => {
    const pool = { query: async () => { throw Object.assign(new Error('autre'), { code: '23505', constraint: 'autre_contrainte' }); } } as unknown as Pool;
    await expect(new PgWorkflowRunStore(pool).start('t1', 'w1', '336', null, etat, null, false, false, evenement)).rejects.toThrow('autre');
  });
});

describe('PgWorkflowRunStore : les lectures et clôtures du lot 4', () => {
  const sqlDe = async (f: (s: PgWorkflowRunStore) => Promise<unknown>) => {
    const { pool, appels } = fauxPool([{ id: 'r1' }]);
    const rendu = await f(new PgWorkflowRunStore(pool));
    return { ...appels[0]!, rendu };
  };

  it('🔴 parcoursDEvenementActif reprend MOT POUR MOT le prédicat de l’index unique 0298', async () => {
    const migration = readFileSync(new URL('../db/migrations/0298_parcours_evenement_unique.sql', import.meta.url), 'utf8');
    const predicat = /where (evenement is not null and status in \('waiting', 'sleeping'\));/.exec(migration)?.[1];
    expect(predicat).toBeDefined();
    const { sql, params, rendu } = await sqlDe((s) => s.parcoursDEvenementActif('t1', '336'));
    expect(sql).toBe(`select id from workflow_runs where tenant_id = $1 and wa_id = $2 and ${predicat} limit 1`);
    expect(params).toEqual(['t1', '336']);
    expect(rendu).toEqual({ id: 'r1' });
  });

  it('🔴 décision 35 : parcoursDEvenementEndormi reprend le prédicat de l’index unique 0298, plus le sommeil, et rend l’origine', async () => {
    const migration = readFileSync(new URL('../db/migrations/0298_parcours_evenement_unique.sql', import.meta.url), 'utf8');
    const predicat = /where (evenement is not null and status in \('waiting', 'sleeping'\));/.exec(migration)?.[1];
    expect(predicat).toBeDefined();
    const origine = 'shopify:b.myshopify.com:orders/paid:1';
    const { pool, appels } = fauxPool([{ id: 'r1', origine }]);
    expect(await new PgWorkflowRunStore(pool).parcoursDEvenementEndormi('t1', '336')).toEqual({ id: 'r1', origine });
    expect(appels[0]!.sql).toBe(`select id, evenement->>'origine' as origine from workflow_runs where tenant_id = $1 and wa_id = $2 and ${predicat} and status = 'sleeping' limit 1`);
    expect(appels[0]!.params).toEqual(['t1', '336']);
    // Sans origine, rien ne pourrait l'arrêter : la lecture ne le rend pas (la remise ordinaire garde la main).
    expect(await new PgWorkflowRunStore(fauxPool([{ id: 'r2', origine: null }]).pool).parcoursDEvenementEndormi('t1', '336')).toBeNull();
  });

  it('closeOrdinairesByWaId ne clôt que les parcours ORDINAIRES actifs de ce contact', async () => {
    const { sql, params, rendu } = await sqlDe((s) => s.closeOrdinairesByWaId('t1', '336'));
    expect(sql).toContain("where tenant_id = $1 and wa_id = $2 and status in ('waiting', 'sleeping') and evenement is null returning id");
    expect(params).toEqual(['t1', '336']);
    expect(rendu).toEqual(['r1']);
  });

  it('findWaitingSurBloc : le parcours de CE contact qui attend sur CE bloc de CE scénario (un clic se route ainsi)', async () => {
    const { sql, params } = await sqlDe((s) => s.findWaitingSurBloc('t1', '336', 'w1', 'n2'));
    expect(sql).toBe("select id, workflow_id, tenant_id, wa_id, contact_id, current_node, status, last_message_id, channel, graphe_fige, accord_marketing_exige, ne_en_masse, evenement from workflow_runs where tenant_id = $1 and wa_id = $2 and status = 'waiting' and workflow_id = $3 and current_node = $4 order by created_at desc limit 1");
    expect(params).toEqual(['t1', '336', 'w1', 'n2']);
  });

  it('cloreAutresActifs épargne le parcours qui prend la main', async () => {
    const { sql, params } = await sqlDe((s) => s.cloreAutresActifs('t1', '336', 'r7'));
    expect(sql).toContain("where tenant_id = $1 and wa_id = $2 and status in ('waiting', 'sleeping') and id <> $3 returning id");
    expect(params).toEqual(['t1', '336', 'r7']);
  });

  it('cloreParOrigine et cloreParScenarios : les parcours d’événement actifs de CET espace', async () => {
    const o = await sqlDe((s) => s.cloreParOrigine('t1', 'shopify:b:checkouts/create:42'));
    expect(o.sql).toContain("where tenant_id = $1 and status in ('waiting', 'sleeping') and evenement is not null and evenement->>'origine' = $2 returning id");
    expect(o.params).toEqual(['t1', 'shopify:b:checkouts/create:42']);
    const w = await sqlDe((s) => s.cloreParScenarios('t1', ['w1', 'w2']));
    expect(w.sql).toContain("where tenant_id = $1 and status in ('waiting', 'sleeping') and evenement is not null and workflow_id = any($2::uuid[]) returning id");
    expect(w.params).toEqual(['t1', ['w1', 'w2']]);
    expect(await new PgWorkflowRunStore(fauxPool([]).pool).cloreParScenarios('t1', [])).toEqual([]);
  });

  /**
   * 🔴 LES VARIABLES S'EFFACENT À LA FIN DU PARCOURS (décision 28) : chaque écriture qui peut rendre un statut terminal
   * passe par le même fragment. L'inventaire relit le SOURCE du magasin : une écriture neuve qui l'oublierait laisserait
   * des liens à clé d'accès dans un parcours fini.
   */
  it('🔴 toute écriture de statut du magasin efface les variables d’un parcours qui se termine', () => {
    const source = readFileSync(new URL('../src/workflow/run-store.pg.ts', import.meta.url), 'utf8');
    const ecritures = [...source.matchAll(/`update workflow_runs[^`]*`/g)].map((m) => m[0]).filter((s) => /\bstatus = /.test(s.split('where')[0]!));
    expect(ecritures.length).toBeGreaterThanOrEqual(8);
    for (const e of ecritures) expect(e).toContain('${EFFACER_VARIABLES');
  });
});
