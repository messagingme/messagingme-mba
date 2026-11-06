import { describe, it, expect } from 'vitest';
import { etatLigneCredit, type DepsEtatLigne } from '../src/credit-whatsapp/etat-ligne';

/**
 * L'ÉTAT DU CRÉDIT WHATSAPP D'UN ESPACE, VU DES CARTES « QUI RÈGLE META ? » (révision du 2026-11-04, lot B, B1) : la
 * console de Connecter WhatsApp et de l'Accueil, et `get_setup_state`, le lisent ici, jamais recalculé ailleurs.
 */
function deps(o: {
  offre?: 'base' | 'pro' | 'business' | 'entreprise'; payee?: boolean;
  lignes?: Array<{ arreteeLe: Date | null }>; option?: { places: number; statut: 'actif' | 'en_retard' | 'resilie' } | null;
} = {}): DepsEtatLigne {
  return {
    offre: async () => o.offre ?? 'pro',
    formulePayee: async () => o.payee ?? true,
    lignes: async () => o.lignes ?? [],
    option: async () => (o.option === undefined ? null : o.option),
  };
}

describe('etatLigneCredit', () => {
  it('🔴 chaque état depuis ses données : Free, essai, à prendre, en attente, active, arrêtée', async () => {
    const ARRETEE = new Date('2026-11-01T00:00:00Z');
    const cas: Array<[Parameters<typeof deps>[0], string]> = [
      [{ offre: 'base' }, 'free'],
      [{ offre: 'pro', payee: false }, 'essai'],
      [{ offre: 'business', payee: false }, 'essai'],
      [{ offre: 'pro' }, 'a_prendre'],
      [{ offre: 'pro', option: { places: 0, statut: 'actif' } }, 'a_prendre'],
      [{ offre: 'pro', option: { places: 1, statut: 'resilie' } }, 'a_prendre'],
      [{ offre: 'pro', option: { places: 2, statut: 'actif' } }, 'en_attente'],
      [{ offre: 'business', option: { places: 1, statut: 'en_retard' } }, 'en_attente'],
      [{ offre: 'pro', lignes: [{ arreteeLe: null }] }, 'active'],
      [{ offre: 'pro', lignes: [{ arreteeLe: ARRETEE }, { arreteeLe: null }] }, 'active'],
      [{ offre: 'pro', lignes: [{ arreteeLe: ARRETEE }] }, 'arretee'],
      // Une Entreprise : la ligne se pose sur demande dans /ops, jamais par l'option ; illimitée une fois posée.
      [{ offre: 'entreprise', payee: false }, 'a_prendre'],
      [{ offre: 'entreprise', payee: false, lignes: [{ arreteeLe: null }] }, 'active'],
    ];
    for (const [o, attendu] of cas) expect(await etatLigneCredit(deps(o), 't1'), JSON.stringify(o)).toBe(attendu);
  });

  it('🔴 une ligne posée l’emporte sur l’essai et sur la Free n’en a jamais : la Free ne lit rien d’autre', async () => {
    let lus = 0;
    const d: DepsEtatLigne = { ...deps({ offre: 'base' }), lignes: async () => { lus += 1; return [{ arreteeLe: null }]; } };
    expect(await etatLigneCredit(d, 't1')).toBe('free');
    expect(lus).toBe(0);
    expect(await etatLigneCredit(deps({ offre: 'pro', payee: false, lignes: [{ arreteeLe: null }] }), 't1')).toBe('active');
  });
});
