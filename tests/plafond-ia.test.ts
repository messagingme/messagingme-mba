import { describe, it, expect } from 'vitest';
import { balayerPlafondsIa, type DepsPlafondIa } from '../src/agent/plafond-ia';

/**
 * LE BALAYAGE HORAIRE DES ENTREPRISES (Entreprise illimitée, lot B) : la clé Vercel de chacune remontée, et Julien
 * prévenu à 80 % puis à 100 % de son plafond de sécurité du mois, une fois chacun par espace et par mois. Les marques
 * vivent en base (`alertes_plafond_ia`, sa clé primaire tranche entre deux copies) ; ici, un faux qui s'en souvient.
 */
type Entreprise = Awaited<ReturnType<DepsPlafondIa['acces']['entreprises']>>[number];

function monter(entreprises: Entreprise[], o: { remonter?: DepsPlafondIa['remonterPlafond']; echoue?: string; telegramRefuse?: boolean } = {}) {
  const marques = new Set<string>();
  const messages: string[] = [];
  const remontees: string[] = [];
  const deps: DepsPlafondIa = {
    acces: {
      entreprises: async () => entreprises,
      marquerAlerte: async (tenantId, seuil) => {
        if (tenantId === o.echoue) throw new Error('base indisponible');
        const cle = `${tenantId}:${seuil}`;
        if (marques.has(cle)) return false;
        marques.add(cle);
        return true;
      },
      oublierAlerte: async (tenantId, seuil) => { marques.delete(`${tenantId}:${seuil}`); },
    },
    remonterPlafond: o.remonter === undefined
      ? async (tenantId) => { remontees.push(tenantId); return true; }
      : o.remonter,
    alerter: async (texte) => { if (o.telegramRefuse) return false; messages.push(texte); return true; },
  };
  return { deps, marques, messages, remontees };
}

const entreprise = (tenantId: string, consoEuros: number, plafondEuros = 100): Entreprise => ({
  tenantId, nom: `Espace ${tenantId}`, consommationDuMoisMicroEur: consoEuros * 1_000_000, plafondMicroEur: plafondEuros * 1_000_000,
});

describe('balayerPlafondsIa', () => {
  it('sous 80 % : la clé remonte, aucune alerte', async () => {
    const m = monter([entreprise('a', 79.99)]);
    expect(await balayerPlafondsIa(m.deps)).toEqual({ remontees: 1, alertes: 0 });
    expect(m.remontees).toEqual(['a']);
    expect(m.messages).toEqual([]);
  });

  it('🔴 à 80 % : UNE alerte, que le balayage suivant ne répète pas', async () => {
    const m = monter([entreprise('a', 85)]);
    expect(await balayerPlafondsIa(m.deps)).toEqual({ remontees: 1, alertes: 1 });
    expect(m.messages).toEqual([expect.stringMatching(/^Plafond IA à 85 % : « Espace a » a consommé 85,00 € d'IA sur son plafond du mois \(100,00 €\)/)]);
    expect(await balayerPlafondsIa(m.deps)).toEqual({ remontees: 1, alertes: 0 });
    expect(m.messages).toHaveLength(1);
  });

  it('🔴 à 100 % : l’alerte de l’arrêt, une fois, et le seuil de 80 % marqué sans second message', async () => {
    const m = monter([entreprise('a', 100.02)]);
    expect(await balayerPlafondsIa(m.deps)).toEqual({ remontees: 1, alertes: 1 });
    expect(m.messages).toEqual([expect.stringMatching(/^Plafond IA ATTEINT : .*Ses agents, sa traduction et ses transcriptions sont arrêtés.*\/ops > Offre/)]);
    expect([...m.marques].sort()).toEqual(['a:100', 'a:80']);
    expect(await balayerPlafondsIa(m.deps)).toEqual({ remontees: 1, alertes: 0 });
    expect(m.messages).toHaveLength(1);
  });

  it('80 % puis 100 % dans le mois : deux alertes, une par seuil', async () => {
    const m = monter([entreprise('a', 81)]);
    await balayerPlafondsIa(m.deps);
    m.deps.acces.entreprises = async () => [entreprise('a', 120)];
    await balayerPlafondsIa(m.deps);
    expect(m.messages.map((t) => t.slice(0, 20))).toEqual(['Plafond IA à 81 % : ', 'Plafond IA ATTEINT :']);
  });

  it('🔴 Telegram refuse : la marque est retirée, l’heure suivante retente, puis n’envoie plus', async () => {
    const m = monter([entreprise('a', 90)], { telegramRefuse: true });
    expect(await balayerPlafondsIa(m.deps)).toEqual({ remontees: 1, alertes: 0 });
    expect([...m.marques]).toEqual([]);
    m.deps.alerter = async (texte) => { m.messages.push(texte); return true; };
    expect(await balayerPlafondsIa(m.deps)).toEqual({ remontees: 1, alertes: 1 });
    expect(await balayerPlafondsIa(m.deps)).toEqual({ remontees: 1, alertes: 0 });
    expect(m.messages).toHaveLength(1);
  });

  it('le plafond propre à un espace compte, pas le défaut', async () => {
    const m = monter([entreprise('a', 85, 400)]);
    expect(await balayerPlafondsIa(m.deps)).toEqual({ remontees: 1, alertes: 0 });
  });

  it('provisionnement des clés éteint : aucune remontée, les alertes restent', async () => {
    const m = monter([entreprise('a', 90)], { remonter: null });
    expect(await balayerPlafondsIa(m.deps)).toEqual({ remontees: 0, alertes: 1 });
  });

  it('🔴 un espace en échec n’arrête pas les autres ; le balayage lève ensuite en le nommant', async () => {
    const m = monter([entreprise('a', 90), entreprise('b', 90)], { echoue: 'a' });
    await expect(balayerPlafondsIa(m.deps)).rejects.toThrow(/1 espace\(s\) en échec : a$/);
    expect(m.messages).toEqual([expect.stringContaining('« Espace b »')]);
  });
});
