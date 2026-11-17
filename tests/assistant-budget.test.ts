import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  MESSAGE_PLAFOND, moisDe, resteDuBudget, RESERVATION_MICRO_EUR, reserverBudget, solderReservation,
} from '../src/assistant/budget';
import { DepensesMemoire, budgetEnMemoire } from './aide/depenses';

/**
 * LE PLAFOND DE CE QUE NOUS DÉPENSONS pour les assistants de configuration.
 *
 * 🔴 IL EXISTE PARCE QUE LE PAYEUR A CHANGÉ (2026-09-14). Sur le crédit prépayé du client, un bavardage se
 * payait tout seul ; sur notre clé maison, rien ne le borne. Les deux moitiés de cette décision vont
 * ensemble, et l'une sans l'autre est dangereuse.
 */
describe('le plafond de l’assistant', () => {
  it('compte par mois CALENDAIRE, pas sur trente jours glissants', () => {
    expect(moisDe(new Date('2026-09-30T23:59:59Z'))).toBe('2026-09-01');
    expect(moisDe(new Date('2026-10-01T00:00:00Z'))).toBe('2026-10-01');
    // ⚠️ En UTC, et le cas qui le prouve est un 1er du mois juste après minuit à Paris (donc encore la
    // veille en UTC) : un décompte en heure locale ferait basculer le mois au mauvais moment.
    expect(moisDe(new Date('2026-10-01T00:30:00+02:00'))).toBe('2026-09-01');
  });

  it('🔴 0 DÉSACTIVE le plafond : c’est le levier d’urgence', () => {
    // Un mauvais calibrage couperait l'assistant de tous les clients, et un `--force-recreate` va plus vite
    // qu'un déploiement de code. Même convention que les limiteurs de débit de ce dépôt.
    expect(resteDuBudget(9_999_999_999, 0)).toBe(Infinity);
  });

  it('rend ce qui reste, et jamais un nombre négatif', () => {
    expect(resteDuBudget(500_000, 2)).toBe(1_500_000);
    expect(resteDuBudget(2_000_000, 2)).toBe(0);
    // Un dépassement est possible : le dernier tour est autorisé puis noté avec son coût réel.
    expect(resteDuBudget(2_500_000, 2)).toBe(0);
  });

  it('🔴 le dernier tour passe, le suivant non', () => {
    // ⚠️ ON AUTORISE SUR CE QUI RESTE, PAS SUR UNE ESTIMATION : le coût réel n'est connu qu'APRÈS l'appel.
    // Le dépassement est donc borné par le coût d'un tour, ce qui est assumé.
    // Les routes laissent partir le tour quand ce qui reste est STRICTEMENT positif.
    expect(resteDuBudget(1_999_999, 2)).toBeGreaterThan(0);
    expect(resteDuBudget(2_000_000, 2)).toBe(0);
  });

  it('⚠️ une dépense négative ou absurde ne crédite personne', () => {
    expect(resteDuBudget(-1_000_000, 2)).toBe(2_000_000);
  });

  it('le message du plafond dit la limite ET que les onglets restent', () => {
    // Un message d'indisponibilité générique ferait passer une limite VOLONTAIRE pour une panne ; taire les
    // onglets laisserait croire que tout est bloqué.
    expect(MESSAGE_PLAFOND).toMatch(/mois prochain/i);
    expect(MESSAGE_PLAFOND).toMatch(/onglets/i);
  });
});

/**
 * 🔴 RÉSERVER AVANT L'APPEL, SOLDER APRÈS (passage 2 de l'audit, 2026-11-16). Lire le compteur puis noter la dépense
 * une fois la réponse rendue laissait passer tous les appels arrivés avant la première réponse : mesuré, vingt tours
 * simultanés au lieu d'un. La concurrence réelle se prouve en base (`tests/integration/assistant-depense`) ; ici, la
 * règle de calcul et ce que voient les routes.
 */
describe('la réservation de l’enveloppe', () => {
  it('sous le plafond : une borne haute est réservée, puis remplacée par le coût réel', async () => {
    const depenses = new DepensesMemoire(100_000);
    const deps = budgetEnMemoire(depenses);
    const r = await reserverBudget(deps, 't1');
    expect(r).toEqual({ mois: moisDe(new Date()), microEuros: RESERVATION_MICRO_EUR });
    expect(depenses.total).toBe(100_000 + RESERVATION_MICRO_EUR);
    await solderReservation(deps, 't1', r!, 0.0092);
    expect(depenses.total).toBe(100_000 + 9_200);
  });

  it('🔴 au plafond : rien n’est réservé, l’appel ne part pas', async () => {
    const depenses = new DepensesMemoire(2_000_000);
    expect(await reserverBudget(budgetEnMemoire(depenses), 't1')).toBeNull();
    expect(depenses.mouvements).toEqual([]);
  });

  it('🔴 un appel qui lève rend sa réservation : solder à zéro ramène le compteur où il était', async () => {
    const depenses = new DepensesMemoire(300_000);
    const deps = budgetEnMemoire(depenses);
    await solderReservation(deps, 't1', (await reserverBudget(deps, 't1'))!, 0);
    expect(depenses.total).toBe(300_000);
  });

  it('🔴 vingt appels simultanés à un micro-euro du plafond : un seul part', async () => {
    const depenses = new DepensesMemoire(1_999_999);
    const deps = budgetEnMemoire(depenses);
    const reservations = await Promise.all(Array.from({ length: 20 }, () => reserverBudget(deps, 't1')));
    expect(reservations.filter((r) => r !== null)).toHaveLength(1);
  });

  it('🔴 plafond à 0 (levier d’urgence) : jamais refusé, réservation nulle, et la dépense réelle reste comptée', async () => {
    const depenses = new DepensesMemoire(9_000_000);
    const deps = { ...budgetEnMemoire(depenses), plafondEuros: 0 };
    const r = await reserverBudget(deps, 't1');
    expect(r).toEqual({ mois: moisDe(new Date()), microEuros: 0 });
    await solderReservation(deps, 't1', r!, 0.001);
    expect(depenses.total).toBe(9_001_000);
  });

  it('⚠️ le solde se fait sur le mois de la RÉSERVATION, même si l’appel finit le mois suivant', async () => {
    const vus: string[] = [];
    const deps = budgetEnMemoire({ lire: async () => 0, reserver: async () => true, ajouter: async (_t, mois) => { vus.push(mois); } });
    await solderReservation(deps, 't1', { mois: '2026-10-01', microEuros: RESERVATION_MICRO_EUR }, 0.001);
    expect(vus).toEqual(['2026-10-01']);
  });
});

/**
 * 🔴 LA GARDE QUE LE FAUX CÂBLAGE NE PEUT PAS DONNER : qui PAIE l'assistant.
 *
 * Les deux clients ont la même signature, et un appel facturé au client marche parfaitement. Le seul moyen
 * de voir l'erreur est de lire le câblage réel.
 */
describe('le vrai câblage : c’est NOUS qui payons l’assistant', () => {
  const src = readFileSync(resolve(__dirname, '../src/index.ts'), 'utf8');
  const bloc = src.slice(src.indexOf('agentSetup: {'), src.indexOf('agentTest: {'));

  it('🔴 passe par la clé maison, jamais par le résolveur de clé par espace', () => {
    expect(bloc).toContain('gatewayAide.completer');
    // Le `[^e]` écarte `gatewayAide.completer` lui-même : c'est `gateway.completer` qu'on refuse ici.
    expect(bloc).not.toMatch(/[^e]gateway\.completer/);
  });

  it('🔴 et ne passe AUCUN espace payeur', () => {
    // Y remettre le tenant refacturerait le client sans que rien ne le signale : `gatewayAide` est construit
    // sans résolveur, donc la valeur n'est jamais lue pour choisir une clé.
    expect(bloc).toContain('AUCUN_ESPACE_PAYEUR');
  });
});
