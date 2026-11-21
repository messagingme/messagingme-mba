import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { registerIncidentsDecision, type Decision } from '../src/http/incidents-decision';

const SECRET = 's'.repeat(40);
const JULIEN = '123456789';

function monter(o: { dejaDecide?: boolean } = {}) {
  const app = Fastify();
  const decisions: Array<[number, Decision]> = [];
  const reveils: unknown[] = [];
  const accuses: string[] = [];
  registerIncidentsDecision(app, {
    secret: SECRET,
    auteur: JULIEN,
    incidents: { decider: async (id, d) => { decisions.push([id, d]); return !o.dejaDecide; } },
    declencher: (c) => { reveils.push(c); },
    accuser: async (_id, texte) => { accuses.push(texte); },
  });
  const clic = (data: string, auteur = Number(JULIEN), secret: string | null = SECRET) => app.inject({
    method: 'POST', url: '/internes/telegram/webhook',
    payload: { update_id: 1, callback_query: { id: 'cb1', from: { id: auteur }, data } },
    headers: secret === null ? {} : { 'x-telegram-bot-api-secret-token': secret },
  });
  return { clic, decisions, reveils, accuses };
}

describe('🔴 la décision sur un incident, prise dans Telegram', () => {
  it('🔴 sans le jeton du webhook : 401, rien n’est lu ni décidé', async () => {
    const m = monter();
    for (const s of [null, 'faux', `${SECRET}x`]) expect((await m.clic('incident:42:approuve', Number(JULIEN), s)).statusCode).toBe(401);
    expect(m.decisions).toEqual([]);
    expect(m.reveils).toEqual([]);
  });

  it('le clic de Julien inscrit la décision, réveille la tâche cloud et le confirme', async () => {
    const m = monter();
    expect((await m.clic('incident:42:approuve')).statusCode).toBe(200);
    expect(m.decisions).toEqual([[42, 'approuve']]);
    expect(m.reveils).toEqual([{ type: 'decision', id: 42, decision: 'approuve' }]);
    expect(m.accuses).toEqual(['Incident 42 : approuvé.']);
  });

  it('🔴 le clic de quelqu’un d’autre est ignoré (200, sans rien décider)', async () => {
    const m = monter();
    expect((await m.clic('incident:42:approuve', 987)).statusCode).toBe(200);
    expect(m.decisions).toEqual([]);
    expect(m.reveils).toEqual([]);
  });

  it('🔴 un double clic ne réveille pas deux fois la tâche', async () => {
    const m = monter({ dejaDecide: true });
    await m.clic('incident:42:refuse');
    expect(m.reveils).toEqual([]);
    expect(m.accuses).toEqual(['Incident 42 : déjà décidé, rien de plus.']);
  });

  it('une donnée hors format, ou une mise à jour sans clic : 200, rien', async () => {
    const m = monter();
    for (const d of ['incident:42:deploie', 'autre:1:approuve', 'incident:abc:refuse', '']) expect((await m.clic(d)).statusCode).toBe(200);
    expect(m.decisions).toEqual([]);
  });
});
