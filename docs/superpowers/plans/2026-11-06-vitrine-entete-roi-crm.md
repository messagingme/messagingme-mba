# Vitrine : l'en-tête, le retour vers messagingme.fr, la carte des coûts de l'accueil et l'app dans le CRM

**Date** : 2026-11-06. Demande de Julien du jour, proposition faite puis tranchée en une ronde de questions.

## Les décisions

- **En-tête** : les trois menus dépliants côte à côte, puis les deux liens : Fonctionnalités, Solutions, Ressources,
  Tarifs, Développeurs. Même ordre dans le menu du téléphone.
- **Retour vers le site institutionnel** (idée de Julien, placement confirmé) : une ligne fine sous la barre,
  « ← Retour sur messagingme.fr » (« Back to messagingme.fr »), HORS de la barre collante : on la voit en arrivant,
  elle part au défilement. Sur toutes les pages.
- **La carte de l'accueil alterne d'un tour à l'autre** (50 % du temps chacune), sur la même conversation :
  - A, comme avant : l'analyse qui part vers les CRM, **Dynamics ajouté** (HubSpot, Salesforce, Dynamics, Brevo,
    Pipedrive, Batch) ;
  - B : « Mesuré par Messaging Me », la ligne du haut défile sur les trois sources (publicités Click-to-WhatsApp,
    campagnes WhatsApp et RCS, paniers abandonnés), puis coût total 750 €, chiffre d'affaires attribué 18 240 €, coût par
    lead 1,40 €, ROI × 24 ; les flèches montent des sources (Meta, WhatsApp, RCS, l'IA, Shopify) vers la carte.
    **Décision de Julien : le ROI s'affiche**, et son calcul entre au todo de la console (elle montre aujourd'hui le
    chiffre d'affaires attribué et les coûts, sur deux écrans).
- **Intégrations** : une carte Dynamics 365 ; une section « Messaging Me s'installe dans votre CRM » avec **un onglet
  par CRM** (Dynamics 365, Salesforce). Pour Salesforce, **les deux apps** sont nommées : Marketing Cloud (l'étape
  WhatsApp dans Journey Builder) et Sales Cloud (la carte sur la fiche). **Dynamics se vend à l'Entreprise**, comme
  Salesforce et Batch.
- Rien sur la plateforme sous-jacente (règle SmartLink) ; jamais « bientôt » : le connecteur Dynamics de la console,
  les deux apps Salesforce et le ROI de la console se suivent dans `todo.md`.

## Tâches

1. **En-tête et retour** : l'ordre dans `scripts/vitrine/entete.{fr,en}.html` ; la ligne de retour posée par
   `scripts/vitrine/entete.ts` juste après la barre (réécrite à chaque génération) ; son style dans `site/site.css` ;
   `npm run vitrine:entete`.
2. **Accueil** (`site/index.html`) : la seconde carte, sa rangée de sources et ses flèches montantes, la tuile Dynamics,
   le script de la une (un tour sur deux), la FAQ et son JSON-LD ; le style dans `.flux-crm`.
3. **Intégrations** (`site/integrations/index.html`) : la carte Dynamics, les CRM en tête de grille, la section à
   onglets. Ses écrans se rendent dans l'atelier (`~/engageme-motion/engageme-integrations-crm/`) : fenêtre Customer
   Insights - Journeys d'après la maquette Neoma (elle-même relevée sur les captures de Microsoft), fenêtre Journey
   Builder d'après les captures de Salesforce (Trailhead), cartes de fiche ; français et anglais, cadre de navigateur
   par `encadrer-navigateur.cjs`, WebP. L'icône de Dynamics 365 est celle que Microsoft Learn publie
   (`site/img/logos/dynamics-365.svg`).
4. **Partout ailleurs** : la bande « Se branche à vos outils », le sous-titre du menu Intégrations, la ligne Entreprise
   de la page Tarifs, `llms.txt`.
5. **Anglais** : les phrases neuves dans `scripts/vitrine/anglais/`, puis `npm run vitrine:anglais`.
6. **Doc** : `features.md` (la vitrine), `todo.md`, le journal.

## Tests attendus

- `tests/vitrine-*.test.ts` verts (pages égales à leur génération, anglais sans reste de français, SEO, propriétés
  CSS), `tests/plan-methode.test.ts`, `tests/aide-proposer.test.ts` (`features.md` touché).
- L'en-tête mesuré à 1 141 px en français (le menu le plus long) et au téléphone (375 px), sans débordement.

## Ordre de déploiement

Un seul commit, construit sur `origin/main`, poussé APRÈS le oui de Julien sur les captures. Vercel publie la vitrine
au push ; aucune route d'API neuve, aucune migration. `ci.yml` part (un test lit `site/`) : son verdict se lit job par
job.

## Méthode de livraison

**En direct, sans agent**, parce que tout se passe dans la vitrine statique : isolé, réversible par un commit, sans
argent, sans envoi et sans invariant de production, et les critères mécaniques sont déjà tenus par les tests de la
vitrine (pages égales à leur génération, anglais complet). Une relecture indépendante en fin de lot, parce que c'est
une face publique (règle SmartLink, tirets longs, promesses produit, anglais). **Essai réel qui clôt** : Julien
regarde les captures (bureau et téléphone, français et anglais) avant la publication, puis la page en ligne : la
carte des coûts revient un tour sur deux, le lien de retour mène à messagingme.fr, les onglets Dynamics 365 et
Salesforce basculent.
