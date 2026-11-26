import { describe, it, expect, beforeAll } from 'vitest';
import { sansImages, estUneImage } from '../src/lib/sans-images';
import { construireCorps, lireValeurJson, construireParametres } from '../src/agent/requete-http';
import { valeurPourChampJson } from '../src/workflow/appel-http';
import { paramsDuConnecteur } from '../src/agent/requetes';
import { buildServer } from '../src/server';
import { FakeQueue } from './fake-queue';
import { signSession } from '../src/auth/token';
import type { UserAuthStore, EmailIdentity } from '../src/auth/store';
import { requetesInertes } from './routes-inertes';
import { creerTransportConnecteurHttp } from '../src/agent/transport-connecteur-http';

/**
 * Plan 2026-11-26 (essai Everial) : une réponse se range sans ses images, et un champ JSON s'insère tel quel dans le
 * corps d'un appel, pour envoyer `{"validations": [{{recto}}, {{verso}}]}` à `/consolidate` de Wizidee.
 */

const PHOTO = 'data:image/jpeg;base64,' + 'A'.repeat(50);
const BASE64 = 'iVBORw0KGgo' + 'Q'.repeat(2000);

describe('une image n’entre jamais dans une fiche', () => {
  it('reconnaît une data URI d’image et un long base64, pas un texte ni une MRZ', () => {
    expect(estUneImage(PHOTO)).toBe(true);
    expect(estUneImage(BASE64)).toBe(true);
    expect(estUneImage('IDFRADUMAS<<<<<<<<<<<<<<<<<<<<<<<<<<<')).toBe(false);
    expect(estUneImage('x'.repeat(5000) + ' avec des espaces et des mots')).toBe(false);
    expect(estUneImage(42)).toBe(false);
  });

  it('retire les clés et les éléments de liste qui sont des images, garde le reste de l’arbre', () => {
    const rep = {
      status: 'ok', roiThumbnail: PHOTO,
      validation: { documents: [{ label: 'CNI', pages: [{ fields: [
        { name: 'nom', result: { value: { kind: 'string', value: 'DUMAS' } } },
        { name: 'photo', result: { value: { kind: 'image', value: BASE64 } } },
      ] }] }], result: { errors: [{ error: { uri: 'ValidationRulePlugin.CheckPageExistsRequiredError' } }] } },
      vignettes: [PHOTO, 'gardee'],
    };
    expect(sansImages(rep)).toEqual({
      status: 'ok',
      validation: { documents: [{ label: 'CNI', pages: [{ fields: [
        { name: 'nom', result: { value: { kind: 'string', value: 'DUMAS' } } },
        { name: 'photo', result: { value: { kind: 'image' } } },
      ] }] }], result: { errors: [{ error: { uri: 'ValidationRulePlugin.CheckPageExistsRequiredError' } }] } },
      vignettes: ['gardee'],
    });
  });

  it('🔴 la réponse rangée dans un champ JSON ne garde aucune image, et une grosse réponse d’images tient dans le champ', () => {
    const grosse = { status: 'ok', image: 'data:image/png;base64,' + 'B'.repeat(200_000) };
    const v = valeurPourChampJson({ reponse: grosse });
    expect(v).toBe('{"status":"ok"}');
  });
});

describe('une donnée de type JSON', () => {
  it('se relit en objet ; vide ou illisible, elle vaut null', () => {
    expect(lireValeurJson('{"a":1}')).toEqual({ a: 1 });
    expect(lireValeurJson('[1,2]')).toEqual([1, 2]);
    expect(lireValeurJson('')).toBeNull();
    expect(lireValeurJson('pas du json')).toBeNull();
    expect(lireValeurJson(null)).toBeNull();
  });

  it('🔴 seule dans un corps JSON, elle s’insère TELLE QUELLE ; vide, elle disparaît de la liste', () => {
    const gabarit = { mode: 'json' as const, gabarit: '{"validations": ["{{recto}}", "{{verso}}"]}' };
    const recto = { documents: [{ label: 'CNI' }] };
    const deux = construireCorps(gabarit, { recto, verso: { documents: [] } }, new Set(['recto', 'verso']));
    expect(deux.ok && JSON.parse(deux.corps as string)).toEqual({ validations: [recto, { documents: [] }] });
    const une = construireCorps(gabarit, { recto, verso: null }, new Set(['recto', 'verso']));
    expect(une.ok && JSON.parse(une.corps as string)).toEqual({ validations: [recto] });
  });

  it('deux données JSON vides donnent une liste vide ; une donnée non fournie est signalée manquante, jamais retirée', () => {
    const gabarit = { mode: 'json' as const, gabarit: '{"validations": ["{{recto}}", "{{verso}}"]}' };
    const vide = construireCorps(gabarit, { recto: null, verso: null }, new Set(['recto', 'verso']));
    expect(vide.ok && JSON.parse(vide.corps as string)).toEqual({ validations: [] });
    expect(construireCorps(gabarit, { recto: { a: 1 } }, new Set(['recto', 'verso']))).toMatchObject({ ok: false });
  });

  it('⚠️ une variable ordinaire vide garde son null dans une liste, comme avant', () => {
    const r = construireCorps({ mode: 'json', gabarit: '{"l": ["{{a}}", "{{b}}"]}' }, { a: 'x', b: null });
    expect(r.ok && JSON.parse(r.corps as string)).toEqual({ l: ['x', null] });
  });

  it('dans un texte, un objet s’écrit en JSON, jamais « [object Object] »', () => {
    const r = construireCorps({ mode: 'json', gabarit: '{"t": "valeur : {{o}}"}' }, { o: { a: 1 } });
    expect(r.ok && JSON.parse(r.corps as string)).toEqual({ t: 'valeur : {"a":1}' });
    const q = construireParametres([{ cle: 'q', valeur: '{{o}}' }], { o: { a: 1 } });
    expect(q.ok && q.query).toBe('q=%7B%22a%22%3A1%7D');
  });

  it('🔴 n’est jamais annoncée au modèle comme paramètre d’outil', () => {
    expect(paramsDuConnecteur([
      { nom: 'v', type: 'json', origine: { type: 'modele' } },
      { nom: 'ref', type: 'string', origine: { type: 'modele' } },
    ]).map((p) => p.name)).toEqual(['ref']);
  });
});

describe('la route refuse une donnée JSON mal placée', () => {
  const SECRET = 'test-secret';
  const SRC = '22222222-2222-4222-8222-222222222222';
  let tok = '';
  beforeAll(async () => { tok = await signSession({ userId: 'u1', tenantId: 't1', role: 'admin' }, SECRET); });
  const noUsers: UserAuthStore = { findIdentity: async (): Promise<EmailIdentity | null> => null };
  const srv = () => buildServer({ queue: new FakeQueue(), auth: { users: noUsers, secret: SECRET }, agentRequetes: {
    ...requetesInertes,
    requetes: {
      lister: async () => [], parId: async () => null, scenariosQuiUtilisent: async () => [],
      creer: async (_t, input) => ({ ...input, id: 'x', tenantId: 't1', outils: 0, updatedAt: '' }),
      patch: async () => null, supprimer: async () => false,
    },
    sourcePourTest: async () => ({ baseUrl: 'https://api.client.fr', entetes: {}, status: 'active' }),
    clesDeChamps: async () => ['validation_recto'],
    transportHttp: creerTransportConnecteurHttp({ fetch: (async () => new Response('{}')) as unknown as typeof fetch, verifierResolution: async () => ({ ok: true }) }),
  } });
  const poster = async (over: Record<string, unknown>) => srv().inject({
    method: 'POST', url: '/tenants/t1/agent-requetes',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` },
    payload: { sourceId: SRC, label: 'Consolider', methode: 'POST', chemin: '/api/v1/consolidate', outputPaths: [], ...over },
  });
  const v = (origine: unknown) => [{ nom: 'recto', type: 'json', origine }];

  it('acceptée depuis un champ, dans un corps JSON brut', async () => {
    const r = await poster({ variables: v({ type: 'champ', cle: 'validation_recto' }), corps: { mode: 'json', gabarit: '{"validations": ["{{recto}}"]}' } });
    expect(r.statusCode).toBe(201);
  });

  it('🔴 refusée si elle est décidée par l’agent', async () => {
    const r = await poster({ variables: v({ type: 'modele' }), corps: { mode: 'json', gabarit: '{"validations": ["{{recto}}"]}' } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toContain('champ du contact');
  });

  it('refusée hors d’un corps JSON brut (chemin, liste de champs)', async () => {
    const r1 = await poster({ variables: v({ type: 'champ', cle: 'validation_recto' }), chemin: '/x/{recto}', corps: { mode: 'aucun' } });
    expect(r1.statusCode).toBe(400);
    const r2 = await poster({ variables: v({ type: 'champ', cle: 'validation_recto' }), corps: { mode: 'champs', champs: [{ cle: 'v', valeur: '{{recto}}' }] } });
    expect(r2.statusCode).toBe(400);
    expect(r2.json().error).toContain('corps en JSON brut');
  });
});
