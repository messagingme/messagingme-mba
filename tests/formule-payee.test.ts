import { describe, it, expect } from 'vitest';
import { formuleEnRetard, formuleEtPrise, formulePayee, optionPrenable, repriseOuverte } from '../src/offres/formule-payee';

/**
 * LA FORMULE PAYÉE (`formulePayee`) : ce que l'onglet du Crédit WhatsApp en dit (`option.formulePayee`). Pas pendant un
 * essai, Pro comme Business ; un Pro qui n'a encore rien réglé (son premier prélèvement après l'essai a échoué) non plus.
 * Elle n'ouvre pas l'option : c'est `optionPrenable` (V1 du plan du 2026-11-10), plus bas.
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
 * LA RÈGLE DE LA PRISE DE L'OPTION (décisions de Julien du 2026-11-10, plan `2026-11-10-credit-whatsapp-vente-libre-service.md`,
 * V1) : l'option se prend et se paie dès le début de l'essai Pro de 14 jours, même quand l'arrêt de la formule est déjà
 * programmé ; un Business attend la confirmation de Julien, comme avant ; un Pro en retard de prélèvement, jamais.
 */
describe('optionPrenable', () => {
  const fin = (finPrevueLe: Date | null, o: Parameters<typeof pro>[0] = {}) => ({ ...pro(o), finPrevueLe });

  it('🔴 un Pro en essai la prend, sa fin programmée ou non ; un Pro payé aussi', () => {
    expect(optionPrenable({ offre: 'pro', pro: fin(null, { essaiFinLe: APRES }), businessEssaiFinLe: null }, MAINTENANT)).toBe(true);
    // L'arrêt de la formule déjà programmé à la fin de l'essai (AskUserQuestion du 2026-11-10 : « L'accepter »).
    expect(optionPrenable({ offre: 'pro', pro: fin(APRES, { essaiFinLe: APRES }), businessEssaiFinLe: null }, MAINTENANT)).toBe(true);
    expect(optionPrenable({ offre: 'pro', pro: fin(null, { essaiFinLe: AVANT }), businessEssaiFinLe: null }, MAINTENANT)).toBe(true);
    expect(optionPrenable({ offre: 'pro', pro: fin(null), businessEssaiFinLe: null }, MAINTENANT)).toBe(true);
  });

  it('🔴 un Pro en retard de prélèvement, fini, résilié ou sans abonnement lu, jamais', () => {
    expect(optionPrenable({ offre: 'pro', pro: fin(null, { statut: 'en_retard', essaiFinLe: AVANT }), businessEssaiFinLe: null }, MAINTENANT)).toBe(false);
    expect(optionPrenable({ offre: 'pro', pro: fin(null, { finiLe: AVANT }), businessEssaiFinLe: null }, MAINTENANT)).toBe(false);
    expect(optionPrenable({ offre: 'pro', pro: fin(null, { statut: 'resilie' }), businessEssaiFinLe: null }, MAINTENANT)).toBe(false);
    expect(optionPrenable({ offre: 'pro', pro: null, businessEssaiFinLe: null }, MAINTENANT)).toBe(false);
  });

  it('🔴 un Business en essai attend la confirmation de Julien (AskUserQuestion du 2026-11-10) ; confirmé, il la prend', () => {
    expect(optionPrenable({ offre: 'business', pro: null, businessEssaiFinLe: APRES }, MAINTENANT)).toBe(false);
    expect(optionPrenable({ offre: 'business', pro: null, businessEssaiFinLe: AVANT }, MAINTENANT)).toBe(false);
    expect(optionPrenable({ offre: 'business', pro: null, businessEssaiFinLe: null }, MAINTENANT)).toBe(true);
  });

  it('Free et Entreprise, jamais', () => {
    expect(optionPrenable({ offre: 'base', pro: null, businessEssaiFinLe: null }, MAINTENANT)).toBe(false);
    expect(optionPrenable({ offre: 'entreprise', pro: fin(null), businessEssaiFinLe: null }, MAINTENANT)).toBe(false);
  });
});

/**
 * L'E-MAIL DE L'ARRÊT NE DIT « REPRENEZ L'OPTION » QUE SI LA PRISE L'ACCEPTERAIT (relecture du lot C, jaune 5) : la règle de
 * la prise (`optionPrenable`), et un Pro dont la fin programmée n'est pas passée. Les deux fins tombent ensemble (Pro et option
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

  it('🔴 ce que la prise refuse, la reprise le refuse : un Pro en retard, un Business en essai, Free, Entreprise', () => {
    expect(repriseOuverte({ offre: 'pro', pro: fin(null, { statut: 'en_retard', essaiFinLe: AVANT }), businessEssaiFinLe: null }, MAINTENANT)).toBe(false);
    expect(repriseOuverte({ offre: 'business', pro: null, businessEssaiFinLe: APRES }, MAINTENANT)).toBe(false);
    expect(repriseOuverte({ offre: 'base', pro: null, businessEssaiFinLe: null }, MAINTENANT)).toBe(false);
    expect(repriseOuverte({ offre: 'entreprise', pro: fin(null), businessEssaiFinLe: null }, MAINTENANT)).toBe(false);
  });

  it('🔴 ce que la prise accepte, la reprise l’accepte : un Pro en essai la reprend, sauf si sa fin programmée est passée (V1 du plan du 2026-11-10)', () => {
    expect(repriseOuverte({ offre: 'pro', pro: fin(null, { essaiFinLe: APRES }), businessEssaiFinLe: null }, MAINTENANT)).toBe(true);
    expect(repriseOuverte({ offre: 'pro', pro: fin(APRES, { essaiFinLe: APRES }), businessEssaiFinLe: null }, MAINTENANT)).toBe(true);
    expect(repriseOuverte({ offre: 'pro', pro: fin(AVANT, { essaiFinLe: APRES }), businessEssaiFinLe: null }, MAINTENANT)).toBe(false);
  });
});

/**
 * UNE FORMULE PRO EN RETARD DE PAIEMENT (relecture du lot C5, jaune 7) : elle n'est pas payée, mais ce n'est pas un essai.
 * Le refus de la prise dit la vraie raison.
 */
describe('formuleEnRetard', () => {
  it('🔴 un Pro vivant en retard de paiement ; jamais un essai, un Pro payé ou fini, ni une autre offre', () => {
    expect(formuleEnRetard({ offre: 'pro', pro: pro({ statut: 'en_retard', essaiFinLe: AVANT }), businessEssaiFinLe: null })).toBe(true);
    expect(formuleEnRetard({ offre: 'pro', pro: pro({ essaiFinLe: APRES }), businessEssaiFinLe: null })).toBe(false);
    expect(formuleEnRetard({ offre: 'pro', pro: pro(), businessEssaiFinLe: null })).toBe(false);
    expect(formuleEnRetard({ offre: 'pro', pro: pro({ statut: 'en_retard', finiLe: AVANT }), businessEssaiFinLe: null })).toBe(false);
    expect(formuleEnRetard({ offre: 'business', pro: pro({ statut: 'en_retard' }), businessEssaiFinLe: APRES })).toBe(false);
    expect(formuleEnRetard({ offre: 'pro', pro: null, businessEssaiFinLe: null })).toBe(false);
  });
});

/**
 * CE QUE L'ONGLET DIT DE LA FORMULE, EN UNE LECTURE (relecture de V1, jaune 5) : la formule payée et la prise possible,
 * tirées du même instantané par les deux règles elles-mêmes.
 */
describe('formuleEtPrise', () => {
  it('🔴 les deux règles sur le même instantané : un Pro en essai prend l’option sans avoir payé ; un Business en essai ni l’un ni l’autre', () => {
    const fin = { finPrevueLe: null };
    expect(formuleEtPrise({ offre: 'pro', pro: { ...pro({ essaiFinLe: APRES }), ...fin }, businessEssaiFinLe: null }, MAINTENANT))
      .toEqual({ formulePayee: false, prisePossible: true });
    expect(formuleEtPrise({ offre: 'pro', pro: { ...pro({ essaiFinLe: AVANT }), ...fin }, businessEssaiFinLe: null }, MAINTENANT))
      .toEqual({ formulePayee: true, prisePossible: true });
    expect(formuleEtPrise({ offre: 'pro', pro: { ...pro({ statut: 'en_retard', essaiFinLe: AVANT }), ...fin }, businessEssaiFinLe: null }, MAINTENANT))
      .toEqual({ formulePayee: false, prisePossible: false });
    expect(formuleEtPrise({ offre: 'business', pro: null, businessEssaiFinLe: APRES }, MAINTENANT))
      .toEqual({ formulePayee: false, prisePossible: false });
    expect(formuleEtPrise({ offre: 'business', pro: null, businessEssaiFinLe: null }, MAINTENANT))
      .toEqual({ formulePayee: true, prisePossible: true });
    expect(formuleEtPrise({ offre: 'entreprise', pro: null, businessEssaiFinLe: null }, MAINTENANT))
      .toEqual({ formulePayee: false, prisePossible: false });
  });
});
