import { describe, it, expect, vi } from 'vitest';
import {
  programmerLecture, traiterIssueEvenement, DELAI_LECTURE_MS, LECTURES_MAX, type DepsIssueEvenement, type JobIssue,
} from '../src/mba/issue-evenement';
import { evenementMessageSansSuite, evenementHorsParcours, type EvenementAgent } from '../src/mba/evenement';

/**
 * L'issue d'un `agent_event`, relue après coup, et la relance d'un échec passager de Meta (plan
 * `docs/superpowers/plans/2026-11-10-relance-evenement-agent.md`). Le cas d'origine : MUTAC, 2026-11-10, un
 * `message_sans_suite` accepté puis `failed` sur `internal_server_error`, et un client resté sans réponse.
 */

const T = 'tenant-1';
const PN = 'pn-1';
const WA = '33600000001';
const MAINTENANT = new Date('2026-11-10T11:27:24Z');

function faux(o: {
  statut?: unknown; lireLeve?: boolean; detenteur?: string; client?: string | null; agent?: string | null;
  envoyerLeve?: boolean; programmerLeve?: boolean;
} = {}) {
  const programmes: Array<{ job: JobIssue; quand: Date }> = [];
  const envoyes: EvenementAgent[] = [];
  const deps: DepsIssueEvenement = {
    programmer: vi.fn(async (job: JobIssue, quand: Date) => {
      if (o.programmerLeve) throw new Error('file en panne');
      programmes.push({ job, quand });
    }),
    lireStatut: vi.fn(async () => {
      if (o.lireLeve) throw new Error('404 The agent event could not be found');
      return o.statut ?? { status: 'success' };
    }),
    envoyer: vi.fn(async (_t: string, _pn: string, _wa: string, ev: EvenementAgent) => {
      if (o.envoyerLeve) throw new Error('refus de Meta');
      envoyes.push(ev);
      return { status: 'accepted', agent_event_id: 'evt-2' };
    }),
    inbox: {
      getControlOwner: async () => o.detenteur ?? 'mba',
      dernierMessageDuClient: async () => (o.client === undefined ? 'msg-client-1' : o.client),
      dernierMessageDeLAgent: async () => (o.agent === undefined ? 'msg-agent-1' : o.agent),
    },
    maintenant: () => MAINTENANT,
  };
  return { deps, programmes, envoyes };
}

const EVT = evenementMessageSansSuite('Est ce que il y a de la carence');

function job(o: Partial<JobIssue> = {}): JobIssue {
  return {
    tenantId: T, phoneNumberId: PN, waId: WA, agentEventId: 'evt-1',
    evenement: { type: EVT.type, description: EVT.description, payload: EVT.payload },
    dernierDuClient: 'msg-client-1', dernierDeLAgent: 'msg-agent-1', lecture: 1, renvoi: false, ...o,
  };
}

describe('programmerLecture : après un POST accepté', () => {
  it('programme la lecture 20 s plus tard, avec les deux derniers messages relevés à l’envoi', async () => {
    const { deps, programmes } = faux();
    await programmerLecture(deps, T, PN, WA, EVT, { status: 'accepted', agent_event_id: 'evt-1' });
    expect(programmes).toEqual([{ job: job(), quand: new Date(MAINTENANT.getTime() + DELAI_LECTURE_MS) }]);
  });

  it('ne programme rien pour un événement qui ne porte pas de message du client', async () => {
    const { deps, programmes } = faux();
    await programmerLecture(deps, T, PN, WA, evenementHorsParcours('x'), { status: 'accepted', agent_event_id: 'evt-1' });
    expect(programmes).toEqual([]);
  });

  it('ne programme rien sans identifiant d’événement (rien à relire)', async () => {
    const { deps, programmes } = faux();
    await programmerLecture(deps, T, PN, WA, EVT, { status: 'accepted' });
    expect(programmes).toEqual([]);
  });

  it('🔴 ne lève jamais : une file en panne ne fait pas échouer la remise qui a envoyé l’événement', async () => {
    const { deps } = faux({ programmerLeve: true });
    await expect(programmerLecture(deps, T, PN, WA, EVT, { status: 'accepted', agent_event_id: 'evt-1' })).resolves.toBeUndefined();
  });
});

describe('traiterIssueEvenement : la lecture de l’issue', () => {
  it('🔴 le cas mesuré : failed sur internal_server_error, personne n’a parlé depuis -> renvoyé une fois, et relu', async () => {
    const { deps, programmes, envoyes } = faux({ statut: { status: 'failed', error_message: 'internal_server_error' } });
    await traiterIssueEvenement(deps, job());
    expect(envoyes).toEqual([EVT]);
    expect(deps.envoyer).toHaveBeenCalledWith(T, PN, WA, EVT);
    // Le renvoi est relu, marqué renvoi : son propre échec ne se renverra pas.
    expect(programmes).toEqual([{ job: job({ agentEventId: 'evt-2', renvoi: true }), quand: new Date(MAINTENANT.getTime() + DELAI_LECTURE_MS) }]);
  });

  it('agent_temporarily_unavailable est aussi passagère', async () => {
    const { deps, envoyes } = faux({ statut: { status: 'failed', error_message: 'agent_temporarily_unavailable' } });
    await traiterIssueEvenement(deps, job());
    expect(envoyes).toHaveLength(1);
  });

  it('🔴 un renvoi qui échoue n’est jamais renvoyé', async () => {
    const { deps, envoyes, programmes } = faux({ statut: { status: 'failed', error_message: 'internal_server_error' } });
    await traiterIssueEvenement(deps, job({ renvoi: true }));
    expect(envoyes).toEqual([]);
    expect(programmes).toEqual([]);
  });

  it('une cause qui ne passera pas mieux au second essai ne se renvoie pas', async () => {
    for (const cause of ['consumer_not_in_agent_audience', 'thread_not_owned_by_agent', 'event_content_rejected', 'billing_not_configured', undefined]) {
      const { deps, envoyes } = faux({ statut: { status: 'failed', ...(cause ? { error_message: cause } : {}) } });
      await traiterIssueEvenement(deps, job());
      expect(envoyes, String(cause)).toEqual([]);
    }
  });

  it('🔴 les trois gardes : fil repris, client qui a réécrit, agent qui a parlé -> aucun renvoi', async () => {
    const echec = { status: 'failed', error_message: 'internal_server_error' };
    for (const o of [{ detenteur: 'app_human' }, { detenteur: 'app_workflow' }, { client: 'msg-client-2' }, { agent: 'msg-agent-2' }, { agent: null }]) {
      const { deps, envoyes } = faux({ statut: echec, ...o });
      await traiterIssueEvenement(deps, job());
      expect(envoyes, JSON.stringify(o)).toEqual([]);
    }
  });

  it('une garde qui part de « aucun message » tient aussi : un premier message du client depuis empêche le renvoi', async () => {
    const { deps, envoyes } = faux({ statut: { status: 'failed', error_message: 'internal_server_error' }, client: 'msg-client-1' });
    await traiterIssueEvenement(deps, job({ dernierDuClient: null }));
    expect(envoyes).toEqual([]);
  });

  it('succès, envoi, saut : rien n’est renvoyé ni relu', async () => {
    for (const statut of [{ status: 'success' }, { status: 'sent' }, { status: 'skipped', skipped_reason: 'no_phone_settings' }]) {
      const { deps, envoyes, programmes } = faux({ statut });
      await traiterIssueEvenement(deps, job());
      expect(envoyes).toEqual([]);
      expect(programmes).toEqual([]);
    }
  });

  it('en vol, ou lecture refusée (un 404 juste après le POST) : relu plus tard, trois lectures au plus', async () => {
    for (const o of [{ statut: { status: 'processing' } }, { statut: { status: 'request_received' } }, { lireLeve: true }, { statut: 'pas du json' }]) {
      const { deps, programmes, envoyes } = faux(o);
      await traiterIssueEvenement(deps, job());
      expect(programmes.map((p) => p.job.lecture), JSON.stringify(o)).toEqual([2]);
      expect(envoyes).toEqual([]);
      const fin = faux(o);
      await traiterIssueEvenement(fin.deps, job({ lecture: LECTURES_MAX }));
      expect(fin.programmes).toEqual([]);
    }
  });

  it('un renvoi refusé par Meta ne lève pas (un rejeu du job renverrait une seconde fois)', async () => {
    const { deps } = faux({ statut: { status: 'failed', error_message: 'internal_server_error' }, envoyerLeve: true });
    await expect(traiterIssueEvenement(deps, job())).resolves.toBeUndefined();
  });

  it('un job illisible ne fait rien', async () => {
    const { deps } = faux();
    await traiterIssueEvenement(deps, { tenantId: T });
    expect(deps.lireStatut).not.toHaveBeenCalled();
  });
});
