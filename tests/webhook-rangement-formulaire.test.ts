import { describe, it, expect } from 'vitest';
import { handleWebhookJob, type WebhookJobDeps } from '../src/webhooks/handler';
import type { InboundMessage } from '../src/webhooks/inbound';
import type { RangementParLesParcours } from '../src/webhooks/rangement-par-le-parcours';
import { aucunEspacePlein, agentEteintALArrivee, aucunNumeroDelie, aucuneArriveePub, aucunRoutagePub, aucunSignalReponse, aucuneCorrectionDuDetenteur } from './webhook-fixtures';
import { aucunStop } from './consentement';

/**
 * 🔴 LE CÂBLAGE DU RANGEMENT D'UN FORMULAIRE DANS LE JOB WEBHOOK (relecture du 2026-11-10). Les deux moitiés sont
 * testées seules (`rangement-par-le-parcours`, `flow-mapping`) ; ce qui reste à garder, c'est leur ORDRE et leur
 * LIAISON dans `handleWebhookJob` : le bloc en attente range d'abord, sur la réponse COMPLÈTE, et le réglage du
 * formulaire saute ce qu'il a rangé. Sans ce test, un `new Map()` à la place du résultat, ou l'appel retiré, laissait
 * toute la suite verte.
 */
const REPONSE = { _ref: 'R', nom: 'Marc', mail: 'a@b.fr', flow_token: '33611-1~f1' };
const payload = {
  entry: [{ id: 'waba1', changes: [{ field: 'messages', value: {
    metadata: { phone_number_id: 'pn1' },
    contacts: [{ wa_id: '33611', profile: { name: 'Marc' } }],
    messages: [{
      id: 'wamid.f1', from: '33611', type: 'interactive', timestamp: '1790000000',
      interactive: { type: 'nfm_reply', nfm_reply: { name: 'flow', response_json: JSON.stringify(REPONSE) } },
    }],
  } }] }],
};

function monter(parcours: RangementParLesParcours) {
  const ecritures: Array<Record<string, unknown>> = [];
  const deps: WebhookJobDeps = {
    store: { insertEvent: async () => true },
    inbox: {
      phoneNumberTenant: async () => 't1',
      recordInbound: async (_t: string, _m: InboundMessage) => ({ rouverte: false }),
    },
    numerosDelies: aucunNumeroDelie,
    espacesPleins: aucunEspacePlein,
    inboundOptOut: aucunStop, detenteur: aucuneCorrectionDuDetenteur, listeALArrivee: agentEteintALArrivee,
    arriveesPub: aucuneArriveePub, routagePub: aucunRoutagePub, signalReponse: aucunSignalReponse,
    flowMapping: {
      lookup: { findByRef: async () => ({ tenantId: 't1', mapping: { nom: 'prenom', mail: 'email' }, fieldTypes: {}, optinFieldKeys: [] }) },
      writer: {
        mergeFieldsByPhone: async (_t, _w, values) => { ecritures.push(values); },
        markOptedIn: async () => null,
        setProfileNameByPhone: async () => {},
      },
      parcours,
    },
  };
  return { deps, ecritures };
}

describe('handleWebhookJob : le rangement d’un formulaire par le bloc en attente', () => {
  it('🔴 le bloc range d’abord, sur la réponse complète, et le formulaire saute ce qu’il a rangé', async () => {
    const recus: Array<{ t: string; w: string; reponse: Record<string, unknown> }> = [];
    const { deps, ecritures } = monter({
      ranger: async (t, w, reponse) => { recus.push({ t, w, reponse }); return new Set(['nom']); },
    });
    await handleWebhookJob(payload, deps);
    expect(recus).toEqual([{ t: 't1', w: '33611', reponse: REPONSE }]);
    expect(ecritures).toEqual([{ email: 'a@b.fr' }]);
  });

  it('un bloc qui ne range rien laisse tout au réglage du formulaire, comme avant', async () => {
    const { deps, ecritures } = monter({ ranger: async () => new Set<string>() });
    await handleWebhookJob(payload, deps);
    expect(ecritures).toEqual([{ prenom: 'Marc', email: 'a@b.fr' }]);
  });

  it('une panne du rangement par le bloc laisse tout au formulaire, sans faire échouer le job', async () => {
    const { deps, ecritures } = monter({ ranger: async () => { throw new Error('base'); } });
    await expect(handleWebhookJob(payload, deps)).resolves.toBeUndefined();
    expect(ecritures).toEqual([{ prenom: 'Marc', email: 'a@b.fr' }]);
  });
});
