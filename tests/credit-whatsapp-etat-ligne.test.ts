import { describe, it, expect } from 'vitest';
import { arretDesLignes, etatLigneCredit, lireEtatLigne, type DepsEtatLigne, type SourcesEtatLigne } from '../src/credit-whatsapp/etat-ligne';
import { creditPaieMeta } from '../web/lib/partage/credit-whatsapp';

/**
 * L'ÉTAT DU CRÉDIT WHATSAPP D'UN ESPACE, VU DES CARTES « QUI RÈGLE META ? » (révision du 2026-11-04, lot B, B1) : la
 * console de Connecter WhatsApp et de l'Accueil, et `get_setup_state`, le lisent ici, jamais recalculé ailleurs.
 */
function deps(o: {
  offre?: 'base' | 'pro' | 'business' | 'entreprise'; payee?: boolean;
  lignes?: Array<{ arreteeLe: Date | null }>; option?: { places: number; statut: 'actif' | 'en_retard' | 'resilie' } | null;
  attendLigne?: boolean;
} = {}): DepsEtatLigne {
  return {
    offre: async () => o.offre ?? 'pro',
    formulePayee: async () => o.payee ?? true,
    lignes: async () => o.lignes ?? [],
    option: async () => (o.option === undefined ? null : o.option),
    numeroAttendSaLigne: async () => o.attendLigne ?? false,
  };
}

describe('creditPaieMeta (jaunes 2 et 3 de la relecture du lot B)', () => {
  it('🔴 la ligne active, ou l’option payée qui attend sa ligne, pour un numéro qui ne garde pas l’application ; sinon la carte chez Meta', () => {
    expect(creditPaieMeta('active', false)).toBe(true);
    expect(creditPaieMeta('en_attente', false)).toBe(true);
    // Qui garde l'application reste sur sa carte chez Meta (décision 8) : la ligne ne le couvrira jamais.
    expect(creditPaieMeta('en_attente', true)).toBe(false);
    expect(creditPaieMeta('active', true)).toBe(false);
    for (const etat of ['free', 'essai', 'a_prendre', 'arretee', undefined, null]) expect(creditPaieMeta(etat, false), String(etat)).toBe(false);
  });
});

describe('arretDesLignes (lot C, moment 3)', () => {
  const ARRET = '2026-11-06T09:00:00Z';
  it('🔴 toutes arrêtées, et par l’option dès qu’une ligne en vient ; une ligne vivante, ou aucune ligne, rien n’est arrêté', () => {
    expect(arretDesLignes([])).toEqual({ toutes: false, parLOption: false });
    expect(arretDesLignes([{ origine: 'option', arreteeLe: ARRET }])).toEqual({ toutes: true, parLOption: true });
    expect(arretDesLignes([{ origine: 'option', arreteeLe: ARRET }, { origine: 'ops', arreteeLe: new Date(ARRET) }])).toEqual({ toutes: true, parLOption: true });
    expect(arretDesLignes([{ origine: 'ops', arreteeLe: ARRET }])).toEqual({ toutes: true, parLOption: false });
    expect(arretDesLignes([{ origine: 'option', arreteeLe: ARRET }, { origine: 'option', arreteeLe: null }])).toEqual({ toutes: false, parLOption: false });
  });
});

describe('etatLigneCredit', () => {
  it('🔴 une option payée sur une formule qui ne l’est plus (un Pro passé en retard) se lit en attente de sa ligne, jamais en essai (jaune 5 du lot B)', async () => {
    expect(await etatLigneCredit(deps({ payee: false, option: { places: 1, statut: 'actif' } }), 't1')).toBe('en_attente');
    expect(await etatLigneCredit(deps({ payee: false, option: { places: 1, statut: 'en_retard' } }), 't1')).toBe('en_attente');
    // Résiliée, elle ne compte plus : la formule non payée reste un essai.
    expect(await etatLigneCredit(deps({ payee: false, option: { places: 1, statut: 'resilie' } }), 't1')).toBe('essai');
  });

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
      // Un numéro arrivé par la fenêtre du partenaire : l'Entreprise attend sa ligne (relecture du lot E, jaune 4), puis la
      // ligne posée dit l'état ; la marque ne change rien hors Entreprise (l'option y dit déjà l'attente).
      [{ offre: 'entreprise', payee: false, attendLigne: true }, 'en_attente'],
      [{ offre: 'entreprise', payee: false, attendLigne: true, lignes: [{ arreteeLe: null }] }, 'active'],
      [{ offre: 'pro', attendLigne: true }, 'a_prendre'],
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

describe('lireEtatLigne (les sources de la console et de Claude)', () => {
  function sources(numeros: ReadonlyArray<{ attendLigne: boolean }>): SourcesEtatLigne {
    return {
      option: { offre: async () => 'entreprise', formulePayee: async () => false, options: { vivante: async () => null } },
      vue: { lignes: async () => [], numeros: async () => numeros.map((n) => ({ coexistence: false, delie: false, ...n })) },
    };
  }

  it('🔴 une Entreprise dont un numéro est arrivé par la fenêtre du partenaire attend sa ligne : la carte ne dit plus « sur demande » (relecture du lot E, jaune 4)', async () => {
    expect(await lireEtatLigne(sources([{ attendLigne: false }, { attendLigne: true }]), 't1')).toBe('en_attente');
    expect(await lireEtatLigne(sources([{ attendLigne: false }]), 't1')).toBe('a_prendre');
    expect(await lireEtatLigne(sources([]), 't1')).toBe('a_prendre');
  });

  it('🔴 `attendLigne` est REQUIS : une source qui ne le rend pas ne compile plus, au lieu d’éteindre l’attente en silence (relecture du lot E5, jaune 4)', () => {
    // Le cas qu'exerçait `sources([{}])` (un numéro sans le champ lu « n'attend pas ») est désormais refusé par le
    // compilateur : rendu facultatif, cette directive deviendrait inutile et `tsc` échouerait.
    // @ts-expect-error `attendLigne` manque
    const sansAttente: SourcesEtatLigne['vue']['numeros'] = async () => [{ coexistence: false, delie: false }];
    expect(typeof sansAttente).toBe('function');
  });
});
