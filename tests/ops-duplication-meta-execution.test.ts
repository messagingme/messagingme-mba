import { describe, it, expect } from 'vitest';
import type { ClientModeles, CreateTemplateInput, TemplateSummary } from '../src/meta/templates';
import type { FlowScreenDef } from '../src/meta/flow-json';
import { MetaApiError } from '../src/meta/errors';
import type { DepsGestionModeles } from '../src/templates/gestion';
import { executerChezMeta, type DepsExecutionMeta, type EntreeMeta } from '../src/ops/duplication/meta-execution';

/**
 * LA CRÉATION CHEZ META D'UNE DUPLICATION (lot 3, tâche 3 du plan `docs/superpowers/plans/2026-11-17-duplication-scenario-lot-3.md`).
 * Contre des faux qui notent chaque geste dans un journal, mais avec le VRAI `creerUnModele` : c'est lui qui alloue les
 * liens tracés, et l'isolation entre espaces se prouve sur lui.
 */

const SRC = 'espace-source';
const DST = 'espace-destination';
const ECRAN = { id: 'FORM' } as unknown as FlowScreenDef;

function monter(o: { refuser?: string; mediaIllisible?: boolean } = {}) {
  const journal: string[] = [];
  const soumis: CreateTemplateInput[] = [];
  const publies = new Set<string>();
  const champs = new Map<string, string[]>([[DST, []]]);
  let n = 0;
  const client = {
    create: async (waba: string, input: CreateTemplateInput) => {
      if (input.name === o.refuser) throw new MetaApiError(400, { code: 100, message: 'Invalid parameter', error_user_msg: 'Le corps contient une variable mal placée' });
      journal.push(`template:${waba}:${input.name}`);
      soumis.push(input);
      return { id: `tpl-${input.name}`, status: 'PENDING', category: input.category };
    },
  } as unknown as ClientModeles;
  const modeles: DepsGestionModeles = {
    meta: { templateClientForTenant: async () => client },
    repo: { getTenantWabaId: async (t) => `waba-${t}`, listActiveCampaignsForTemplate: async () => [] },
    getPublishedFlow: async (_t, flowId) => publies.has(flowId),
    indices: {
      save: async (t, nom, _l, hints) => { journal.push(`indices:${t}:${nom}:${hints.length}`); },
      get: async () => [], removeByName: async () => undefined,
    },
    champsDeclares: async (t) => champs.get(t) ?? [],
    tracking: {
      allocate: async (tenant, _cible, destination) => { journal.push(`lien:${tenant}:${destination}`); return 'abcdefghjkmn'; },
      liens: { confirm: async () => undefined, deconfirmer: async () => undefined, listByTemplates: async () => [], getByCode: async () => null },
      lienDe: (code, avecJeton) => `https://api.test/r/${code}${avecJeton ? '/{{1}}' : ''}`,
      destinations: async () => new Map(),
    },
  };
  const deps: DepsExecutionMeta = {
    modeles,
    medias: {
      telechargerEntete: async (_f, url) => {
        journal.push(`media:lu:${url}`);
        return o.mediaIllisible ? { refus: 'adresse refusée' } : { octets: Buffer.from('x'), mime: 'image/jpeg' };
      },
      deposerEntete: async (_o, _m, tenant) => { journal.push(`media:depose:${tenant}`); n += 1; return `H-${n}`; },
      placesEntete: { prendre: () => () => undefined },
    },
    flows: {
      client: async () => ({
        create: async (waba: string, input: { name: string }) => { journal.push(`flow:cree:${waba}:${input.name}`); n += 1; return { id: `90${n}`, status: 'DRAFT' }; },
        updateDraft: async () => undefined,
        delete: async (id: string) => { journal.push(`flow:efface:${id}`); },
        publish: async (id: string) => { journal.push(`flow:publie:${id}`); },
      }),
      persistance: {
        create: async (l) => { journal.push(`flow:ligne:${l.tenantId}:${l.name}:${l.champsAAssurer.map((c) => c.key).join(',')}`); },
        update: async () => true,
      },
      marquerPublie: async (id) => { publies.add(id); return true; },
    },
    creerChamp: async (t, def) => {
      champs.set(t, [...(champs.get(t) ?? []), def.key]);
      journal.push(`champ:${t}:${def.key}`);
      return 'created';
    },
  };
  return { deps, journal, soumis };
}

const modele = (over: Partial<TemplateSummary>): TemplateSummary => ({
  id: 'm', name: 'x', status: 'APPROVED', category: 'MARKETING', language: 'fr', body: 'Bonjour', headerFormat: null,
  isCarousel: false, editable: true, ...over,
});

const entree = (over: Partial<EntreeMeta> = {}): EntreeMeta => ({
  copies: {
    flows: [{ id: '111', nomCopie: 'Inscription', publier: true, champsAAssurer: [{ key: 'email_pro', label: 'E-mail', type: 'text' }] }],
    templates: [{ nom: 'accueil', langue: 'fr', flows: ['111'] }, { nom: 'relance', langue: 'fr', flows: [] }],
  },
  champsAvantMeta: [{ key: 'ville', label: 'Ville', type: 'text' }],
  modelesSource: [
    modele({
      name: 'accueil', headerFormat: 'IMAGE', headerMediaUrl: 'https://cdn.source/h.jpg',
      buttons: [{ type: 'URL', text: 'Suivre', url: 'https://site.fr/{ville}' }, { type: 'FLOW', text: 'Remplir', flowId: '111' }],
    }),
    modele({ name: 'relance', body: 'Toujours là ?' }),
  ],
  flowsSource: [{ id: '111', nom: 'Inscription', publie: true, ecrans: [ECRAN], mapping: { email: 'email_pro' }, cta: null }],
  indicesSource: [{ nom: 'accueil', langue: 'fr', indices: [{ position: 1, source: { type: 'field', key: 'prenom' } }] }],
  ...over,
});

describe('executerChezMeta', () => {
  it('dans l’ordre : les champs des adresses, le Flow créé puis publié, puis chaque template, son média redéposé pour la destination', async () => {
    const { deps, journal, soumis } = monter();
    const issue = await executerChezMeta(deps, DST, entree());
    expect(issue.ok).toBe(true);
    expect(journal).toEqual([
      `champ:${DST}:ville`,
      `flow:cree:waba-${DST}:Inscription`,
      `flow:ligne:${DST}:Inscription:email_pro`,
      'flow:publie:901',
      'media:lu:https://cdn.source/h.jpg',
      `media:depose:${DST}`,
      `lien:${DST}:https://site.fr/{ville}`,
      `template:waba-${DST}:accueil`,
      `indices:${DST}:accueil:1`,
      `template:waba-${DST}:relance`,
    ]);
    // Le bouton Flow vise la COPIE ; l'en-tête porte le handle déposé pour la destination ; le lien est un lien neuf.
    expect(soumis[0]!.buttons).toEqual([
      { type: 'URL', text: 'Suivre', url: 'https://api.test/r/abcdefghjkmn/{{1}}' },
      { type: 'FLOW', text: 'Remplir', flowId: '901' },
    ]);
    expect(soumis[0]!.header).toEqual({ format: 'IMAGE', handle: 'H-2' });
    expect(issue.ok && [...issue.flows.entries()]).toEqual([['111', { id: '901', nom: 'Inscription' }]]);
    expect(issue.crees.map((c) => (c.sorte === 'flow' ? `flow ${c.nom} ${c.publie}` : `template ${c.nom} ${c.statut}`))).toEqual([
      'flow Inscription true', 'template accueil PENDING', 'template relance PENDING',
    ]);
    expect(issue.champsCrees).toEqual(['ville', 'email_pro']);
  });

  it('🔴 le lien tracé d’un bouton naît dans la DESTINATION, jamais dans la source', async () => {
    const { deps, journal } = monter();
    await executerChezMeta(deps, DST, entree());
    expect(journal.filter((l) => l.startsWith('lien:'))).toEqual([`lien:${DST}:https://site.fr/{ville}`]);
    expect(journal.some((l) => l.includes(SRC))).toBe(false);
  });

  it('🔴 un refus au second template : on s’arrête, et l’issue liste le Flow et le premier template, laissés chez Meta', async () => {
    const { deps, journal } = monter({ refuser: 'relance' });
    const issue = await executerChezMeta(deps, DST, entree());
    expect(issue.ok).toBe(false);
    expect(!issue.ok && issue.refus).toContain('Le corps contient une variable mal placée');
    expect(issue.crees.map((c) => c.nom)).toEqual(['Inscription', 'accueil']);
    expect(journal.some((l) => l.startsWith('flow:efface'))).toBe(false);
  });

  it('un média illisible arrête AVANT la soumission du template', async () => {
    const { deps, journal } = monter({ mediaIllisible: true });
    const issue = await executerChezMeta(deps, DST, entree());
    expect(!issue.ok && issue.refus).toContain('le template accueil (fr) : son média n’a pas pu être relu');
    expect(journal.some((l) => l.startsWith('template:'))).toBe(false);
  });

  it('un template dont la source ne se lit plus : arrêt, rien de soumis', async () => {
    const { deps, journal } = monter();
    const issue = await executerChezMeta(deps, DST, entree({ modelesSource: [] , copies: { flows: [], templates: [{ nom: 'accueil', langue: 'fr', flows: [] }] } }));
    expect(!issue.ok && issue.refus).toContain('ne se lit plus dans la source');
    expect(journal.some((l) => l.startsWith('template:'))).toBe(false);
  });
});
