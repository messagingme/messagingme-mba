import { test, expect } from '../aide/test';
import { NAVIGATEUR, capturer, communs, langue, type Locale } from './donnees-demo';
import { AG, TEXTES, agentDemo, simulerAgent, type EtatDemo } from './agent-ia-demo';

/**
 * « Le modèle, le crédit et les garde-fous d'un agent IA » : l'onglet Modèle et sa consommation, l'onglet Périmètre et
 * garde-fous, le crédit IA en haut de la liste, la mention d'IA. Les formes sont celles de `web/e2e/agents-modele.spec.ts`
 * et `agents-repondeur.spec.ts` ; les prix de la liste sont ceux d'une formule Pro, inventés à l'unité près.
 */
const CLE = 'agent-ia-modele-credit-garde-fous';

for (const locale of ['fr', 'en'] as Locale[]) {
  test.describe(locale, () => {
    test.use(NAVIGATEUR[locale]);

    test(`${CLE} (${locale})`, async ({ page }) => {
      const l = TEXTES[locale];
      const etat: EtatDemo = {
        locale, agent: agentDemo(locale, { status: 'active' }),
        consommation: null,
      };
      await langue(page, locale);
      await simulerAgent(page, etat);
      await communs(page);

      // 1. L'onglet Modèle : la liste, chaque modèle avec son prix.
      await page.goto(`/agents?id=${AG}&tab=modele`);
      await expect(page.getByTestId('agent-modele')).toBeVisible();
      await capturer(page, CLE, 1, locale, undefined, 'haut', page.getByTestId('agent-modele'));

      // 2. Sa consommation sur 30 jours, sous la liste (un agent qui a déjà tenu des conversations).
      etat.consommation = { sessions: 214, tokensEntree: 1_482_300, tokensSortie: 96_400, coutMicroEur: 694_000, jours: 30 };
      await page.goto(`/agents?id=${AG}&tab=modele`);
      await expect(page.getByTestId('agent-consommation')).toBeVisible();
      await capturer(page, CLE, 2, locale, page.getByTestId('agent-consommation'), 'bas', page.getByTestId('agent-consommation'));

      // 3. Périmètre et garde-fous : le crédit par conversation (sans limite), les tours, les appels d'outils.
      await page.goto(`/agents?id=${AG}&tab=perimetre`);
      await expect(page.getByTestId('agent-max-tours')).toBeVisible();
      await capturer(page, CLE, 3, locale, undefined, 'haut', page.getByTestId('agent-budget-sans-limite'));

      // 4. Le même onglet, plus bas : l'inactivité et le contact inconnu du mini-CRM.
      await capturer(page, CLE, 4, locale, page.getByTestId('agent-contact-inconnu'), 'bas', page.getByTestId('agent-contact-inconnu'));

      // 5. Le crédit IA en haut de la liste des agents : bas, avec « Recharger le crédit IA ».
      etat.credit = { soldeMicroEur: 420_000 };
      etat.liste = [
        { id: AG, label: l.agent, status: 'active', sorties: [], modele: 'google/gemini-2.5-flash' },
        { id: 'ag-sav', label: l.autre, status: 'draft', sorties: [], modele: 'anthropic/claude-haiku-4.5' },
      ];
      await page.goto('/agents');
      await expect(page.getByTestId('agent-solde-bas')).toBeVisible();
      await capturer(page, CLE, 5, locale, undefined, 'haut', page.getByTestId('agent-solde-recharger'));

      // 6. La mention d'IA, dans Identité et ton, et le renvoi vers Sécurité > IA.
      await page.goto(`/agents?id=${AG}&tab=identite`);
      await expect(page.getByTestId('agent-mention')).toBeVisible();
      await capturer(page, CLE, 6, locale, page.getByTestId('agent-mention-frequence-renvoi'), 'bas', page.getByTestId('agent-mention'));
    });
  });
}
