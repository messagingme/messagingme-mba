import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgWorkflowRunStore, type RunState } from '../../src/workflow/run-store.pg';
import type { EvenementDuParcours } from '../../src/workflow/evenement';

/**
 * LE PARCOURS D'ÉVÉNEMENT contre une VRAIE base (menu « Scénario », lot 4, migrations 0297 et 0298, décisions 21 et 28).
 *
 * 🔴 Ce que seul un aller-retour prouve : que `start` ÉCRIT l'événement et que chaque lecture le RELIT (une fausse
 * implémentation à huit paramètres reste assignable au contrat de l'exécuteur) ; que l'index unique refuse un SECOND
 * parcours d'événement actif pour un contact, et que ce refus arrive comme un refus typé ; que les clôtures épargnent ou
 * visent ce qu'elles disent ; que la fin d'un parcours efface ses variables (des liens à clé d'accès) et garde son origine.
 */
const url = process.env.DATABASE_URL ?? '';

describe.skipIf(!url)('workflow_runs.evenement : la place unique, les lectures, les clôtures', () => {
  let pool: Pool;
  let store: PgWorkflowRunStore;
  let tenantId: string;
  let autreTenant: string;
  let workflowId: string;
  let autreWorkflow: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl() });
    store = new PgWorkflowRunStore(pool);
    const espace = async (nom: string) => (await pool.query<{ id: string }>(`insert into tenants (name) values ($1) returning id`, [nom])).rows[0]!.id;
    tenantId = await espace('itest-run-evenement');
    autreTenant = await espace('itest-run-evenement-autre');
    const scenario = async (t: string) => (await pool.query<{ id: string }>(
      `insert into workflows (tenant_id, name, graph) values ($1, 'itest', '{"nodes":[],"edges":[]}'::jsonb) returning id`, [t],
    )).rows[0]!.id;
    workflowId = await scenario(tenantId);
    autreWorkflow = await scenario(autreTenant);
  });

  afterAll(async () => {
    await pool.query(`delete from tenants where id = any($1::uuid[])`, [[tenantId, autreTenant]]);
    await pool.end();
  });

  const ev = (ref: string): EvenementDuParcours => ({ origine: `shopify:b:checkouts/create:${ref}`, variables: { checkout_url: `https://x/${ref}` } });

  /** Un parcours né par le CHEMIN RÉEL (`start`). */
  async function nait(t: string, w: string, waId: string, evenement: EvenementDuParcours | null, etat: Partial<RunState> = {}): Promise<string> {
    const r = await store.start(t, w, waId, null, { currentNode: 'n1', status: 'waiting', ...etat }, null, false, false, evenement);
    if (!('id' in r)) throw new Error(`refus inattendu : ${r.refus}`);
    return r.id;
  }
  const evenementEnBase = async (id: string) =>
    (await pool.query<{ evenement: unknown }>(`select evenement from workflow_runs where id = $1`, [id])).rows[0]?.evenement;

  it('🔴 start écrit l’événement ; findWaitingByWaId, byId et les trois réclamations le relisent', async () => {
    const e = ev('lu');
    const enAttente = await nait(tenantId, workflowId, '33600009101', e);
    expect(await evenementEnBase(enAttente)).toEqual(e);
    expect((await store.findWaitingByWaId(tenantId, '33600009101'))?.evenement).toEqual(e);
    expect((await store.byId(tenantId, enAttente))?.evenement).toEqual(e);

    const passe = new Date(Date.now() - 60_000);
    const court = await nait(tenantId, workflowId, '33600009102', ev('court'), { status: 'sleeping', resumeAt: passe });
    const dormant = await nait(tenantId, workflowId, '33600009103', ev('dormant'), { status: 'sleeping', resumeAt: passe });
    const question = await nait(tenantId, workflowId, '33600009104', ev('question'), { resumeAt: passe });
    // Le réveil court d'abord : la réclamation par lot prendrait aussi ce parcours.
    expect((await store.claimSleepingById(tenantId, court))?.evenement).toEqual(ev('court'));
    expect((await store.claimDueSleeping(500)).find((r) => r.id === dormant)?.evenement).toEqual(ev('dormant'));
    expect((await store.claimDueQuestions(500)).find((r) => r.id === question)?.evenement).toEqual(ev('question'));
  });

  it('🔴 lot 5 (relecture de 5a) : le message et le bloc de départ se relisent par les deux lectures d’`advance`, la marque du premier message non livré aussi', async () => {
    // L'exécuteur route un clic par `messageId` et `noeudDepart` (`clicPasPourLeParcours`) : relus `undefined`, le clic sur le
    // premier message d'un événement FRÈRE prenait la branche de ce parcours-ci, avec l'ancien lien.
    const e: EvenementDuParcours = { ...ev('repere'), messageId: 'wamid.A', noeudDepart: 'n1' };
    const id = await nait(tenantId, workflowId, '33600009105', e);
    expect((await store.findWaitingByWaId(tenantId, '33600009105'))?.evenement).toEqual(e);
    expect((await store.findWaitingSurBloc(tenantId, '33600009105', workflowId, 'n1'))?.evenement).toEqual(e);
    await pool.query(`update workflow_runs set evenement = evenement || '{"premierNonLivre": true}'::jsonb where id = $1`, [id]);
    expect((await store.byId(tenantId, id))?.evenement).toEqual({ ...e, premierNonLivre: true });
  });

  it('🔴 un SECOND parcours d’événement actif pour le même contact est refusé ; un ordinaire coexiste', async () => {
    const wa = '33600009111';
    const premier = await nait(tenantId, workflowId, wa, ev('a'));
    const second = await store.start(tenantId, workflowId, wa, null, { currentNode: 'n1', status: 'sleeping' }, null, false, false, ev('b'));
    expect(second).toEqual({ refus: 'evenement_actif' });
    const ordinaire = await nait(tenantId, workflowId, wa, null);
    expect(await store.parcoursDEvenementActif(tenantId, wa)).toEqual({ id: premier });
    expect(ordinaire).not.toBe(premier);
    // Un autre contact, ou le même numéro dans un autre espace : leur place est libre.
    await nait(tenantId, workflowId, '33600009112', ev('a'));
    await nait(autreTenant, autreWorkflow, wa, ev('a'));
  });

  it('🔴 closeOrdinairesByWaId épargne le parcours d’événement ; cloreAutresActifs épargne celui qui prend la main', async () => {
    const wa = '33600009121';
    const evenement = await nait(tenantId, workflowId, wa, ev('c'));
    const ordinaire = await nait(tenantId, workflowId, wa, null);
    expect(await store.closeOrdinairesByWaId(tenantId, wa)).toEqual([ordinaire]);
    expect((await store.byId(tenantId, evenement))?.status).toBe('waiting');
    const repondeur = await nait(tenantId, workflowId, wa, null);
    expect(await store.cloreAutresActifs(tenantId, wa, evenement)).toEqual([repondeur]);
    expect((await store.byId(tenantId, evenement))?.status).toBe('waiting');
  });

  it('🔴 la fin d’un parcours efface ses variables et garde son origine, quelle que soit l’écriture qui le clôt', async () => {
    const fins: Array<[string, (id: string, wa: string) => Promise<unknown>]> = [
      ['closeActiveByWaId', (_id, wa) => store.closeActiveByWaId(tenantId, wa)],
      ['setState done', (id) => store.setState(id, { currentNode: null, status: 'done' })],
      ['setState inbox', (id) => store.setState(id, { currentNode: null, status: 'inbox' })],
      ['setStateSiVivant', (id) => store.setStateSiVivant(tenantId, id, { currentNode: null, status: 'done' })],
      ['setStateSiEncoreSur', (id) => store.setStateSiEncoreSur(tenantId, id, 'n1', { currentNode: null, status: 'done' })],
      ['cloreParOrigine', () => store.cloreParOrigine(tenantId, ev('fin-cloreParOrigine').origine)],
    ];
    let n = 0;
    for (const [nom, finir] of fins) {
      const wa = `3360000913${n++}`;
      const e = ev(`fin-${nom}`);
      const id = await nait(tenantId, workflowId, wa, e);
      await finir(id, wa);
      expect({ nom, evenement: await evenementEnBase(id) }).toEqual({ nom, evenement: { origine: e.origine } });
    }
    // Une écriture qui ne termine pas le parcours garde ses variables.
    const vivant = await nait(tenantId, workflowId, '33600009140', ev('vivant'));
    await store.setState(vivant, { currentNode: 'n2', status: 'sleeping', resumeAt: new Date(Date.now() + 3_600_000) });
    expect(await evenementEnBase(vivant)).toEqual(ev('vivant'));
  });

  it('cloreParOrigine et cloreParScenarios ne touchent que les parcours d’événement actifs de CET espace', async () => {
    const e = ev('origine-commune');
    const cible = await nait(tenantId, workflowId, '33600009151', e);
    const ailleurs = await nait(autreTenant, autreWorkflow, '33600009151', e);
    const ordinaire = await nait(tenantId, workflowId, '33600009152', null);
    expect(await store.cloreParOrigine(tenantId, e.origine)).toEqual([cible]);
    expect((await store.byId(autreTenant, ailleurs))?.status).toBe('waiting');

    const parScenario = await nait(tenantId, workflowId, '33600009153', ev('scenario'));
    const fermes = await store.cloreParScenarios(tenantId, [workflowId, autreWorkflow]);
    expect(fermes).toContain(parScenario);
    expect(fermes).not.toContain(ordinaire);
    expect(fermes).not.toContain(ailleurs);
    expect((await store.byId(tenantId, ordinaire))?.status).toBe('waiting');
  });

  it('🔴 deux parcours attendent le même contact : findWaitingSurBloc rend celui du bloc demandé, findWaitingByWaId le plus récent', async () => {
    const wa = '33600009171';
    const evenement = await nait(tenantId, workflowId, wa, ev('deux'), { currentNode: 'tpl' });
    const ordinaire = await nait(tenantId, workflowId, wa, null, { currentNode: 'q' });
    // « Le plus récent » se prouve par la date, jamais par la vitesse du banc : deux insertions dans la même milliseconde
    // portent la même date, et l'ordre rendu était alors celui du hasard (un échec sur trois, mesuré sur le banc PGlite).
    const dater = (id: string, decalage: string) =>
      pool.query(`update workflow_runs set created_at = now() + $3::interval where id = $1 and tenant_id = $2`, [id, tenantId, decalage]);
    await dater(evenement, '-1 minute');
    expect((await store.findWaitingByWaId(tenantId, wa))?.id).toBe(ordinaire);
    await dater(evenement, '1 minute');
    expect((await store.findWaitingByWaId(tenantId, wa))?.id).toBe(evenement);
    expect((await store.findWaitingSurBloc(tenantId, wa, workflowId, 'tpl'))?.id).toBe(evenement);
    expect(await store.findWaitingSurBloc(tenantId, wa, workflowId, 'absent')).toBeNull();
    expect(await store.findWaitingSurBloc(autreTenant, wa, workflowId, 'tpl')).toBeNull();
  });

  it('🔴 lot 5 : une seconde naissance de la même origine est refusée, même le premier parcours terminé ; admise après un premier message non livré', async () => {
    const wa = '33600009181';
    const e = ev('une-fois');
    const etat = { currentNode: 'tpl', status: 'waiting' as const };
    const premier = await store.start(tenantId, workflowId, wa, null, etat, null, false, false, e);
    expect('id' in premier).toBe(true);
    // Terminé normalement (la suite est partie) : la relance automatique ne le fait pas renaître.
    await pool.query(`update workflow_runs set status = 'done', current_node = null where id = $1 and tenant_id = $2`, [(premier as { id: string }).id, tenantId]);
    expect(await store.start(tenantId, workflowId, wa, null, etat, null, false, false, e)).toEqual({ refus: 'deja_ne' });
    // Le même événement pour un AUTRE contact, ou dans un AUTRE espace : rien ne l'empêche.
    expect('id' in (await store.start(tenantId, workflowId, '33600009182', null, etat, null, false, false, e))).toBe(true);
    expect('id' in (await store.start(autreTenant, autreWorkflow, wa, null, etat, null, false, false, e))).toBe(true);
    // Clos parce que son premier message n'a pas été livré : une nouvelle tentative le fait renaître.
    await pool.query(`update workflow_runs set evenement = evenement || '{"premierNonLivre": true}'::jsonb where id = $1 and tenant_id = $2`, [(premier as { id: string }).id, tenantId]);
    expect('id' in (await store.start(tenantId, workflowId, wa, null, etat, null, false, false, e))).toBe(true);
  });

  const envoye = (wa: string, wamid: string) => pool.query(
    `insert into workflow_node_events (tenant_id, workflow_id, node_id, wa_id, kind, meta_message_id) values ($1, $2, 'tpl', $3, 'sent', $4)`,
    [tenantId, workflowId, wa, wamid],
  );
  const lireRun = async (id: string) => (await pool.query<{ status: string; evenement: Record<string, unknown> }>(
    `select status, evenement from workflow_runs where id = $1`, [id],
  )).rows[0]!;

  it('🔴 lot 5 : l’échec de livraison du premier message clôt le parcours né sur lui, encore sur son bloc de départ', async () => {
    const wa = '33600009191';
    const e: EvenementDuParcours = { ...ev('non-livre'), messageId: 'wamid.nonlivre', noeudDepart: 'tpl' };
    const id = await nait(tenantId, workflowId, wa, e, { currentNode: 'tpl' });
    await envoye(wa, 'wamid.nonlivre');
    expect(await store.clorePremierNonLivre('wamid.nonlivre')).toBe(1);
    const r = await lireRun(id);
    expect(r.status).toBe('done');
    // Les variables (des liens à clé d'accès) effacées, l'origine gardée, la marque posée : une nouvelle tentative renaîtra.
    expect(r.evenement).toEqual({ origine: e.origine, messageId: 'wamid.nonlivre', noeudDepart: 'tpl', premierNonLivre: true });
  });

  it('un parcours qui a QUITTÉ son bloc de départ, ou un message inconnu, ne se clôt pas', async () => {
    const wa = '33600009192';
    const e: EvenementDuParcours = { ...ev('parti'), messageId: 'wamid.parti', noeudDepart: 'tpl' };
    const id = await nait(tenantId, workflowId, wa, e, { currentNode: 'qm1' });
    await envoye(wa, 'wamid.parti');
    expect(await store.clorePremierNonLivre('wamid.parti')).toBe(0);
    expect(await store.clorePremierNonLivre('wamid.inconnu')).toBe(0);
    expect((await lireRun(id)).status).toBe('waiting');
  });

  it('🔴 lot 5 : l’arrêt par préfixe, pour un contact ou toute la boutique ; un autre espace intact ; « _ » n’est pas un joker', async () => {
    const etat = { currentNode: 'tpl', status: 'waiting' as const };
    const ne = async (t: string, w: string, wa: string, origine: string) =>
      ((await store.start(t, w, wa, null, etat, null, false, false, { origine, variables: {} })) as { id: string }).id;
    const panier = await ne(tenantId, workflowId, '33600009201', 'shopify:b_x.myshopify.com:checkouts/abandoned:1');
    const commande = await ne(tenantId, workflowId, '33600009202', 'shopify:b_x.myshopify.com:orders/paid:2');
    const autreBoutique = await ne(tenantId, workflowId, '33600009203', 'shopify:bAx.myshopify.com:orders/paid:3');
    const autreEspace = await ne(autreTenant, autreWorkflow, '33600009201', 'shopify:b_x.myshopify.com:checkouts/abandoned:9');
    expect(await store.cloreParPrefixe(tenantId, 'shopify:b_x.myshopify.com:checkouts/abandoned:', '33600009201')).toEqual([panier]);
    expect(await store.cloreParPrefixe(tenantId, 'shopify:b_x.myshopify.com:')).toEqual([commande]);
    for (const id of [autreBoutique, autreEspace]) expect((await lireRun(id)).status).toBe('waiting');
    expect((await lireRun(panier)).evenement, 'les variables effacées à la clôture').not.toHaveProperty('variables');
  });

  it('la colonne est nulle par défaut : un parcours inséré sans elle (l’ancien code) est ordinaire', async () => {
    const r = await pool.query<{ evenement: unknown }>(
      `insert into workflow_runs (workflow_id, tenant_id, wa_id, current_node, status) values ($1, $2, '33600009161', 'n1', 'waiting')
       returning evenement`,
      [workflowId, tenantId],
    );
    expect(r.rows[0]?.evenement).toBeNull();
  });
});
