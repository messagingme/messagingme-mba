# Le ROI des messages sur la page Quantitatif > Shopify

Date : 2026-11-06. Cadré avec Julien (deux rondes de questions, réponses citées telles quelles plus bas).

## Intention

Un e-commerçant qui a branché sa boutique veut savoir si ses messages WhatsApp lui rapportent plus qu'ils ne coûtent.
La page Quantitatif > Shopify (`web/app/dashboard/shopify/page.tsx`) dit déjà ce que les messages ont ramené (chiffre
brut, part prouvée, par source) ; elle ne dit rien de ce qu'ils ont coûté. On ajoute, sur la même période, ce qu'ils ont
coûté, les deux en courbes, et le ROI. C'est l'argument qui justifie l'abonnement : « vos messages vous ont rapporté
2 200 % de ce qu'ils vous ont coûté ».

## Ce qui a été décidé avec Julien

1. **Le coût mis en face du chiffre, c'est celui des leviers de vente** : ce qui peut ramener une vente. Pas les
   confirmations de commande ni d'expédition, qui suivent la vente. Choix « Les leviers de vente ».
2. **Le coût de l'IA entre dans le total, sur une ligne à part**, pour que le ROI de l'agent IA soit honnête. Choix
   « Oui, ligne à part ».
3. **Le ROI se calcule sur le chiffre BRUT**, avec une seconde ligne « dont prouvé », comme la page aujourd'hui, et la
   règle d'attribution reste écrite sous le chiffre. Choix « Brut, prouvé à côté ».
4. **Le graphique montre deux courbes CUMULÉES sur la période** : ce qu'on a dépensé, ce que ça a ramené, depuis le
   premier jour de la plage choisie. Choix « Cumul sur la période ».
5. **Le ROI s'écrit en pourcentage** : (chiffre brut moins coût) divisé par coût, par exemple « ROI : 2 200 % ». Choix
   « En pourcentage ».
6. **Console seulement** : `get_revenue_stats` (MCP) ne change pas, le plugin n'est pas republié. Le graphique reste un
   argument de l'offre Pro et au-dessus (fonction `statistiques`). Choix « Console seulement ».
7. **Le tableau « Par source » part de tout ce qui a coûté**, pas seulement de ce qui a vendu : une campagne sans vente
   y figure avec un ROI de -100 %. Les lignes sont triées par coût, 50 au plus, et le total « dépensé » est la somme des
   lignes (une ligne « autres » si le plafond coupe). Choix « Oui, triées par coût ».

## Objectifs

- Sur la page Quantitatif > Shopify, pour la plage du `RangeBar` existant : un graphique à deux courbes cumulées par
  jour (chiffre brut attribué, coût des leviers), les trois chiffres de la période (dépensé, ramené, ROI en %), et la
  ligne « dont prouvé ».
- Dans le tableau « Par source » existant : une colonne coût et une colonne ROI par ligne (chaque campagne par son nom,
  la relance de panier, les scénarios, l'agent IA, l'agent de Meta).
- Le coût de l'IA visible à part dans le total (les messages, puis l'IA).

## Non-objectifs

- Pas de ROI dans Claude Code, ni dans la Synthèse `/performance`, ni sur l'accueil.
- Pas de nouvelle attribution : le chiffre reste celui de `ventes_attribuees` (migration 0261), figé au paiement.
- Pas de remboursements déduits (déjà la règle du chiffre brut).
- Pas de conversion de devise.

## Anti-objectifs (ce qui ferait de la livraison un échec même si elle marche)

- **Additionner deux devises.** Si la devise de la boutique et celle du coût diffèrent, pas de ROI ni de courbe de
  coût superposée : on le dit en une phrase (« la boutique vend en USD, les messages sont facturés en EUR »).
- **Un coût faux présenté comme sûr.** Le coût est une ESTIMATION pour les espaces sans Crédit WhatsApp (tarifs de
  Meta, comme la page Coûts) : le libellé le dit. Un coût inconnu (pas de tarif, catégorie absente) n'est jamais
  compté comme zéro en silence : un ROI calculé sur un coût partiel l'annonce.
- **Compter dans le coût un message qui ne peut pas être une touche**, ou l'inverse. Le coût et le chiffre doivent
  parler des mêmes messages (règle ci-dessous), sinon le ROI d'une source ment.
- **Un ROI affiché quand le coût vaut zéro** (division par zéro, ou « ROI infini ») : on écrit le chiffre ramené et
  « aucun coût sur la période ».
- **Une courbe de coût écrasée au fond du graphique** : deux échelles, ou une présentation qui garde les deux courbes
  lisibles quand le chiffre fait 100 fois le coût.

## La règle qui tient tout : le coût compte exactement les messages qui peuvent être une touche

L'attribution lit ses touches à deux endroits (`TOUCHES`, `src/shopify/ventes.pg.ts`) :

- les destinataires de Campagnes : les campagnes, et la relance de panier (nom `$6`) ; SANS les confirmations et
  expéditions Shopify, les envois `[API]` ni les lignes HubSpot (exclues par leur préfixe de nom, `attribution.ts`) ;
- les messages sortants du fil d'un contact d'origine `scenario`, `ia` et `mba`.

Le coût des leviers se calcule sur CE périmètre, par la même définition (idéalement les mêmes fragments SQL ou
prédicats, importés, pas recopiés : un test doit casser si l'un bouge sans l'autre). Chaque message coûté se range
dans la même source que la touche qu'il serait.

## Les sources du coût

Deux sources de prix, selon l'espace, et c'est l'espace qui décide :

- **Numéro sur le Crédit WhatsApp** (`lignes_credit_whatsapp`) : le coût RÉEL de chaque message, en EUR,
  `credit_whatsapp_provisions.montant_micro_eur` (non rendu), rattaché par `wamid`. Meta ne rend pas de coût analytics
  pour ces comptes (`parsePricing` rend `null`), donc c'est la seule source pour eux.
- **Sinon** : l'estimation existante, tarif moyen par catégorie de Meta (`pricing_analytics`) avec la marge de
  `grille_prix`, dans la devise du WABA (`src/stats/cost.ts`, `src/stats/chiffrage.ts`, `src/stats/prix.ts`).
  Modèles facturables par catégorie ; messages de service au tarif de service, franchise mensuelle répartie au
  prorata comme le fait déjà `estimateCoutParCampagne`.
- **L'IA** : le débit du crédit IA de l'espace pour les tours de l'agent IA de la période (`agent_credit_mouvements`),
  au prix client. Une ligne à part, rangée sous la source « agent IA ».

## Le jour d'un coût et le jour d'une vente

Le chiffre est daté du paiement (`payee_le`, jours de Paris, `BOUNDS_CTE`) ; le coût, de l'envoi. Les deux courbes
cumulent chacune sur sa date, sur la même plage. Une vente payée dans la plage peut venir d'un message envoyé jusqu'à 5
jours avant son début, et un message de fin de plage peut ramener une vente après : c'est accepté et dit en une ligne
sous le graphique, pas compensé.

## Ce qui existe et se réutilise

- Le chiffre par jour : les requêtes de `PgVentesStore.lireChiffre` avec la date de Paris en plus dans le `group by`,
  même `BOUNDS_CTE`, index `(tenant_id, payee_le)` déjà là.
- La route `GET /tenants/:tenantId/stats/ventes` (fonction `statistiques`) et `chiffreVentes` : on les enrichit plutôt
  que d'ajouter une route, si le calcul reste raisonnable ; `get_revenue_stats` appelle la même fonction et ne doit
  PAS changer de forme (décision 6) : le coût se calcule à part, ou derrière une option que l'outil MCP ne passe pas.
- Le graphique : `web/components/DailyChart.tsx` a UNE échelle et ADDITIONNE ses séries dans son grand chiffre ;
  `PerformanceCourbe.tsx` interrompt une courbe sur un jour sans mesure. Ni l'un ni l'autre ne convient tel quel.
  Pas de librairie de graphiques dans la console (SVG maison) ; les règles de `tests/web-formes.test.ts` et
  `tests/web-icones.test.ts` s'appliquent.
- Les devises : montants en texte décimal, jamais additionnés entre devises (règle de la page actuelle).
- Les commandes de test restent hors du chiffre et hors du ROI.

## Tranché après la relecture de la conception (choix de Claude, à contrôler par Julien)

- **Le scénario lancé par une campagne coûte à la campagne**, comme la vente lui est attribuée (`choisirSource`,
  branche `lanceScenario`). Sinon la campagne aurait du chiffre sans coût et « scénario » un coût sans chiffre. Le
  moyen (règle de temps reprise de l'attribution, ou lien du message à sa campagne par migration) est au constructeur ;
  une migration, si elle est choisie, suit les règles du `CLAUDE.md` (avant ou après, relue en base).
- **Le prix se choisit message par message, pas par espace** : la provision du Crédit WhatsApp si le message en a une
  (non rendue), sinon l'estimation. La ligne de crédit est posée par numéro et datée (`lignes_credit_whatsapp`), un
  espace peut donc mêler les deux. Le libellé dit « estimé » dès qu'une part du coût l'est.
- **Plusieurs devises de coût** (l'IA et le Crédit WhatsApp en EUR, l'estimation dans la devise du WABA) : le ROI ne
  porte que sur les coûts dans la devise de la boutique. Un coût dans une autre devise est montré à part, et le ROI
  l'annonce (« hors 12,40 USD de messages »), jamais converti ni compté zéro en silence.
- **Le RCS d'une campagne se chiffre au prix de `grille_prix`** (même calcul que `coutMessages`, bascule
  conversationnelle comprise) ; **un étage e-mail n'a pas de prix connu** : sa campagne annonce « coût partiel ».

## Laissé au constructeur

- La forme exacte du graphique (deux échelles ou autre), tant que l'anti-objectif « courbe écrasée » tient.
- Enrichir `/stats/ventes` ou ajouter une route ; le découpage serveur/console et l'ordre de déploiement (l'écran
  part APRÈS l'API qui porte sa route, règle du `CLAUDE.md`).
- Le texte exact des libellés et de la ligne d'explication, en français et en anglais (la console est bilingue).
- Le coût de l'agent de Meta : ses messages sont des messages de service ; si un autre coût existe chez Meta et n'est
  pas connu, la source l'annonce « coût non connu » plutôt que zéro.

## Essai réel qui clôt la feature

Sur l'espace de démonstration branché à la boutique de dev `messaging-me-essai` : une campagne envoyée au téléphone de
Julien, une commande payée par son lien dans les 5 jours, une relance de panier récupérée ; puis la page Quantitatif >
Shopify montre les deux courbes cumulées, le coût de la campagne et de la relance dans « Par source », le ROI en %
égal au calcul à la main, et une confirmation de commande ABSENTE du coût. Puis le même écran sur un espace au Crédit
WhatsApp (coût réel en EUR).
