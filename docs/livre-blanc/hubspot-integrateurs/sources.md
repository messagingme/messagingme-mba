# Livre blanc « WhatsApp dans HubSpot » pour les intégrateurs (2026-11-25)

Six pages, en français, envoyées en direct aux intégrateurs HubSpot (aucune page sur la vitrine). Cadrage de Julien
du 2026-11-25 : fond blanc, plus court que « Recruter sur WhatsApp », sans notre offre Entreprise ni prix, sans le coût
des messages Meta, scénarios types sans client nommé, contact nommé en dernière page.

Imprimer :

```
node scripts/livre-blanc/imprimer.mjs docs/livre-blanc/hubspot-integrateurs/livre-blanc.html docs/livre-blanc/hubspot-integrateurs/livre-blanc-whatsapp-hubspot.pdf
```

## Chiffres de la couverture

Repris tels quels du livre blanc des écoles, avec leurs sources (`../whatsapp-education/sources.md`) : 56 M
d'utilisateurs (Meta, 2026), 83 % (enquête Kantar pour Meta, étude BCG et Meta du 2026-04-09), ×4,5 Air France (même
étude). **+30 % de réachat** chez les clients qui ont échangé plus de 3 messages avec la marque : mesure
Messaging Me chez un client assureur, donnée par Julien le 2026-11-25, la marque jamais citée. Le « 96 % de taux de lecture » du livre blanc des écoles, sans source, n'est pas repris.

## Le tableau face au canal natif (page 3)

Repris de `site/solutions/deep-hubspot-integration/`, sauf la ligne de l'agent IA. **Le natif a un agent IA sur
WhatsApp** : Breeze Customer Agent se déploie sur le canal WhatsApp de HubSpot (offres Pro ou Enterprise),
d'après `knowledge.hubspot.com/customer-agent/deploy-the-customer-agent-to-channels`, relevé le 2026-11-25. La ligne
dit donc oui des deux côtés, avec l'offre HubSpot qu'il faut. La page de la vitrine dit la même chose depuis
d329a4b67 (« Un agent IA sur WhatsApp, avec toutes les offres HubSpot »).

## Les prérequis HubSpot (page 4)

Ceux de la fiche d'aide `docs/aide/fiches/integrer-whatsapp-a-hubspot.md` : toutes les offres pour la carte,
l'analyse, les tâches, l'étape de transaction et les listes ; un Hub en Pro pour les actions de workflow ; Sales ou
Service Hub en Pro pour l'Inbox.

## Visuels

- `img/telephone-devis.png` : le téléphone de la vitrine (`site/site.css`), source `telephone-devis.html`, rendu en
  PNG par Playwright à l'échelle 3 (264 × 556, `omitBackground`).
- `img/hubspot-carte.png` : la carte Messaging Me de `site/img/hubspot-fiche.webp`, recadrée sur la conversation
  (x 552, y 238, 928 × 840).
- La capture réelle du workflow (`~/mm-hubspot/docs/2026-11-12-mode-operatoire-workflow-de-test/img/2-action.png`)
  est écartée : trop basse définition, et ses noms d'essai se voyaient une fois masqués. La page 5 montre le
  déclencheur et l'action en schéma.
