import { describe, it, expect } from 'vitest';
import { bornerInstantane, creerCapture, TAILLE_MAX_INSTANTANE, type IncidentsStore } from '../src/ops/incidents';
import { creerVeilleCharge, type LecturesCharge } from '../src/ops/veille-charge';
import { creerVeilleSante } from '../src/ops/veille-sante';
import { SEUILS_DEFAUT } from '../src/ops/seuils';
import type { BilanSante, Brique } from '../src/ops/sante';
import { incidentsNotes } from './incidents-fixture';

/** Laisse s'écouler les promesses lancées sans être attendues. */
const vider = () => new Promise((r) => setTimeout(r, 0));

function storeNote(o: { ouvrirLeve?: boolean } = {}) {
  const ouverts: Array<Parameters<IncidentsStore['ouvrir']>[0]> = [];
  const clos: Array<[string, unknown]> = [];
  const store: IncidentsStore = {
    ouvrir: async (i) => { if (o.ouvrirLeve) throw new Error('base'); ouverts.push(i); return 1; },
    clore: async (signal, inst) => { clos.push([signal, inst]); },
  };
  return { store, ouverts, clos };
}

describe('🔴 la capture d’un incident', () => {
  it('borne l’instantané à la limite du déclencheur, en raccourcissant la plus longue liste', () => {
    const gros = { pris_le: 'x', jobs_lents: Array.from({ length: 5000 }, (_, i) => ({ file: 'webhook', i })), base: [{ n: 1 }] };
    const borne = bornerInstantane(gros);
    expect(JSON.stringify(borne).length).toBeLessThanOrEqual(TAILLE_MAX_INSTANTANE);
    expect(borne).toMatchObject({ tronque: true, base: [{ n: 1 }] });
    // Petit, il passe tel quel.
    expect(bornerInstantane({ a: [1, 2] })).toEqual({ a: [1, 2] });
    // Rien à raccourcir et trop gros : remplacé par sa mention.
    expect(bornerInstantane({ texte: 'x'.repeat(TAILLE_MAX_INSTANTANE) })).toEqual({ tronque: true, raison: expect.any(String) });
  });

  it('🔴 n’est jamais attendue : ouvrir rend la main avant que l’instantané soit lu', async () => {
    const { store, ouverts } = storeNote();
    let liberer!: () => void;
    const capture = creerCapture({ store, lire: () => new Promise((r) => { liberer = () => r({ pris_le: 't' }); }) });
    capture.ouvrir('sante', 'entrants', 'orange', 'texte');
    expect(ouverts).toEqual([]);
    liberer();
    await vider();
    expect(ouverts).toEqual([{ source: 'sante', signal: 'entrants', etat: 'orange', texte: 'texte', instantane: { pris_le: 't' } }]);
  });

  it('🔴 cinq alertes de la même minute lisent la base UNE fois, la minute suivante relit', async () => {
    const { store, ouverts } = storeNote();
    let t = 0;
    let lectures = 0;
    const capture = creerCapture({ store, lire: async () => ({ n: ++lectures }), maintenant: () => t });
    for (const f of ['a', 'b', 'c', 'd', 'e']) capture.ouvrir('charge', `veille:file:${f}`, 'alerte', 't');
    await vider();
    expect(lectures).toBe(1);
    expect(ouverts.map((o) => o.instantane)).toEqual(Array(5).fill({ n: 1 }));
    t += 61_000;
    capture.ouvrir('charge', 'veille:file:f', 'alerte', 't');
    await vider();
    expect(lectures).toBe(2);
  });

  it('🔴 un instantané illisible n’empêche pas l’incident d’être inscrit, et une base en panne ne remonte pas', async () => {
    const a = storeNote();
    creerCapture({ store: a.store, lire: async () => { throw new Error('lecture'); } }).ouvrir('charge', 'veille:pool:api', 'alerte', 't');
    await vider();
    expect(a.ouverts).toEqual([expect.objectContaining({ signal: 'veille:pool:api', instantane: null })]);
    const b = storeNote({ ouvrirLeve: true });
    expect(() => creerCapture({ store: b.store, lire: async () => ({}) }).ouvrir('sante', 'base', 'rouge', 't')).not.toThrow();
    await vider();
  });
});

describe('🔴 les veilles déclenchent la capture', () => {
  const brique = (b: Partial<Brique> & Pick<Brique, 'cle' | 'etat'>): Brique => ({ mesure: null, ...b } as Brique);
  const bilan = (briques: Brique[]) => ({ briques, jauge: { margePourcent: 50, signal: 'entrants', partielle: false } }) as unknown as BilanSante;
  const verrous = { prendre: async () => ({ jeton: 'j', cles: ['veille-sante'] }), relacher: async () => {}, prolonger: async () => true };

  function veilleSante(briques: Brique[], o: { envoye?: boolean; connu?: 'orange' } = {}) {
    const n = incidentsNotes();
    const veille = creerVeilleSante({
      evaluer: async () => ({ bilan: bilan(briques), seuils: SEUILS_DEFAUT, workers: [] }),
      alertes: {
        dernieres: async () => new Map(o.connu ? [['entrants', { signal: 'entrants', etat: o.connu, mesure: 9, envoyeLe: new Date(0).toISOString() }]] : []),
        noter: async () => {},
      },
      verrous,
      envoyer: async () => o.envoye ?? true,
      incidents: n.capture,
    });
    return { veille, appels: n.appels };
  }

  it('une brique qui passe orange ouvre un incident, avec le texte parti', async () => {
    const { veille, appels } = veilleSante([brique({ cle: 'entrants', etat: 'orange', mesure: 9 })]);
    await veille();
    expect(appels).toEqual([{ quoi: 'ouvrir', args: ['sante', 'entrants', 'orange', expect.stringContaining('Retard des messages entrants passe ORANGE')] }]);
  });

  it('le retour au vert clôt l’incident du signal', async () => {
    const { veille, appels } = veilleSante([brique({ cle: 'entrants', etat: 'vert', mesure: 0.2 })], { connu: 'orange' });
    await veille();
    expect(appels).toEqual([{ quoi: 'clore', args: ['entrants'] }]);
  });

  it('une alerte que Telegram n’a pas prise n’ouvre rien : elle repartira, et l’incident avec elle', async () => {
    const { veille, appels } = veilleSante([brique({ cle: 'entrants', etat: 'rouge', mesure: 40 })], { envoye: false });
    await veille();
    expect(appels).toEqual([]);
  });

  it('la veille de charge ouvre un incident par alerte partie, pas par passage', async () => {
    const n = incidentsNotes();
    let t = 1_800_000_000_000;
    const lire: LecturesCharge = {
      agesDAttente: async () => [{ file: 'push-analysis', ageSecondes: 325 }],
      latencesReceptionMeta: async () => ({ seaux: [], maxMs: 0 }),
      attentesPool: async () => [],
      refusPlafondGlobal: async () => [],
    };
    const passe = creerVeilleCharge({ lire, alerter: () => {}, incidents: n.capture, maintenant: () => t });
    await passe();
    t += 60_000;
    await passe();
    expect(n.appels).toEqual([{ quoi: 'ouvrir', args: ['charge', 'veille:file:push-analysis', 'alerte', expect.stringContaining('push-analysis en retard')] }]);
  });
});
