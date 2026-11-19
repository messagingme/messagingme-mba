import { test, expect } from '../aide/test';
import { CHAMPS_DEMO, NAVIGATEUR, capturer, communs, langue, type Locale } from './donnees-demo';

/**
 * « Brancher un connecteur API » : le système déclaré, éprouvé, un appel mis au point (ses données, son essai), puis
 * donné à un agent IA. Les états sont ceux de `web/e2e/agents-connecteurs.spec.ts` ; rien n'est appelé, l'épreuve et
 * l'essai sont simulés, aucun secret réel.
 */
const CLE = 'brancher-un-connecteur-api';
const SRC = 'src-demo';
const RQ = 'rq-demo';
const AG = 'ag-demo';
const L = {
  fr: { systeme: 'Boutique', appel: 'Statut de commande', agent: 'Service client', chemin: '/commandes/{{ref}}', ref: 'CMD-10482', champ: 'numero_commande', champLibelle: 'Numéro de commande',
    reponse: { statut: 'expediee', transporteur: 'Colissimo', livraison: { date: '2026-11-21' }, client: { email: 'lea@exemple.test' } },
    chemins: ['statut', 'transporteur', 'livraison.date', 'client.email'], gardes: ['statut', 'livraison.date'],
    outil: { nom: 'statut_commande', titre: 'Statut de commande', sert: 'Quand le client demande où en est sa commande.', pas: 'Pour une commande pas encore payée, ou un retour.' } },
  en: { systeme: 'Shop', appel: 'Order status', agent: 'Customer service', chemin: '/orders/{{ref}}', ref: 'ORD-10482', champ: 'order_number', champLibelle: 'Order number',
    reponse: { status: 'shipped', carrier: 'Colissimo', delivery: { date: '2026-11-21' }, customer: { email: 'lea@example.test' } },
    chemins: ['status', 'carrier', 'delivery.date', 'customer.email'], gardes: ['status', 'delivery.date'],
    outil: { nom: 'order_status', titre: 'Order status', sert: 'When the customer asks where their order is.', pas: 'For an order not paid yet, or a return.' } },
} as const;

const source = (l: (typeof L)[Locale], status: string) => ({
  id: SRC, kind: 'http', label: l.systeme, baseUrl: 'https://api.votre-marque.test/v1', authKind: 'bearer', authHeaderName: null,
  aAuthentification: true, status, lastOkAt: null, lastError: null, outilsActifs: 0, agents: 0,
});
const requete = (l: (typeof L)[Locale]) => ({
  id: RQ, tenantId: 't-demo', sourceId: SRC, label: l.appel, methode: 'GET', chemin: l.chemin, parametres: [], entetes: [],
  corps: { mode: 'aucun' },
  variables: [{ nom: 'ref', type: 'string', origine: { type: 'champ', cle: l.champ }, requis: true }],
  outputPaths: [], valeursTest: { ref: l.ref }, outils: 0, scenarios: [], updatedAt: '2026-11-18T09:00:00.000Z',
});
const essai = (l: (typeof L)[Locale]) => ({
  ok: true, httpStatus: 200, dureeMs: 184,
  envoye: { url: `https://api.votre-marque.test/v1${l.chemin.replace('{{ref}}', l.ref)}`, methode: 'GET', corps: null },
  apercu: JSON.stringify(l.reponse, null, 2),
  chemins: [...l.chemins],
  risqueMinimum: 'read',
});
const CATALOGUE = {
  fiche: [
    { cle: 'wa_id', libelle: ['Numéro WhatsApp', 'WhatsApp number'], provenance: 'contact' },
    { cle: 'nom', libelle: ['Nom', 'Name'], provenance: 'contact' },
  ],
  systeme: ['derniere_saisie', 'maintenant'], entetesReserves: ['authorization'],
};
const AGENT = {
  id: AG, status: 'active', mentionIa: '', modele: 'anthropic/claude-haiku-4.5', ficheVersion: 1,
  contenu: { nom: '', objectif: '', ton: '', personnalite: '', reglesTransfert: '', sorties: [] },
  plafonds: { maxTours: 8, maxAppelsOutils: 12, budgetMicroEur: 30000 }, inactiviteMinutes: 30, contactInconnu: 'lecture_seule',
};

for (const locale of ['fr', 'en'] as Locale[]) {
  test.describe(locale, () => {
    test.use(NAVIGATEUR[locale]);

    test(`${CLE} (${locale})`, async ({ page }) => {
      const l = L[locale];
      let sources: unknown[] = [];
      let requetes: unknown[] = [];
      await langue(page, locale);
      await page.route('**/api/backend/**', async (route) => {
        const req = route.request();
        const url = req.url();
        const json = (b: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) });
        if (req.method() !== 'GET') {
          if (url.includes('/epreuve')) return json({ ok: true, httpStatus: 200 });
          if (url.includes('/agent-requetes/') && url.endsWith('/test')) return json(essai(l));
          if (url.endsWith('/agent-requetes/test')) return json(essai(l));
          return json({ ok: true });
        }
        if (/\/manques$/.test(url)) return json({ manques: [], avertissements: [] });
        if (url.includes('/agent-requetes')) return json({ requetes, champs: [l.champ], catalogue: CATALOGUE });
        if (url.includes('/agent-sources')) return json({ sources });
        if (url.includes('/user-fields')) return json({ fields: [...CHAMPS_DEMO, { key: l.champ, label: l.champLibelle, type: 'text' }] });
        if (/\/agents\/[^/]+\/tools$/.test(url)) return json({ outils: [], catalogue: [] });
        if (url.includes('/agents/solde')) return json({ soldeMicroEur: 10_000_000 });
        if (/\/agents\/[^/?]+(\?|$)/.test(url)) return json({ agent: { ...AGENT, label: l.agent } });
        if (/\/agents(\?|$)/.test(url)) return json({ agents: [{ id: AG, label: l.agent, status: 'active', modele: AGENT.modele }] });
        return json({});
      });
      await communs(page);

      // 1. « Brancher un système » : le nom, l'adresse, le jeton, juste avant « Brancher ». Rien n'est branché.
      await page.goto('/connecteurs');
      await expect(page.getByTestId('sources-vide')).toBeVisible();
      await page.getByTestId('source-ajouter').click();
      await page.getByTestId('source-label').fill(l.systeme);
      await page.getByTestId('source-url').fill('https://api.votre-marque.test/v1');
      await page.getByTestId('source-secret').fill('demo-jeton-invente');
      await capturer(page, CLE, 1, locale, undefined, 'haut', page.getByTestId('source-creer'));

      // 2. Le système déplié et éprouvé, encore en brouillon : « Activer » sur sa ligne.
      sources = [source(l, 'draft')];
      await page.goto('/connecteurs');
      await page.getByTestId(`source-ligne-${SRC}`).click();
      await page.getByTestId(`source-chemin-${SRC}`).fill(locale === 'fr' ? '/commandes' : '/orders');
      await page.getByTestId(`source-eprouver-${SRC}`).click();
      await expect(page.getByTestId(`source-epreuve-${SRC}`)).toContainText('200');
      await capturer(page, CLE, 2, locale, page.getByTestId(`source-cadre-${SRC}`), 'haut', page.getByTestId(`source-statut-${SRC}`));

      // 3. « Ajouter un appel » : le nom, la méthode, le chemin et sa pastille encore à déclarer.
      sources = [source(l, 'active')];
      await page.goto('/connecteurs');
      await page.getByTestId(`source-ligne-${SRC}`).click();
      await page.getByTestId('requete-nouvelle').click();
      await page.getByTestId('requete-label').fill(l.appel);
      await page.getByTestId('requete-chemin').fill(l.chemin);
      await capturer(page, CLE, 3, locale, page.getByTestId('requetes-bloc'), 'haut', page.getByTestId('requete-chemin'));

      // 4. L'appel enregistré, sa donnée déclarée : d'où vient sa valeur (un champ de la fiche), obligatoire.
      requetes = [requete(l)];
      await page.goto('/connecteurs');
      await page.getByTestId(`source-ligne-${SRC}`).click();
      await page.getByTestId(`requete-editer-${RQ}`).click();
      await expect(page.getByTestId('var-origine-0')).toBeVisible();
      await capturer(page, CLE, 4, locale, page.getByTestId(`requete-${RQ}`), 'haut', page.getByTestId('var-origine-0'));

      // 5. « Essayer », la réponse, les champs cochés, juste avant « Enregistrer ». Rien n'est enregistré.
      await page.getByTestId('requete-essayer').click();
      await page.getByTestId('onglet-reponse').click();
      for (const c of l.gardes) await page.getByTestId(`chemin-${c}`).check();
      await capturer(page, CLE, 5, locale, page.getByTestId(`requete-${RQ}`), 'haut', page.getByTestId('reponse-chemins'));

      // 6. L'agent IA : « Appeler un connecteur API », l'appel choisi, « Que fait cet appel ? ».
      await page.goto(`/agents?id=${AG}&tab=outils`);
      await expect(page.getByTestId('outils-poses')).toBeVisible();
      await page.getByTestId('agent-outils-ajouter').click();
      await page.getByTestId('mba-type-connecteur').click();
      await page.getByTestId(`requete-nouvel-outil-${RQ}`).click();
      await page.getByTestId('nature-integre').check();
      await page.getByTestId('outil-essayer').click();
      for (const c of l.gardes) await page.getByTestId(`outil-champ-${c}`).check();
      await page.getByTestId('outil-nom').fill(l.outil.nom);
      await page.getByTestId('outil-titre').fill(l.outil.titre);
      await page.getByTestId('outil-description').fill(l.outil.sert);
      await page.getByTestId('outil-nepasutiliser').fill(l.outil.pas);
      await expect(page.getByTestId('outil-creer')).toBeEnabled();
      await capturer(page, CLE, 6, locale, page.getByTestId('envoi-resume'), 'haut', page.getByTestId('outil-nature'));
    });
  });
}
