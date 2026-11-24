# Lot 1 du CSM virtuel, brique B1 : les tests de parité

Source : le plan « Lot 1 : tout en outils » (https://claude.ai/artifact/LfwZTpZXFZ6sNALo6jsGAw), section « Comment on
saura que c'est fini ». Décision de Julien du 2026-11-24 : B1 d'abord, la spec et les plans du lot vivent dans le dépôt.

## Le but

Rendre mécanique le critère de fin du lot 1 : chaque route de console ouverte au Pro a un outil MCP, ou une raison
écrite d'être humaine ou exclue. Le test donne la liste de travail du lot, puis empêche qu'elle se rouvre : une route
ajoutée sans décision casse la CI.

## Ce que le code impose

- Les outils MCP appellent les services, pas les routes : le lien d'une route à son outil s'ÉCRIT (une table), il ne
  se déduit pas.
- L'inventaire vient du registre réel (`modulesDeRoutes`), chaque module `tenant` monté seul, comme dans
  `tests/offres-fonctions.test.ts`. L'offre qu'exige une route se MESURE par l'étape d'offre réelle : un espace Pro reçoit
  402 avant le handler. Les routes Business et Entreprise sortent donc seules (lot 7), sans liste écrite à la main.
- Le grain est la méthode : le `GET` et le `DELETE` d'un même chemin se décident séparément.

## A1 · Parité des adresses

- `tests/parite/adresses.ts` : la table, une entrée par route ouverte au Pro, clé `METHODE /chemin` (sans le préfixe
  `/tenants/:tenantId`). Quatre décisions :
  - `outils` : le ou les outils qui servent la route, et `reste`, ce qu'ils ne couvrent pas encore ;
  - `humain` : un geste des garde-fous du plan (payer, OAuth, secret, STOP, second facteur, partage avec Meta) ;
  - `exclue` : pas d'outil, exprès, avec sa raison ;
  - `aFaire` : la brique qui la couvrira (B2 à B10) et ce qu'il faut exposer.
- `tests/parite-adresses.test.ts` :
  1. chaque route ouverte au Pro a son entrée, et la table n'a aucune entrée morte ni aucune route Business ;
  2. chaque outil nommé existe dans `OUTILS` ;
  3. chaque raison, chaque `reste` et chaque `quoi` est écrit ;
  4. la garde de la garde : l'inventaire contient des routes refusées au Pro, sinon la mesure de l'offre ne prouve rien.
- La liste de travail, ce sont les `aFaire` et les `reste` de la table. Le lot 1 est fini quand il n'en reste aucun ; le
  test qui l'exigera s'ajoute à la fin du lot, pas avant (il serait rouge pendant tout le lot).
- Exclusions proposées hors du plan, à relire par Julien : la plomberie d'écran (compteurs, identité de la séance,
  catalogue des blocs de l'éditeur), HubSpot et l'agent de Meta restés ouverts au Pro pour pouvoir débrancher (lot 7),
  le RCS (lot 7), Shopify (chantier à part, décision du 23 novembre).

## A2 · Parité des champs (après A1)

- Pour chaque route d'écriture servie par un outil : son schéma Zod, exporté, converti par `z.toJSONSchema` côté entrée,
  comparé à l'entrée de l'outil. Chaque champ et chaque borne y figure, ou sa transformation ou son absence est écrite.
- Les routes qui lisent leur corps sans schéma (`req.body as`) sont listées : leur schéma est à écrire avec leur outil.
- ⚠️ La forme que rend `z.toJSONSchema` change d'une version de zod à l'autre : un champ nullable s'écrit
  `type: [x, null]` en 4.6.7 (le lockfile, la CI) et `anyOf` en 4.4.3 (le `node_modules` du poste, en retard). La
  comparaison normalise ces deux formes, sinon elle serait verte en CI et rouge sur le poste, ou l'inverse.
- Les règles entre réglages de l'agent IA (camp, ordre d'un enchaînement) : un test des règles annoncées, avec le domaine
  de l'agent.

## Tests

La table et son test (A1), puis le test des champs (A2). Chaque garde est vérifiée dans les deux sens : une route
ajoutée sans entrée, une entrée morte, un outil inexistant font échouer le test avec un message qui nomme la route.

## Déploiement

Rien ne part en production : des tests, et en A2 le mot `export` devant des schémas existants. La CI `unit` suffit.

## Méthode de livraison

En direct, sans agent : ce sont des tests et des exports, réversibles par un commit, qu'aucun chemin de production
n'emprunte. Le classement des routes est une lecture humaine, donc Julien relit les exclusions proposées hors du plan.
L'essai réel qui clôt chaque étape : muter le code (une route sans entrée, un outil inexistant, une entrée morte), voir
le test échouer avec le bon message, puis restaurer et comparer à `origin`.
