import { describe, it, expect } from 'vitest';
import { formulePayee, repriseOuverte } from '../src/offres/formule-payee';

/**
 * CE QUI OUVRE L'OPTION DU CRÉDIT WHATSAPP : une formule payée (révision du 2026-11-04, décisions 1 et 7). Pas pendant
 * un essai, Pro comme Business ; un Pro qui n'a encore rien réglé (son premier prélèvement après l'essai a échoué) non
 * plus.
 */
const MAINTENANT = new Date('2026-11-05T12:00:00Z').getTime();
const AVANT = new Date('2026-11-04T12:00:00Z');
const APRES = new Date('2026-11-06T12:00:00Z');
const pro = (o: { statut?: 'actif' | 'en_retard' | 'resilie'; essaiFinLe?: Date | null; finiLe?: Date | null } = {}) => ({
  statut: o.statut ?? 'actif', essaiFinLe: o.essaiFinLe ?? null, finiLe: o.finiLe ?? null,
});

describe('formulePayee', () => {
  it('🔴 un Pro en essai n’a pas payé ; une résiliation programmée pendant l’essai non plus', () => {
    expect(formulePayee({ offre: 'pro', pro: pro({ essaiFinLe: APRES }), businessEssaiFinLe: null }, MAINTENANT)).toBe(false);
  });

  it('un Pro dont l’essai est fini et le statut actif a payé ; un Pro payé dès le départ aussi', () => {
    expect(formulePayee({ offre: 'pro', pro: pro({ essaiFinLe: AVANT }), businessEssaiFinLe: null }, MAINTENANT)).toBe(true);
    expect(formulePayee({ offre: 'pro', pro: pro(), businessEssaiFinLe: null }, MAINTENANT)).toBe(true);
  });

  it('🔴 un Pro en retard après l’essai (premier prélèvement échoué) n’a rien payé', () => {
    expect(formulePayee({ offre: 'pro', pro: pro({ statut: 'en_retard', essaiFinLe: AVANT }), businessEssaiFinLe: null }, MAINTENANT)).toBe(false);
  });

  it('un Pro fini, résilié ou sans abonnement lu n’ouvre rien', () => {
    expect(formulePayee({ offre: 'pro', pro: pro({ finiLe: AVANT }), businessEssaiFinLe: null }, MAINTENANT)).toBe(false);
    expect(formulePayee({ offre: 'pro', pro: pro({ statut: 'resilie' }), businessEssaiFinLe: null }, MAINTENANT)).toBe(false);
    expect(formulePayee({ offre: 'pro', pro: null, businessEssaiFinLe: null }, MAINTENANT)).toBe(false);
  });

  it('🔴 un Business en essai n’ouvre rien tant que Julien ne l’a pas confirmé, même sa date passée ; confirmé, il ouvre', () => {
    expect(formulePayee({ offre: 'business', pro: null, businessEssaiFinLe: APRES }, MAINTENANT)).toBe(false);
    expect(formulePayee({ offre: 'business', pro: null, businessEssaiFinLe: AVANT }, MAINTENANT)).toBe(false);
    expect(formulePayee({ offre: 'business', pro: null, businessEssaiFinLe: null }, MAINTENANT)).toBe(true);
  });

  it('Free et Entreprise n’ont jamais l’option', () => {
    expect(formulePayee({ offre: 'base', pro: null, businessEssaiFinLe: null }, MAINTENANT)).toBe(false);
    expect(formulePayee({ offre: 'entreprise', pro: pro(), businessEssaiFinLe: null }, MAINTENANT)).toBe(false);
  });
});

/**
 * L'E-MAIL DE L'ARRÊT NE DIT « REPRENEZ L'OPTION » QUE SI LA PRISE L'ACCEPTERAIT (relecture du lot C, jaune 5) : la règle de
 * la prise (`formulePayee`), et un Pro dont la fin programmée n'est pas passée. Les deux fins tombent ensemble (Pro et option
 * résiliés en fin de période) et l'avis de l'option passe le premier : le Pro est encore vivant chez nous.
 */
describe('repriseOuverte', () => {
  const fin = (finPrevueLe: Date | null, o: Parameters<typeof pro>[0] = {}) => ({ ...pro(o), finPrevueLe });

  it('🔴 un Pro payé dont la fin programmée est passée (son avis pas encore traité) : la reprise est fermée', () => {
    expect(repriseOuverte({ offre: 'pro', pro: fin(AVANT), businessEssaiFinLe: null }, MAINTENANT)).toBe(false);
    expect(repriseOuverte({ offre: 'pro', pro: fin(new Date(MAINTENANT)), businessEssaiFinLe: null }, MAINTENANT)).toBe(false);
  });

  it('un Pro payé sans fin programmée, ou dont la fin est à venir, la reprend ; un Business confirmé aussi', () => {
    expect(repriseOuverte({ offre: 'pro', pro: fin(null), businessEssaiFinLe: null }, MAINTENANT)).toBe(true);
    expect(repriseOuverte({ offre: 'pro', pro: fin(APRES), businessEssaiFinLe: null }, MAINTENANT)).toBe(true);
    expect(repriseOuverte({ offre: 'business', pro: null, businessEssaiFinLe: null }, MAINTENANT)).toBe(true);
  });

  it('🔴 ce que la prise refuse, la reprise le refuse : un Pro en retard, en essai, un Business en essai, Free, Entreprise', () => {
    expect(repriseOuverte({ offre: 'pro', pro: fin(null, { statut: 'en_retard', essaiFinLe: AVANT }), businessEssaiFinLe: null }, MAINTENANT)).toBe(false);
    expect(repriseOuverte({ offre: 'pro', pro: fin(null, { essaiFinLe: APRES }), businessEssaiFinLe: null }, MAINTENANT)).toBe(false);
    expect(repriseOuverte({ offre: 'business', pro: null, businessEssaiFinLe: APRES }, MAINTENANT)).toBe(false);
    expect(repriseOuverte({ offre: 'base', pro: null, businessEssaiFinLe: null }, MAINTENANT)).toBe(false);
    expect(repriseOuverte({ offre: 'entreprise', pro: fin(null), businessEssaiFinLe: null }, MAINTENANT)).toBe(false);
  });
});
