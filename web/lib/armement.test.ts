import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { DELAI_ARMEMENT_MS, suivreArmement, type EnvironnementArmement } from './armement';

/**
 * L'armement du bouton de consentement (passage 2 de l'audit, 2026-11-17) : le second appui d'un double-clic piégé
 * tombe quelques dizaines de millisecondes après le retour du focus sur la page, et doit trouver le bouton désarmé.
 */
function monde(visible = true, focus = true) {
  const fenetre = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: visible ? 'visible' : 'hidden', hasFocus: () => focus });
  const etats: boolean[] = [];
  const env: EnvironnementArmement = { fenetre, document: doc };
  const arreter = suivreArmement(env, (a) => etats.push(a));
  return {
    etats,
    arreter,
    dernier: () => etats.at(-1),
    perdreLeFocus: () => { focus = false; fenetre.dispatchEvent(new Event('blur')); },
    reprendreLeFocus: () => { focus = true; fenetre.dispatchEvent(new Event('focus')); },
    cacher: () => { doc.visibilityState = 'hidden'; doc.dispatchEvent(new Event('visibilitychange')); },
    montrer: () => { doc.visibilityState = 'visible'; doc.dispatchEvent(new Event('visibilitychange')); },
  };
}

describe('l’armement du bouton qui accorde un accès', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('désarmé au départ, armé après la demi-seconde de page visible et active', () => {
    const m = monde();
    expect(m.dernier()).toBe(false);
    vi.advanceTimersByTime(DELAI_ARMEMENT_MS - 1);
    expect(m.dernier()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(m.dernier()).toBe(true);
  });

  it('🔴 le double-clic piégé : perte du focus, retour, et le second appui 100 ms plus tard trouve le bouton désarmé', () => {
    const m = monde();
    vi.advanceTimersByTime(DELAI_ARMEMENT_MS);
    expect(m.dernier()).toBe(true);
    m.perdreLeFocus();
    expect(m.dernier()).toBe(false);
    m.reprendreLeFocus();
    vi.advanceTimersByTime(100);
    expect(m.dernier()).toBe(false);
    vi.advanceTimersByTime(DELAI_ARMEMENT_MS - 100);
    expect(m.dernier()).toBe(true);
  });

  it('🔴 une page chargée en arrière-plan (sans le focus) ne s’arme pas, même longtemps après', () => {
    const m = monde(true, false);
    vi.advanceTimersByTime(10 * DELAI_ARMEMENT_MS);
    expect(m.etats).toEqual([false]);
    m.reprendreLeFocus();
    vi.advanceTimersByTime(DELAI_ARMEMENT_MS);
    expect(m.dernier()).toBe(true);
  });

  it('une page cachée se désarme, et repart de zéro quand elle revient', () => {
    const m = monde();
    vi.advanceTimersByTime(DELAI_ARMEMENT_MS);
    m.cacher();
    expect(m.dernier()).toBe(false);
    m.montrer();
    vi.advanceTimersByTime(DELAI_ARMEMENT_MS - 1);
    expect(m.dernier()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(m.dernier()).toBe(true);
  });

  it('arrêté, le suivi n’écoute plus rien et ne s’arme plus', () => {
    const m = monde();
    m.arreter();
    vi.advanceTimersByTime(10 * DELAI_ARMEMENT_MS);
    m.reprendreLeFocus();
    vi.advanceTimersByTime(10 * DELAI_ARMEMENT_MS);
    expect(m.etats).toEqual([false]);
  });
});
