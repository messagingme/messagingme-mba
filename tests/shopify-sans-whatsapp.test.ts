import { describe, it, expect } from 'vitest';
import { traiterSansWhatsapp, type DepsSansWhatsapp } from '../src/shopify/sans-whatsapp';
import { processStatuses } from '../src/webhooks/delivery';
import type { WebhookEvent } from '../src/webhooks/parse';
import type { LigneDeLaListe } from '../src/mba/liste';
import { aucunTarif, aucunEchecLibre, aucunAjustementCredit } from './webhook-fixtures';

/**
 * LA FICHE NÉE D'UN ENVOI SHOPIFY, SUPPRIMÉE AU PREMIER 131026 (segments Shopify enrichis, lot 2a ; décision de Julien du
 * 2026-11-23). Ici : le job (la garde décide, la purge efface, le retrait chez Meta suit) et le puits de l'accusé (seul
 * un `failed` 131026 enfile, en dernier). Les gardes elles-mêmes sont une requête : leur preuve est en intégration
 * (`tests/integration/sans-whatsapp.integration.test.ts`).
 */

const LIGNE: LigneDeLaListe = { contactId: 'c1' } as unknown as LigneDeLaListe;

/**
 * Le magasin des contacts en CLASSE dont la méthode lit `this` : un câblage qui détacherait `purgeMany` de son objet
 * casserait ici comme il casserait avec le vrai magasin (règle des méthodes de store injectées).
 */
class Contacts {
  readonly purges: Array<{ tenantId: string; ids: readonly string[] }> = [];
  constructor(private readonly leve = false) {}
  async purgeMany(tenantId: string, ids: readonly string[]): Promise<{ listeAgent: LigneDeLaListe[] }> {
    if (this.leve) throw new Error('base en panne');
    this.purges.push({ tenantId, ids });
    return { listeAgent: [LIGNE] };
  }
}

function monter(o: { fiche?: { tenantId: string; contactId: string } | null; purgeLeve?: boolean; metaLeve?: boolean } = {}) {
  const ordre: string[] = [];
  const contacts = new Contacts(o.purgeLeve === true);
  const gardes: string[] = [];
  const deps: DepsSansWhatsapp = {
    ficheASupprimer: async (messageId) => { gardes.push(messageId); return o.fiche === undefined ? { tenantId: 't1', contactId: 'c1' } : o.fiche; },
    contacts,
    listeDeLAgent: {
      oublierChezMeta: async (tenantId, lignes) => {
        ordre.push(`meta:${tenantId}:${lignes.length}`);
        if (o.metaLeve) throw new Error('Meta en panne');
      },
    },
  };
  return { deps, contacts, gardes, ordre };
}

describe('le job : la garde décide, la purge efface', () => {
  it('🔴 une fiche que la garde rend est purgée DANS son espace, puis retirée chez l’agent de Meta', async () => {
    const m = monter();
    await traiterSansWhatsapp(m.deps, { messageId: 'wamid.1' });
    expect(m.gardes).toEqual(['wamid.1']);
    expect(m.contacts.purges).toEqual([{ tenantId: 't1', ids: ['c1'] }]);
    expect(m.ordre).toEqual(['meta:t1:1']);
  });

  it('🔴 la garde ne rend rien (fiche importée, qui a écrit, avec repli, sortie d’échec prise…) : rien n’est effacé', async () => {
    const m = monter({ fiche: null });
    await traiterSansWhatsapp(m.deps, { messageId: 'wamid.1' });
    expect(m.contacts.purges).toEqual([]);
    expect(m.ordre).toEqual([]);
  });

  it('un job illisible est jeté sans lever ni rien lire', async () => {
    const m = monter();
    for (const data of [null, {}, { messageId: '' }, { messageId: 42 }, 'wamid.1']) await traiterSansWhatsapp(m.deps, data);
    expect(m.gardes).toEqual([]);
    expect(m.contacts.purges).toEqual([]);
  });

  it('🔴 une purge en panne LÈVE (pg-boss rejoue le job), et rien ne part chez Meta', async () => {
    const m = monter({ purgeLeve: true });
    await expect(traiterSansWhatsapp(m.deps, { messageId: 'wamid.1' })).rejects.toThrow('base en panne');
    expect(m.ordre).toEqual([]);
  });

  it('un retrait chez Meta en panne ne lève pas : la fiche est déjà effacée, le rejeu ne trouverait plus rien', async () => {
    const m = monter({ metaLeve: true });
    await expect(traiterSansWhatsapp(m.deps, { messageId: 'wamid.1' })).resolves.toBeUndefined();
    expect(m.contacts.purges).toHaveLength(1);
  });
});

describe('le puits de l’accusé : seul un échec 131026 enfile, en dernier', () => {
  const statut = (id: string, status: string, code?: number): WebhookEvent => ({
    source: 'statuses',
    dedupKey: `st:${id}:${status}`,
    data: { id, status, ...(code === undefined ? {} : { errors: [{ code, title: 'erreur' }] }) },
  } as unknown as WebhookEvent);

  it('🔴 `failed` 131026 enfile APRÈS la livraison et la sortie d’échec ; ni un autre code, ni un autre statut', async () => {
    const ordre: string[] = [];
    await processStatuses(
      [
        statut('wamid.A', 'failed', 131026), statut('wamid.B', 'failed', 131049), statut('wamid.C', 'failed'),
        statut('wamid.D', 'delivered'), statut('wamid.E', 'sent', 131026),
      ],
      { updateDeliveryByMessageId: async (id: string) => { ordre.push(`livraison:${id}`); return 1; } } as never,
      {
        tarifs: aucunTarif, echecsLibres: aucunEchecLibre, ajustementCredit: aucunAjustementCredit,
        livraisonTemplates: { surAccuse: async (id) => { ordre.push(`sortie:${id}`); } },
        sansWhatsapp: { surEchec: async (id) => { ordre.push(`enfile:${id}`); } },
      },
    );
    expect(ordre.filter((x) => x.startsWith('enfile:'))).toEqual(['enfile:wamid.A']);
    expect(ordre.slice(0, 3)).toEqual(['sortie:wamid.A', 'livraison:wamid.A', 'enfile:wamid.A']);
  });

  it('un enfilement en panne ne coûte rien aux accusés suivants', async () => {
    const livres: string[] = [];
    await processStatuses(
      [statut('wamid.A', 'failed', 131026), statut('wamid.B', 'delivered')],
      { updateDeliveryByMessageId: async (id: string) => { livres.push(id); return 1; } } as never,
      {
        tarifs: aucunTarif, echecsLibres: aucunEchecLibre, ajustementCredit: aucunAjustementCredit,
        sansWhatsapp: { surEchec: async () => { throw new Error('file en panne'); } },
      },
    );
    expect(livres).toEqual(['wamid.A', 'wamid.B']);
  });
});
