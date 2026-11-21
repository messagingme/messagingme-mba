import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerIncidentsRapport, jetonValide, texteRapport, type Rapport } from '../src/http/incidents-rapport';
import { creerDeclencheur } from '../src/ops/incidents-declencheur';

const JETON = 'j'.repeat(40);
const vider = () => new Promise((r) => setTimeout(r, 0));

function monter(o: { deja?: boolean } = {}) {
  const app = Fastify();
  const inscrits: Array<[number, Rapport]> = [];
  const envoyes: Array<{ texte: string; boutons?: ReadonlyArray<{ texte: string; donnee: string }> }> = [];
  registerIncidentsRapport(app, {
    token: JETON,
    incidents: { rapporter: async (id, r) => { inscrits.push([id, r]); return o.deja ? null : { signal: 'entrants' }; } },
    envoyer: async (texte, boutons) => { envoyes.push({ texte, boutons }); return true; },
  });
  const poster = (corps: unknown, jeton: string | null = JETON, id = '42') => app.inject({
    method: 'POST', url: `/internes/incidents/${id}/rapport`, payload: corps as object,
    headers: jeton === null ? {} : { authorization: `Bearer ${jeton}` },
  });
  return { poster, inscrits, envoyes };
}

const RAPPORT_2 = { categorie: 'plomberie', issue: 2, rapport: 'vingt jobs de 0 s attendaient 539 s', action: 'vider la file en continu', fichier: 'incidents/2026-11-21-1033-push-analysis.md' };

describe('🔴 le rapport de la tâche cloud sur un incident', () => {
  it('🔴 sans le bon jeton : 401, et ni la base ni Telegram ne sont touchés', async () => {
    const m = monter();
    for (const jeton of [null, 'faux', `${JETON}x`, JETON.slice(1)]) {
      expect((await m.poster(RAPPORT_2, jeton)).statusCode, String(jeton)).toBe(401);
    }
    expect(m.inscrits).toEqual([]);
    expect(m.envoyes).toEqual([]);
  });

  it('une issue 2 s’inscrit et part sur Telegram avec les trois boutons de décision', async () => {
    const m = monter();
    const r = await m.poster(RAPPORT_2);
    expect(r.statusCode).toBe(200);
    expect(m.inscrits).toEqual([[42, RAPPORT_2]]);
    expect(m.envoyes[0]!.texte).toContain('Incident 42 (entrants) : plomberie, issue 2');
    expect(m.envoyes[0]!.boutons?.map((b) => b.donnee)).toEqual(['incident:42:approuve', 'incident:42:refuse', 'incident:42:plus_tard']);
  });

  it('une autre issue part sans bouton', async () => {
    const m = monter();
    expect((await m.poster({ categorie: 'faux_positif', issue: 1, rapport: 'rien n’a attendu' })).statusCode).toBe(200);
    expect(m.envoyes[0]!.boutons).toBeUndefined();
  });

  it('un rapport invalide est refusé (catégorie hors liste, issue 2 sans action, champ inconnu, fichier hors du dépôt)', async () => {
    const m = monter();
    for (const corps of [
      { ...RAPPORT_2, categorie: 'autre' },
      { categorie: 'plomberie', issue: 2, rapport: 'x' },
      { ...RAPPORT_2, deploie: true },
      { ...RAPPORT_2, fichier: '../secret.md' },
      { ...RAPPORT_2, issue: 5 },
    ]) expect((await m.poster(corps)).statusCode, JSON.stringify(corps)).toBe(400);
    expect((await m.poster(RAPPORT_2, JETON, 'abc')).statusCode).toBe(400);
    expect(m.envoyes).toEqual([]);
  });

  it('🔴 un rejeu, ou un incident inconnu : 409, et aucun second message', async () => {
    const m = monter({ deja: true });
    expect((await m.poster(RAPPORT_2)).statusCode).toBe(409);
    expect(m.envoyes).toEqual([]);
  });

  it('le jeton se compare entier, préfixe compris', () => {
    expect(jetonValide(`Bearer ${JETON}`, JETON)).toBe(true);
    expect(jetonValide(JETON, JETON)).toBe(false);
    expect(jetonValide('Bearer ', '')).toBe(false);
    expect(texteRapport(1, 's', { categorie: 'base', issue: 4, rapport: 'r' })).toBe('Incident 1 (s) : base, issue 4, problème d’archi ou de performance, à toi d’agir.\n\nr');
  });
});

describe('🔴 le réveil de la tâche cloud', () => {
  it('non configuré, il ne fait rien', async () => {
    let appels = 0;
    creerDeclencheur({ url: '', token: '', fetch: (async () => { appels++; return new Response(); }) as typeof fetch })({ id: 1 });
    await vider();
    expect(appels).toBe(0);
  });

  it('🔴 un seul appel, jeton en en-tête, la charge en texte ; un échec ne remonte pas et n’est pas rejoué', async () => {
    const appels: Array<{ url: string; init: RequestInit }> = [];
    const f = (async (url: string, init: RequestInit) => { appels.push({ url, init }); throw new Error('réseau'); }) as unknown as typeof fetch;
    const declencher = creerDeclencheur({ url: 'https://api.anthropic.com/v1/claude_code/routines/trig_1/fire', token: 'tok', fetch: f });
    expect(() => declencher({ type: 'incident', id: 7 })).not.toThrow();
    await vider();
    expect(appels).toHaveLength(1);
    expect((appels[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(JSON.parse(JSON.parse(appels[0]!.init.body as string).text)).toEqual({ type: 'incident', id: 7 });
  });
});
