import { test, expect, type Page } from './aide/test';
import { repondre } from './aide/confirmation';

/**
 * LE RÉPONDEUR VU DE LA PAGE DES AGENTS (lot 5, puis RC6).
 *
 * Depuis RC6, « qui répond au client » se règle à UN endroit, l'Accueil (`accueil-qui-repond.spec.ts`) : le bloc
 * « Répondeur de l'espace » de cette page a laissé sa place à une phrase et un lien. Ce qui reste vrai ici : désactiver
 * l'agent qui répond au client le dit avant (revue du plan du lot 5, cas 3), et un refus n'envoie rien.
 */
const SESSION = { token: 'e2e-token', email: 'admin@e2e.test', role: 'admin', tenantId: 't-e2e' };

const AGENTS = [
  { id: 'ag-lea', label: 'Léa', status: 'active', sorties: [], modele: 'anthropic/claude-haiku-4.5' },
  { id: 'ag-brouillon', label: 'Brouillon Paul', status: 'draft', sorties: [], modele: '' },
];
const FICHE = {
  id: 'ag-lea', label: 'Léa', status: 'active', mentionIa: 'Vous échangez avec un assistant automatique.', modele: 'anthropic/claude-haiku-4.5',
  maxTours: 8, maxAppelsOutils: 12, budgetMicroEur: 30000, inactiviteMinutes: 30, contactInconnu: 'lecture_seule',
  contenu: { nom: '', objectif: '', ton: '', personnalite: '', reglesTransfert: '', sorties: [] }, ficheVersion: 1,
};

/** Le serveur, avec son état : désactiver l'agent qui répond le retire de ce rôle (`oublierRepondeur`). */
async function monter(page: Page, o: { repondeurAgentId?: string | null; credit?: Record<string, unknown> } = {}) {
  await page.addInitScript((s) => window.localStorage.setItem('mba.session', JSON.stringify(s)), SESSION);
  const etat = { repondeurAgentId: o.repondeurAgentId ?? null, statut: FICHE.status };
  const patches: Array<Record<string, unknown>> = [];
  const gestesRepondeur: string[] = [];
  await page.route('**/api/backend/**', async (route) => {
    const req = route.request();
    const chemin = new URL(req.url()).pathname.replace('/api/backend', '');
    const json = (b: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (chemin.endsWith('/repondeur')) gestesRepondeur.push(`${req.method()} ${chemin}`);
    if (req.method() === 'PATCH' && chemin.endsWith('/agents/ag-lea')) {
      const patch = (req.postDataJSON() ?? {}) as Record<string, unknown>;
      patches.push(patch);
      if (typeof patch.status === 'string') {
        etat.statut = patch.status;
        if (patch.status !== 'active' && etat.repondeurAgentId === 'ag-lea') etat.repondeurAgentId = null;
      }
      return json({ agent: { ...FICHE, status: etat.statut } });
    }
    if (chemin.endsWith('/agents/ag-lea')) return json({ agent: { ...FICHE, status: etat.statut } });
    if (chemin.endsWith('/agents/solde')) return json(o.credit ?? { soldeMicroEur: 5_000_000 });
    if (chemin.endsWith('/agents')) {
      return json({ agents: AGENTS.map((a) => (a.id === 'ag-lea' ? { ...a, status: etat.statut } : a)), repondeurAgentId: etat.repondeurAgentId });
    }
    if (chemin.endsWith('/settings')) return json({ mbaEnabled: false });
    if (chemin.endsWith('/me')) return json({ email: 'admin@e2e.test', name: 'Jean Test', role: 'admin' });
    return json({});
  });
  return { patches, etat, gestesRepondeur };
}

test.describe('Agents IA : qui répond au client se règle sur l’Accueil', () => {
  test('🔴 RC6 : plus de choix du répondeur ici, une phrase et le lien vers l’Accueil ; la page ne lit ni n’écrit le réglage', async ({ page }) => {
    const { gestesRepondeur } = await monter(page);
    await page.goto('/agents');
    // Ancre positive : la liste est chargée.
    await expect(page.getByTestId('agent-ligne-ag-lea')).toBeVisible();
    await expect(page.getByTestId('agents-lien-qui-repond')).toHaveAttribute('href', '/accueil');
    await expect(page.getByRole('combobox', { name: 'Agent IA répondeur' })).toHaveCount(0);
    expect(gestesRepondeur).toEqual([]);
  });

  test('🔴 désactiver l’agent qui répond au client le dit avant : un refus n’envoie rien, l’accord le désactive', async ({ page }) => {
    const { patches } = await monter(page, { repondeurAgentId: 'ag-lea' });
    await page.goto('/agents');
    await page.getByTestId('agent-ligne-ag-lea').click();
    await page.getByTestId('agent-activer').click();
    await repondre(page, false, /« Léa » répond au client : le désactiver le retire de ce rôle, et les messages que personne ne tient iront à l’équipe/);
    expect(patches).toEqual([]);
    await page.getByTestId('agent-activer').click();
    await repondre(page, true);
    await expect.poll(() => patches).toEqual([{ status: 'disabled' }]);
  });
});

test.describe('Agents IA : le Crédit IA d’une Entreprise (illimité, 2026-11-02)', () => {
  test('🔴 « illimité » au lieu du solde : un solde figé à zéro ne lui dit jamais « épuisé »', async ({ page }) => {
    await monter(page, { credit: { soldeMicroEur: 0, illimite: true, consommationDuMoisMicroEur: 1_000_000, plafondAtteint: false } });
    await page.goto('/agents');
    await expect(page.getByTestId('agent-ligne-ag-lea')).toBeVisible();
    await expect(page.getByTestId('agent-credit-illimite')).toContainText('Crédit IA illimité');
    await expect(page.getByTestId('agent-solde-vide')).toHaveCount(0);
    await expect(page.getByTestId('agent-plafond-ia')).toHaveCount(0);
  });

  test('🔴 son plafond de sécurité du mois atteint : la page dit pourquoi ses agents se taisent', async ({ page }) => {
    await monter(page, { credit: { soldeMicroEur: 0, illimite: true, consommationDuMoisMicroEur: 100_020_000, plafondAtteint: true } });
    await page.goto('/agents');
    await expect(page.getByTestId('agent-plafond-ia')).toContainText(/plafond de sécurité de l’IA de ce mois est atteint/);
    await expect(page.getByTestId('agent-credit-illimite')).toHaveCount(0);
    await expect(page.getByTestId('agent-solde-vide')).toHaveCount(0);
  });
});
