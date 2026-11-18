import '../../src/charger-env';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { pgSsl } from '../../src/db/ssl';
import { PgWorkflowStore } from '../../src/workflow/store.pg';
import { PgModelesDeBloc } from '../../src/workflow/modeles-de-bloc.pg';
import type { WorkflowGraph } from '../../src/workflow/graph';

const url = process.env.DATABASE_URL ?? '';

/**
 * Les templates écrits depuis un bloc et la publication programmée (menu « Scénario », lot 3, migration 0296).
 *
 * 🔴 POURQUOI EN INTÉGRATION. Les promesses tiennent dans le SQL : la mise en ligne programmée ne passe que si sa date
 * n'a pas changé (une publication explicite entre-temps l'emporte), une seule de deux mises en ligne concurrentes gagne,
 * un statut rejoué par Meta ne tranche qu'une fois. Un faux magasin rendrait ce qu'on lui fait rendre.
 *
 * Jamais joué en local contre le DATABASE_URL du poste (l'ancienne production) : joué par le job `integration`, ou sur
 * le banc PGlite.
 */
describe.skipIf(!url)('templates de bloc et publication programmée (Postgres)', () => {
  let pool: Pool;
  let store: PgWorkflowStore;
  let modeles: PgModelesDeBloc;
  let tenantId: string;
  let autre: string;

  const grapheEn = (tag: string, x = 0): WorkflowGraph => ({
    nodes: [{ id: 'n1', type: 'tag', position: { x, y: 0 }, data: { tag } }],
    edges: [],
  });

  /** Un scénario publié en v1, avec un brouillon v2 : l'état de départ d'une programmation. */
  const scenarioAvecBrouillon = async (nom: string): Promise<string> => {
    const { id } = await store.insert(tenantId, nom, grapheEn('v1'), 'general');
    await store.publish(id, tenantId);
    await store.update(id, tenantId, { graph: grapheEn('v2') });
    return id;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, ssl: pgSsl(), max: 4 });
    store = new PgWorkflowStore(pool);
    modeles = new PgModelesDeBloc(pool);
    tenantId = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-modeles-de-bloc') returning id`)).rows[0]!.id;
    autre = (await pool.query<{ id: string }>(`insert into tenants (name) values ('itest-modeles-de-bloc-autre') returning id`)).rows[0]!.id;
  });

  afterAll(async () => {
    await pool.query('delete from tenants where id = any($1::uuid[])', [[tenantId, autre].filter(Boolean)]);
    await pool.end();
  });

  describe('la publication programmée', () => {
    it('🔴 programmer ne touche pas la version en ligne ; la mise en ligne, à sa date, la remplace et efface la programmation', async () => {
      const id = await scenarioAvecBrouillon('programme');
      const p = await store.programmer(id, tenantId, null, grapheEn('v2'));
      expect(p).not.toBeNull();
      const pendant = (await store.getById(id, tenantId))!;
      expect(pendant.graph.nodes[0]!.data.tag).toBe('v1');

      const lue = (await store.publicationProgrammee(id, tenantId))!;
      // La date relue par JS doit retrouver celle de la base : elle s'écrit à la milliseconde, sinon aucune mise en
      // ligne ne la retrouverait jamais (JS ne garde pas les microsecondes de Postgres).
      expect(lue.le).toBe(p!.le);
      expect(lue.graphe.nodes[0]!.data.tag).toBe('v2');

      const enLigne = (await store.mettreEnLigneLaVersionProgrammee(id, tenantId, lue.le))!;
      expect(enLigne.graph.nodes[0]!.data.tag).toBe('v2');
      // Le brouillon était la version programmée : il n'en reste rien à publier.
      expect(enLigne.draftGraph).toBeNull();
      expect(new Date(enLigne.publishedAt!).getTime()).toBeGreaterThanOrEqual(new Date(pendant.publishedAt!).getTime());
      expect(await store.publicationProgrammee(id, tenantId)).toBeNull();
    });

    it('🔴 une publication À LA MAIN entre-temps l’emporte : la mise en ligne programmée ne fait plus rien', async () => {
      const id = await scenarioAvecBrouillon('main-entre-temps');
      const p = (await store.programmer(id, tenantId, null, grapheEn('v2')))!;
      await store.update(id, tenantId, { graph: grapheEn('v3') });
      await store.publish(id, tenantId);
      expect(await store.publicationProgrammee(id, tenantId)).toBeNull();
      expect(await store.mettreEnLigneLaVersionProgrammee(id, tenantId, p.le)).toBeNull();
      expect((await store.getById(id, tenantId))!.graph.nodes[0]!.data.tag).toBe('v3');
    });

    it('🔴 une écriture de l’API publique l’emporte aussi', async () => {
      const id = await scenarioAvecBrouillon('api-entre-temps');
      const p = (await store.programmer(id, tenantId, null, grapheEn('v2')))!;
      expect(await store.remplacerPublieParApi(id, tenantId, 'api-entre-temps', grapheEn('api'), () => null)).toBe('ok');
      expect(await store.mettreEnLigneLaVersionProgrammee(id, tenantId, p.le)).toBeNull();
      expect((await store.getById(id, tenantId))!.graph.nodes[0]!.data.tag).toBe('api');
    });

    it('🔴 une programmation plus récente remplace la précédente : l’ancienne date ne met plus rien en ligne', async () => {
      const id = await scenarioAvecBrouillon('reprogramme');
      const premiere = (await store.programmer(id, tenantId, null, grapheEn('v2')))!;
      await new Promise((r) => setTimeout(r, 5));
      const seconde = (await store.programmer(id, tenantId, null, grapheEn('v2b')))!;
      expect(seconde.le).not.toBe(premiere.le);
      expect(await store.mettreEnLigneLaVersionProgrammee(id, tenantId, premiere.le)).toBeNull();
      expect((await store.mettreEnLigneLaVersionProgrammee(id, tenantId, seconde.le))!.graph.nodes[0]!.data.tag).toBe('v2b');
    });

    it('🔴 deux mises en ligne simultanées : une seule gagne', async () => {
      const id = await scenarioAvecBrouillon('concurrence');
      const p = (await store.programmer(id, tenantId, null, grapheEn('v2')))!;
      const issues = await Promise.all([
        store.mettreEnLigneLaVersionProgrammee(id, tenantId, p.le),
        store.mettreEnLigneLaVersionProgrammee(id, tenantId, p.le),
      ]);
      expect(issues.filter((x) => x !== null)).toHaveLength(1);
    });

    it('un brouillon MODIFIÉ depuis la programmation reste un brouillon ; seulement DÉPLACÉ, il part avec sa disposition', async () => {
      const modifie = await scenarioAvecBrouillon('brouillon-modifie');
      const p1 = (await store.programmer(modifie, tenantId, null, grapheEn('v2')))!;
      await store.update(modifie, tenantId, { graph: grapheEn('v3') });
      const r1 = (await store.mettreEnLigneLaVersionProgrammee(modifie, tenantId, p1.le))!;
      expect(r1.graph.nodes[0]!.data.tag).toBe('v2');
      expect(r1.draftGraph!.nodes[0]!.data.tag).toBe('v3');

      const deplace = await scenarioAvecBrouillon('brouillon-deplace');
      const p2 = (await store.programmer(deplace, tenantId, null, grapheEn('v2')))!;
      await store.update(deplace, tenantId, { graph: grapheEn('v2', 300) });
      const r2 = (await store.mettreEnLigneLaVersionProgrammee(deplace, tenantId, p2.le))!;
      expect(r2.graph.nodes[0]!.position).toEqual({ x: 300, y: 0 });
      expect(r2.draftGraph).toBeNull();
    });

    it('annuler : à la mauvaise date rien, sans date ou à la bonne date la programmation part', async () => {
      const id = await scenarioAvecBrouillon('annuler');
      const p = (await store.programmer(id, tenantId, null, grapheEn('v2')))!;
      expect(await store.annulerProgrammation(id, tenantId, '2000-01-01T00:00:00.000Z')).toBe(false);
      expect(await store.annulerProgrammation(id, tenantId, p.le)).toBe(true);
      expect(await store.publicationProgrammee(id, tenantId)).toBeNull();
      await store.programmer(id, tenantId, null, grapheEn('v2'));
      expect(await store.annulerProgrammation(id, tenantId, null)).toBe(true);
      expect(await store.annulerProgrammation(id, tenantId, null)).toBe(false);
      expect((await store.getById(id, tenantId))!.graph.nodes[0]!.data.tag).toBe('v1');
    });

    it('🔴 un autre espace ne programme, ne lit, ne met en ligne ni n’annule rien', async () => {
      const id = await scenarioAvecBrouillon('isolation-programme');
      expect(await store.programmer(id, autre, null, grapheEn('vole'))).toBeNull();
      const p = (await store.programmer(id, tenantId, null, grapheEn('v2')))!;
      expect(await store.publicationProgrammee(id, autre)).toBeNull();
      expect(await store.programmeesDeLEspace(autre)).toEqual([]);
      expect(await store.mettreEnLigneLaVersionProgrammee(id, autre, p.le)).toBeNull();
      expect(await store.annulerProgrammation(id, autre, null)).toBe(false);
      expect((await store.publicationProgrammee(id, tenantId))!.le).toBe(p.le);
    });

    it('les programmations de l’espace, et les anciennes pour le filet (tous espaces)', async () => {
      const id = await scenarioAvecBrouillon('liste-programmees');
      await store.programmer(id, tenantId, null, grapheEn('v2'));
      const espace = await store.programmeesDeLEspace(tenantId);
      const la = espace.find((x) => x.id === id);
      expect(la?.nom).toBe('liste-programmees');
      expect(la?.rayon).toBe('general');
      expect(la?.graphe.nodes[0]!.data.tag).toBe('v2');
      const anciennes = (await store.programmeesAnciennes(0, 1000)).map((x) => ({ tenantId: x.tenantId, id: x.id, nom: x.nom }));
      expect(anciennes).toContainEqual({ tenantId, id, nom: 'liste-programmees' });
      expect((await store.programmeesAnciennes(60, 1000)).map((x) => x.id)).not.toContain(id);
    });
  });

  describe('la table des templates de bloc', () => {
    it('🔴 un statut ne se tranche qu’une fois (statut rejoué par Meta, filet)', async () => {
      const { id } = await store.insert(tenantId, 'tranche', grapheEn('v1'), 'general');
      await modeles.inserer(tenantId, { workflowId: id, modele: 'tranche_1', langue: 'fr', etat: 'en_validation', par: null });
      const premiere = await modeles.trancher(tenantId, 'tranche_1', 'fr', 'refuse', 'x'.repeat(400));
      expect(premiere?.etat).toBe('refuse');
      expect(premiere?.raison).toHaveLength(300);
      expect(await modeles.trancher(tenantId, 'tranche_1', 'fr', 'approuve', null)).toBeNull();
      expect((await modeles.duScenario(tenantId, id))[0]!.etat).toBe('refuse');
    });

    it('les lignes d’un scénario, celles de quelques templates, et les attentes anciennes du filet', async () => {
      const { id } = await store.insert(tenantId, 'lignes', grapheEn('v1'), 'general');
      await modeles.inserer(tenantId, { workflowId: id, modele: 'lignes_a', langue: 'fr', etat: 'en_validation', par: null });
      await modeles.inserer(tenantId, { workflowId: id, modele: 'lignes_b', langue: 'en_US', etat: 'approuve', par: null });
      expect((await modeles.duScenario(tenantId, id)).map((l) => l.modele).sort()).toEqual(['lignes_a', 'lignes_b']);
      const choisies = await modeles.desModeles(tenantId, [{ modele: 'lignes_b', langue: 'en_US' }, { modele: 'lignes_a', langue: 'en_US' }]);
      expect(choisies.map((l) => `${l.modele}|${l.langue}`)).toEqual(['lignes_b|en_US']);
      expect(await modeles.desModeles(tenantId, [])).toEqual([]);
      const attentes = await modeles.attentesAnciennes(0, 1000);
      expect(attentes).toContainEqual({ tenantId, modele: 'lignes_a', langue: 'fr' });
      expect(attentes).not.toContainEqual({ tenantId, modele: 'lignes_b', langue: 'en_US' });
      expect(await modeles.attentesAnciennes(60, 1000)).not.toContainEqual({ tenantId, modele: 'lignes_a', langue: 'fr' });
    });

    it('🔴 un autre espace ne lit ni ne tranche les lignes', async () => {
      const { id } = await store.insert(tenantId, 'lignes-isolation', grapheEn('v1'), 'general');
      await modeles.inserer(tenantId, { workflowId: id, modele: 'iso_a', langue: 'fr', etat: 'en_validation', par: null });
      expect(await modeles.duScenario(autre, id)).toEqual([]);
      expect(await modeles.desModeles(autre, [{ modele: 'iso_a', langue: 'fr' }])).toEqual([]);
      expect(await modeles.trancher(autre, 'iso_a', 'fr', 'approuve', null)).toBeNull();
      expect((await modeles.duScenario(tenantId, id))[0]!.etat).toBe('en_validation');
    });

    it('supprimer le scénario efface ses lignes (cascade)', async () => {
      const { id } = await store.insert(tenantId, 'cascade', grapheEn('v1'), 'general');
      await modeles.inserer(tenantId, { workflowId: id, modele: 'cascade_a', langue: 'fr', etat: 'en_validation', par: null });
      await store.remove(id, tenantId);
      expect(await modeles.desModeles(tenantId, [{ modele: 'cascade_a', langue: 'fr' }])).toEqual([]);
    });
  });
});
