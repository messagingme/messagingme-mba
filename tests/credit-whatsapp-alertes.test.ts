import { describe, it, expect, vi } from 'vitest';
import { creerAlertesCreditWhatsapp, SEUIL_CREDIT_WHATSAPP_BAS_MICRO_EUR } from '../src/emails-produit/alertes';
import { CATALOGUE } from '../src/emails-produit/catalogue';

/**
 * LES E-MAILS DU CRÉDIT WHATSAPP (plan du Crédit WhatsApp, tâche 11) : le solde passé sous 10 €, une fois par crédit reçu ;
 * un refus faute de solde, une fois par jour dans le fuseau de l'espace. Le dédoublonnage est la réservation de l'occasion
 * en base (`emettre`) : ici, l'occasion choisie.
 */
type Emis = { cle: string; occasion: string; valeurs: Record<string, string> };

function monter(o: { dernier?: string | null; echoue?: boolean } = {}) {
  const emis: Emis[] = [];
  const a = creerAlertesCreditWhatsapp({
    emettre: async (e) => {
      if (o.echoue) throw new Error('base indisponible');
      emis.push({ cle: e.cle, occasion: e.occasion, valeurs: e.valeurs as Record<string, string> });
      return 'reserve' as never;
    },
    dernierCreditRecu: async () => (o.dernier === undefined ? 'mvt-42' : o.dernier),
    fuseau: async () => 'Europe/Paris',
    pageOnglet: 'https://console.exemple/offre?tab=whatsapp',
    now: () => new Date('2026-10-31T23:30:00Z'),
  });
  return { a, emis };
}

describe('les e-mails du Crédit WhatsApp', () => {
  it('🔴 le débit qui FRANCHIT 10 € alerte, avec le dernier crédit reçu pour occasion ; au-dessus ou déjà dessous, rien', async () => {
    const { a, emis } = monter();
    await a.surDebit('t1', 12_000_000, 11_000_000);
    await a.surDebit('t1', 9_000_000, 8_000_000);
    expect(emis).toEqual([]);
    await a.surDebit('t1', SEUIL_CREDIT_WHATSAPP_BAS_MICRO_EUR, 9_925_240);
    expect(emis).toEqual([{
      cle: 'credit_whatsapp_bas', occasion: 'recharge:mvt-42',
      valeurs: { solde: '9925240', lien_credit_whatsapp: 'https://console.exemple/offre?tab=whatsapp' },
    }]);
  });

  it('jamais crédité : une occasion stable (« aucun »), et un solde négatif se dit à zéro', async () => {
    const { a, emis } = monter({ dernier: null });
    await a.surDebit('t1', 10_500_000, -200_000);
    expect(emis[0]).toMatchObject({ occasion: 'recharge:aucun', valeurs: { solde: '0' } });
  });

  it('🔴 l’épuisement : une occasion par JOUR, dans le fuseau de l’espace (23 h 30 UTC = le lendemain à Paris)', async () => {
    const { a, emis } = monter();
    await a.surEpuise('t1');
    expect(emis).toEqual([{ cle: 'credit_whatsapp_epuise', occasion: 'jour:2026-11-01', valeurs: { lien_credit_whatsapp: 'https://console.exemple/offre?tab=whatsapp' } }]);
  });

  it('une alerte qui échoue ne lève jamais : l’envoi qu’elle accompagne n’en souffre pas', async () => {
    const erreurs = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { a } = monter({ echoue: true });
      await expect(a.surDebit('t1', 10_000_000, 9_000_000)).resolves.toBeUndefined();
      await expect(a.surEpuise('t1')).resolves.toBeUndefined();
    } finally {
      erreurs.mockRestore();
    }
  });

  it('🔴 leurs textes, en français et en anglais, citent leurs variables, et jamais le partenaire ni une commission', () => {
    for (const cle of ['credit_whatsapp_bas', 'credit_whatsapp_epuise']) {
      const m = CATALOGUE.find((x) => x.cle === cle)!;
      expect(m, cle).toBeDefined();
      for (const langue of ['fr', 'en'] as const) {
        const t = m.textes[langue];
        const tout = `${t.sujet}\n${t.corps}\n${t.bouton?.libelle ?? ''}`;
        expect(tout, `${cle} ${langue}`).not.toMatch(/partenaire|partner|commission/i);
        expect(t.bouton?.lien).toBe('{{lien_credit_whatsapp}}');
      }
    }
  });
});
