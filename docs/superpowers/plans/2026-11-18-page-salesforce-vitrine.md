# Page Salesforce de la vitrine (Solutions > Intégrations > Salesforce)

**Goal :** une page `/solutions/salesforce/` (et sa jumelle anglaise) qui montre WhatsApp dans tout Salesforce, équipe
par équipe, avec une comparaison chiffrée face au WhatsApp de Salesforce ; le menu, la page Solutions, `llms.txt` et le
sitemap la citent.

**Décisions de Julien (2026-11-18) :** la vision complète tout de suite ; un bloc par équipe (Marketing, Ventes,
Service client) ; de vraies captures d'une org de test ; un bloc de comparaison chiffré (« environ 0,1 € la réponse,
1 à 2 € la conversation ») ; le film plus tard. Pas d'AppExchange.

## Méthode de livraison

**En direct, sans agent**, parce que le lot ne touche aucun chemin que la production emprunte (HTML statique, deux
générateurs de la vitrine, deux tests), qu'il se défait d'un commit, et que son critère est un œil : Julien juge la page
sur captures avant le push. Une relecture indépendante en fin de lot. Essai réel qui clôt le lot : Julien ouvre la page
publiée et le menu Solutions > Intégrations, au bureau et au téléphone, en français et en anglais.

## Ce qui change

- `scripts/vitrine/hubspot-textes.ts` : `SALESFORCE_SOLUTION` à côté de `HUBSPOT_SOLUTION`, et `SOLUTIONS_CRM` (les
  deux, dans l'ordre du menu). `entete.ts` et `cas.ts` (menu, page Solutions, `llms.txt`) lisent `SOLUTIONS_CRM`.
- `scripts/vitrine/anglais.ts` : la jumelle `/en/solutions/salesforce/`, et l'ensemble des pages de Solutions écrites
  à la main que l'outil traduit (HubSpot, Salesforce). Dictionnaire `anglais/salesforce.json`.
- `site/solutions/salesforce/index.html` écrite à la main sur le gabarit de la page HubSpot ; deux captures réelles
  (`img/salesforce-piste.webp`, `img/salesforce-case.webp`, org de test, données inventées, encadrées par
  `encadrer-navigateur.cjs` de l'atelier) ; l'écran Journey Builder et le téléphone repris de la vitrine.
- Gabarits d'en-tête : « Shopify, HubSpot et Salesforce, en profondeur » ; la carte Salesforce de `/integrations/` mène
  à la page ; `sitemap.xml` ; une règle `.hs-prix` dans `site.css`.
- Tests : `vitrine-entete` (Intégrations = boutiques puis `SOLUTIONS_CRM`), `registre-vitrine` (les pages CRM permises).

## Les chiffres et leur source

Grilles « Rate Card, Effective November 1, 2026 onward » de Salesforce (WhatsApp Business Messaging et Message Credits
WhatsApp) : 37,04 crédits par réponse vers la France ; prix public du crédit « à partir de 2 $ les 1 000 » ; Digital
Engagement à partir de 75 € par utilisateur et par mois. Meta : 0,0248 € la réponse en France, 1 000 offertes par mois et
par numéro. Le détail : `docs/prive/2026-11-18-salesforce-etat-des-lieux.md` § 6 (non versionné).

## Vérification

`npm run vitrine:cas`, `vitrine:anglais`, `vitrine:entete` sans reste ; `npx vitest run` (vitrine, registre, seo),
`npm run typecheck`, `npm run lint` ; aperçus bureau, téléphone et anglais montrés à Julien, son oui avant le push.
