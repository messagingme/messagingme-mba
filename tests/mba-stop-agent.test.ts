import { describe, it, expect } from 'vitest';
import { CONSIGNE_STOP, poserConsigneStop, type ClientConsigneStop } from '../src/mba/consigne-stop';
import { DELAI_RETRAIT_STOP_MS, creerOptOutEntrant, traiterRetraitStop, type JobRetraitStop } from '../src/mba/retrait-stop';
import { ecrireRollout, type Skill } from '../src/mba/client';

/**
 * 🔴 UN STOP FAIT TAIRE L'AGENT DE META (2026-11-26, plan `docs/superpowers/plans/2026-11-26-stop-agent-de-meta.md`).
 * Vécu chez MUTAC : un contact désabonné chez nous s'est vu proposer un conseiller par l'agent, qui reçoit les messages
 * libres en direct. Deux parades, gardées ici : la consigne STOP posée à chaque allumage, et le retrait de la liste de
 * l'agent 2 minutes après le STOP (le temps que l'agent confirme).
 */

/** Un faux client qui note ses appels ; `listSkills` rend `consignes`, ou lève si c'est une erreur. */
function client(consignes: unknown | Error = []) {
  const appels: string[] = [];
  const crees: Skill[] = [];
  const c: ClientConsigneStop = {
    listSkills: async (pn, agentId) => {
      appels.push(`list ${pn} ${agentId}`);
      if (consignes instanceof Error) throw consignes;
      return consignes as Skill[];
    },
    createSkill: async (pn, agentId, skill) => { appels.push(`create ${pn} ${agentId}`); crees.push(skill); return {}; },
  };
  return { c, appels, crees };
}

describe('poserConsigneStop', () => {
  it('pose la consigne quand l’agent n’en a aucune de ce titre, sous l’agent_id donné', async () => {
    const f = client([{ title: 'ton-et-style', description: 'd', skill: 's' }]);
    expect(await poserConsigneStop(f.c, 'PN1', 'a1')).toBe('posee');
    expect(f.appels).toEqual(['list PN1 a1', 'create PN1 a1']);
    expect(f.crees).toEqual([CONSIGNE_STOP]);
  });

  it('ne réécrit jamais une consigne déjà là, celle du client comprise (titre insensible à la casse)', async () => {
    const f = client([{ title: ' Arret-Des-Messages ', description: 'à ma façon', skill: 'mon texte' }]);
    expect(await poserConsigneStop(f.c, 'PN1', 'a1')).toBe('deja_la');
    expect(f.appels).toEqual(['list PN1 a1']);
  });

  it('sans agent_id : aucun appel (Meta écrirait sous d’autres réglages)', async () => {
    const f = client();
    expect(await poserConsigneStop(f.c, 'PN1', undefined)).toBe('sans_agent');
    expect(f.appels).toEqual([]);
  });

  it('🔴 une liste illisible ne crée rien, et rien ne lève', async () => {
    const illisible = client({ data: [] });
    expect(await poserConsigneStop(illisible.c, 'PN1', 'a1')).toBe('echec');
    expect(illisible.crees).toEqual([]);
    const enPanne = client(new Error('500'));
    expect(await poserConsigneStop(enPanne.c, 'PN1', 'a1')).toBe('echec');
    expect(enPanne.crees).toEqual([]);
  });

  it('un refus de Meta à la création ne lève pas', async () => {
    const f = client();
    f.c.createSkill = async () => { throw new Error('400'); };
    expect(await poserConsigneStop(f.c, 'PN1', 'a1')).toBe('echec');
  });

  it('la consigne tient dans les bornes de la console (titre, description, corps)', () => {
    expect(CONSIGNE_STOP.title).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(CONSIGNE_STOP.description.length).toBeLessThanOrEqual(1024);
    expect(CONSIGNE_STOP.skill).toContain('Votre demande de ne plus recevoir de messages sur WhatsApp est bien prise en compte.');
  });
});

describe('ecrireRollout pose la consigne STOP', () => {
  /** Réglages relus chez Meta, puis les écritures, notés dans l'ordre avec les consignes. */
  function reglages(o: { audienceRelue?: string; consignes?: unknown } = {}) {
    const appels: string[] = [];
    const f = client(o.consignes ?? []);
    const c = {
      getSettings: async () => { appels.push('getSettings'); return { agent_id: 'a1', ai_audience: o.audienceRelue ?? 'ALLOWLISTED_ONLY' }; },
      putSettings: async (_pn: string, corps: Record<string, unknown>) => {
        appels.push(`putSettings ${JSON.stringify(corps.rollout ?? null)}`);
        return {};
      },
      listSkills: async (pn: string, agentId: string) => { appels.push('listSkills'); return f.c.listSkills(pn, agentId); },
      createSkill: async (pn: string, agentId: string, s: Skill) => { appels.push(`createSkill ${agentId}`); return f.c.createSkill(pn, agentId, s); },
    };
    return { c, appels };
  }
  const sansDormir = { attendre: async () => {} };

  it('🔴 APRÈS le PUT qui allume, sous l’agent_id relu', async () => {
    const r = reglages();
    await ecrireRollout(r.c, 'PN1', true, sansDormir);
    const allumage = r.appels.findIndex((a) => a.includes('"enabled":true'));
    expect(allumage).toBeGreaterThan(-1);
    expect(r.appels.slice(allumage + 1)).toEqual(['listSkills', 'createSkill a1']);
  });

  it('jamais à l’extinction, ni sur un allumage refusé', async () => {
    const eteint = reglages();
    await ecrireRollout(eteint.c, 'PN1', false, sansDormir);
    expect(eteint.appels.filter((a) => a.includes('Skill'))).toEqual([]);
    const refuse = reglages({ audienceRelue: 'EVERYONE' });
    await expect(ecrireRollout(refuse.c, 'PN1', true, sansDormir)).rejects.toThrow(/audience/);
    expect(refuse.appels.filter((a) => a.includes('Skill'))).toEqual([]);
  });

  it('un échec de la consigne ne fait pas échouer l’allumage', async () => {
    const r = reglages({ consignes: new Error('Meta en panne') });
    await expect(ecrireRollout(r.c, 'PN1', true, sansDormir)).resolves.toBeDefined();
  });
});

describe('creerOptOutEntrant : le STOP, puis le retrait programmé', () => {
  function deps(o: { surLaListe?: boolean; lectureEnPanne?: boolean; programmeEnPanne?: boolean } = {}) {
    const ordre: string[] = [];
    const programmes: Array<{ job: JobRetraitStop; quand: Date }> = [];
    const optOut = creerOptOutEntrant({
      desabonner: async (t, w, m) => { ordre.push(`desabonner ${t} ${w} ${m}`); return 'contact-1'; },
      liste: {
        presents: async (_t, waIds) => {
          ordre.push('presents');
          if (o.lectureEnPanne) throw new Error('base');
          return new Set(o.surLaListe ? waIds : []);
        },
      },
      programmer: async (job, quand) => {
        ordre.push('programmer');
        if (o.programmeEnPanne) throw new Error('file');
        programmes.push({ job, quand });
      },
      now: () => 1_000_000,
    });
    return { optOut, ordre, programmes };
  }

  it('🔴 la fiche d’abord, puis le retrait 2 minutes après, pour un contact sur la liste', async () => {
    const d = deps({ surLaListe: true });
    expect(await d.optOut('t1', '33611', 'wamid.1')).toBe('contact-1');
    expect(d.ordre).toEqual(['desabonner t1 33611 wamid.1', 'presents', 'programmer']);
    expect(d.programmes).toEqual([{ job: { tenantId: 't1', waId: '33611' }, quand: new Date(1_000_000 + DELAI_RETRAIT_STOP_MS) }]);
    expect(DELAI_RETRAIT_STOP_MS).toBe(120_000);
  });

  it('un contact absent de la liste : aucun job', async () => {
    const d = deps({ surLaListe: false });
    await d.optOut('t1', '33611', 'wamid.1');
    expect(d.programmes).toEqual([]);
  });

  it('🔴 une panne de la liste ou de la file ne fait jamais échouer le désabonnement', async () => {
    for (const o of [{ lectureEnPanne: true }, { surLaListe: true, programmeEnPanne: true }]) {
      const d = deps(o);
      await expect(d.optOut('t1', '33611', 'wamid.1')).resolves.toBe('contact-1');
    }
  });

  it('une panne de l’écriture de la fiche remonte (processInbound la journalise), sans programmer de retrait', async () => {
    const programmes: unknown[] = [];
    const optOut = creerOptOutEntrant({
      desabonner: async () => { throw new Error('base'); },
      liste: { presents: async () => new Set(['33611']) },
      programmer: async (job) => { programmes.push(job); },
      now: () => 0,
    });
    await expect(optOut('t1', '33611', 'wamid.1')).rejects.toThrow('base');
    expect(programmes).toEqual([]);
  });
});

describe('traiterRetraitStop', () => {
  it('retire le contact du job', async () => {
    const retires: string[] = [];
    await traiterRetraitStop({ retirer: async (t, w) => { retires.push(`${t} ${w}`); return true; } }, { tenantId: 't1', waId: '33611' });
    expect(retires).toEqual(['t1 33611']);
  });

  it('un job illisible est ignoré sans appel', async () => {
    const retires: string[] = [];
    await traiterRetraitStop({ retirer: async (t, w) => { retires.push(`${t} ${w}`); return true; } }, { tenantId: '', waId: 3 });
    expect(retires).toEqual([]);
  });

  it('une panne de notre table remonte : le job se rejoue', async () => {
    await expect(traiterRetraitStop({ retirer: async () => { throw new Error('base'); } }, { tenantId: 't1', waId: '33611' }))
      .rejects.toThrow('base');
  });
});
