import type { Page } from '@playwright/test';

/**
 * L'INSCRIPTION « ADRESSE D'ABORD » (lot identité B, 2026-11-05), pour les e2e qui passent par une adresse CONNUE :
 * l'étape de l'adresse rend 409 `adresse_connue`, puis l'écran déplie le nom du nouvel espace et le mot de passe. Une
 * adresse inconnue, elle, reçoit un lien (`e2e/inscription-lien.spec.ts`).
 */
export const REFUS_ADRESSE_CONNUE = { status: 409, body: { error: 'un compte existe déjà avec cet email', code: 'adresse_connue' } };

/** Le répondeur de `/auth/signup` d'une adresse connue : le 409 de l'étape de l'adresse, puis `ensuite`. */
export function signupAdresseConnue<R>(ensuite: R): () => R | typeof REFUS_ADRESSE_CONNUE {
  let appels = 0;
  return () => (appels++ === 0 ? REFUS_ADRESSE_CONNUE : ensuite);
}

/** L'adresse, « Continuer », puis le nom du nouvel espace, le mot de passe et « Ajouter l'espace ». */
export async function inscrireUneAdresseConnue(page: Page, o: { email: string; motDePasse: string; espace: string }): Promise<void> {
  await page.locator('input[type="email"]').fill(o.email);
  await page.getByRole('button', { name: /^(Continuer|Continue)$/ }).click();
  await page.getByPlaceholder(/Mon entreprise|My company/).fill(o.espace);
  await page.locator('input[type="password"]').fill(o.motDePasse);
  await page.getByRole('button', { name: /Ajouter l’espace|Add the workspace/ }).click();
}
