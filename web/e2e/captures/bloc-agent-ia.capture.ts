import { test } from '../aide/test';
import { NAVIGATEUR, langue, type Locale } from './donnees-demo';
import { bloc, etapeFlechee, fermerPanneau, fleche, ouvrir, poignee, simulerEditeur, sur, type Graphe } from './editeur-demo';

/** « Le bloc Agent IA » (lot 3) : un conseiller IA qui prend des rendez-vous, et ses sorties. */
const CLE = 'bloc-agent-ia';
const L = {
  fr: { agent: 'Conseiller', rdv: 'RDV pris', merci: 'À très vite en boutique !', nom: 'Rendez-vous' },
  en: { agent: 'Advisor', rdv: 'Appointment booked', merci: 'See you soon in store!', nom: 'Appointments' },
} as const;

for (const locale of ['fr', 'en'] as Locale[]) {
  test.describe(locale, () => {
    test.use({ ...NAVIGATEUR[locale], deviceScaleFactor: 2 });

    test(`${CLE} (${locale})`, async ({ page }) => {
      const l = L[locale];
      const sorties = [{ code: 'rdv_pris', label: l.rdv }];
      const graphe: Graphe = {
        nodes: [
          bloc('n1', 'agent', 0, 40, { agentId: 'ag1', agentLabel: l.agent, sorties }),
          bloc('n2', 'quick_message', 400, -20, { body: l.merci }),
          bloc('n3', 'inbox', 400, 200, {}),
        ],
        edges: [fleche('e1', 'n1', 'n2', 'sortie:rdv_pris'), fleche('e2', 'n1', 'n3', 'sortie:humain')],
      };
      await langue(page, locale);
      await simulerEditeur(page, graphe, l.nom, [], [], [
        sur('/agents', { agents: [{ id: 'ag1', label: l.agent, status: 'active', sorties, modele: 'openai/gpt-5-mini' }], repondeurAgentId: null }),
      ]);
      await ouvrir(page);

      await etapeFlechee(page, CLE, 1, locale, page.getByTestId('agent-node-select'));
      await fermerPanneau(page);
      await etapeFlechee(page, CLE, 2, locale, poignee(page, 'sortie:rdv_pris'));
      await etapeFlechee(page, CLE, 3, locale, poignee(page, 'timeout'));
    });
  });
}
