import { describe, it, expect } from 'vitest';
import { processStatuses } from '../src/webhooks/delivery';
import type { WebhookEvent } from '../src/webhooks/parse';
import { aucunTarif, aucunEchecLibre, aucunAjustementCredit } from './webhook-fixtures';

/**
 * Le rattachement des ACCUSÉS Meta au bloc qui a envoyé le message (« Mes tableaux », mesure « combien lus »).
 *
 * Les statuts Meta ne parlent que d'un identifiant de message : ils ne savent rien des scénarios. Le lien se
 * fait par cet identifiant, qui a été enregistré au moment de l'envoi. C'est la seule façon d'attribuer une
 * lecture à un bloc précis.
 */
const statut = (id: string, status: string, code?: number): WebhookEvent => ({
  source: 'statuses',
  data: { id, status, ...(code ? { errors: [{ code }] } : {}) },
} as unknown as WebhookEvent);

/** Puits de mesure minimal : enregistre ce qui lui est demandé. */
function puits(enEchec = false) {
  const recus: Array<{ id: string; kind: string }> = [];
  return {
    recus,
    sink: {
      recordStatusForMessage: async (metaMessageId: string, kind: 'delivered' | 'read' | 'failed'): Promise<number> => {
        if (enEchec) throw new Error('base indisponible');
        recus.push({ id: metaMessageId, kind });
        return 1;
      },
    },
  };
}

/** Store de livraison minimal : la donnée métier, qui doit continuer à être écrite quoi qu'il arrive. */
function livraison() {
  const majs: Array<{ id: string; status: string }> = [];
  return {
    majs,
    store: {
      updateDeliveryByMessageId: async (messageId: string, status: string): Promise<number> => {
        majs.push({ id: messageId, status });
        return 1;
      },
    },
  };
}

describe('accusés Meta -> mesure par bloc', () => {
  it('🔴 délivré et lu sont rattachés, avec leur identifiant de message', async () => {
    const { majs, store } = livraison();
    const { recus, sink } = puits();
    await processStatuses([statut('wamid.1', 'delivered'), statut('wamid.1', 'read')], store as never, { tarifs: aucunTarif, echecsLibres: aucunEchecLibre, ajustementCredit: aucunAjustementCredit, nodeEvents: sink });
    expect(recus).toEqual([{ id: 'wamid.1', kind: 'delivered' }, { id: 'wamid.1', kind: 'read' }]);
    expect(majs).toHaveLength(2); // la donnée métier est écrite comme avant
  });

  it('🔴 le statut « sent » n’est PAS rattaché : il doublerait chaque envoi', async () => {
    // L'envoi est déjà compté par l'exécuteur au moment où il part. Le recompter ici ferait apparaître deux
    // fois chaque message, et c'est le premier chiffre que l'on regarde dans un tableau.
    const { store } = livraison();
    const { recus, sink } = puits();
    await processStatuses([statut('wamid.1', 'sent')], store as never, { tarifs: aucunTarif, echecsLibres: aucunEchecLibre, ajustementCredit: aucunAjustementCredit, nodeEvents: sink });
    expect(recus).toEqual([]);
  });

  it('un échec est rattaché aussi (un bloc qui échoue est une mesure en soi)', async () => {
    const { store } = livraison();
    const { recus, sink } = puits();
    await processStatuses([statut('wamid.2', 'failed', 131026)], store as never, { tarifs: aucunTarif, echecsLibres: aucunEchecLibre, ajustementCredit: aucunAjustementCredit, nodeEvents: sink });
    expect(recus).toEqual([{ id: 'wamid.2', kind: 'failed' }]);
  });

  it('🔴 une mesure en échec n’empêche PAS la mise à jour de la livraison', async () => {
    // La livraison est la donnée métier ; la mesure est un confort. L'inverse ferait perdre un statut de
    // livraison à cause d'un compteur, ce qui serait un mauvais échange.
    const { majs, store } = livraison();
    const { sink } = puits(true);
    await processStatuses([statut('wamid.3', 'read')], store as never, { tarifs: aucunTarif, echecsLibres: aucunEchecLibre, ajustementCredit: aucunAjustementCredit, nodeEvents: sink });
    expect(majs).toEqual([{ id: 'wamid.3', status: 'read' }]);
  });

  it('sans puits de mesure, le comportement est exactement celui d’avant', async () => {
    const { majs, store } = livraison();
    await processStatuses([statut('wamid.4', 'delivered')], store as never, { tarifs: aucunTarif, echecsLibres: aucunEchecLibre, ajustementCredit: aucunAjustementCredit });
    expect(majs).toEqual([{ id: 'wamid.4', status: 'delivered' }]);
  });
});

/**
 * LOT 5 : L'ÉCHEC DU PREMIER MESSAGE D'UN PARCOURS D'ÉVÉNEMENT LE CLÔT (relecture de 4b). Le parcours naît quand Meta a
 * ACCEPTÉ le template ; un accusé `failed` dit ensuite qu'il n'a pas été livré : le parcours né sur lui ne doit pas garder
 * la place du contact 72 h, et une nouvelle tentative d'envoi doit pouvoir le faire renaître (`premierNonLivre`).
 */
describe('accusés Meta -> le parcours d’événement né sur un message non livré', () => {
  function parcours(enPanne = false) {
    const clos: string[] = [];
    return { clos, sink: { clorePremierNonLivre: async (messageId: string) => { if (enPanne) throw new Error('base indisponible'); clos.push(messageId); return 1; } } };
  }
  const base = { tarifs: aucunTarif, echecsLibres: aucunEchecLibre, ajustementCredit: aucunAjustementCredit };

  it('🔴 un échec de livraison clôt le parcours né sur ce message ; délivré, lu ou envoyé, jamais', async () => {
    const { store } = livraison();
    const p = parcours();
    await processStatuses([statut('wamid.ok', 'sent'), statut('wamid.ok', 'delivered'), statut('wamid.ok', 'read'), statut('wamid.ko', 'failed', 131049)], store as never, { ...base, parcours: p.sink });
    expect(p.clos).toEqual(['wamid.ko']);
  });

  it('🔴 une panne de la clôture n’empêche PAS la mise à jour de la livraison', async () => {
    const { majs, store } = livraison();
    const p = parcours(true);
    await processStatuses([statut('wamid.ko', 'failed', 131026)], store as never, { ...base, parcours: p.sink });
    expect(majs).toEqual([{ id: 'wamid.ko', status: 'failed' }]);
  });
});
