import { describe, it, expect } from 'vitest';
import { formulePayee } from '../src/offres/formule-payee';

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
