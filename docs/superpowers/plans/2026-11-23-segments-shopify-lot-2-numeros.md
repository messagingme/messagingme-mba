# Segments Shopify, lot 2 : le numéro utilisable, la fiche supprimée au premier 131026, la joignabilité

Spec : [`docs/superpowers/specs/2026-11-21-segments-shopify-enrichis.md`](../specs/2026-11-21-segments-shopify-enrichis.md),
sections « Qualité des numéros » et « Performance Lab, commandes expédiées et messages livrés », lot 2 de la feuille
de route.

**Décisions de Julien du 2026-11-23**, qui resserrent la spec :

- **Le premier `131026` ne supprime que les fiches NÉES D'UN ENVOI SHOPIFY et qui n'ont jamais écrit.** Une fiche
  importée, saisie ou qui a écrit reste (questions 18 et 20 de la spec tranchées). Raison : le repli d'une campagne
  (WhatsApp puis RCS ou e-mail) et la sortie « En cas d'échec » d'un scénario se servent de ce `131026` sur la même
  fiche ; « pour tout envoi de l'espace » les aurait coupés.
- **Un fixe est sauté** sur le chemin Shopify (question 19) : le candidat suivant est essayé.

**Ce que la cartographie a établi** : rien en base ne dit de façon durable qu'une fiche est née d'un envoi Shopify.
`opt_in_source = 'shopify:<domaine>'` est aussi écrit sur une fiche existante restée `unknown` (entrant, import sans
accord, import Shopify de la console) ; le seul fait exact, `created` dans `api_idempotency`, est purgé à 24 h. D'où
une marque posée à l'insertion.

## Lot 2a : le numéro utilisable et la suppression

1. **Migration `avant`** : `contacts.nee_de text null`, CHECK `nee_de in ('shopify')`, posée seulement à l'insertion
   (comme `ne_entrant`), jamais mise à jour. Métadonnées seules, `lock_timeout` 5 s.
2. **Numéro utilisable** (`src/shopify/donnees.ts`) : `telephoneDeCommande`, `telephoneDExpedition` et
   `telephoneDeCheckout` sautent un candidat `estUnFixe`. `telephoneE164` ne change pas : `customers/redact` et
   l'import des abonnés le gardent tel quel.
3. **La marque** : l'envoi Shopify (`envoyerShopify`, confirmation, expédition, relance de panier) passe
   `neeDe: 'shopify'` jusqu'à l'insertion de `creerFicheApi` ; une fiche déjà là n'est pas touchée.
4. **L'accusé** : un puits de plus dans `processStatuses`, en dernier, sur `failed` et code `131026` seulement, met en
   file un job (file nouvelle, dans `BASE_QUEUES`) avec le `wamid`. Le job retrouve la ligne de campagne par
   `message_id`, puis supprime la fiche par `purgeMany` (hors quota du jour, comme `customers/redact`, et
   `oublierChezMeta`) si et seulement si : `nee_de = 'shopify'`, fiche vivante, `derniere_activite_le` nulle et aucun
   message entrant, aucun message déjà livré ou lu (ajouté à la relecture : un message livré prouve que le numéro est sur
   WhatsApp), la campagne n'a pas d'étage de repli (`SANS_REPLI_SQL`), et le scénario n'a pas pris la sortie d'échec
   (`retry_count < 2`). Le balayage des relances ignore déjà une ligne purgée (`NON_PURGE_SQL`).
5. **Tests** : chaque garde vue rouge sans elle ; fixe sauté, mobile gagnant ; marque posée à l'insertion seulement.

## Lot 2b : la carte « Joignabilité WhatsApp »

1. **Migration 0310** : `shopify_joignabilite` (`tenant_id`, `commande_id`, classement `sans_numero` | `invalide` |
   `utilisable`, `test`, `expediee_le`), sans téléphone ni nom ; `shopify_envois` (`campaign_id` vers `commande_id`)
   pour relier les accusés d'un message à sa commande. Non bloquante : tout ce qui l'écrit ou l'efface le fait au mieux.
2. **Écritures, au mieux** (une panne est journalisée, rien ne s'arrête) : le classement et le drapeau test à
   `orders/paid`, pour toute commande d'une boutique branchée ; `expediee_le` au premier `fulfillments/create`, ligne
   allumée ou non ; la campagne d'un message de confirmation ou d'expédition vers sa commande, par un rappel de l'envoi
   Shopify. 🔴 Rien n'est écrit dans le traitement des accusés : livrée et supprimée se LISENT au moment de la carte, sur
   `campaign_recipients` (accusé `delivered` ou `read` ; `failed` 131026 d'une ligne anonymisée par la purge).
   🔴 Une commande ne compte qu'une fois son paiement vu (rouge de la relecture) : payée avant la mise en service, puis
   expédiée, elle naît sans classement et la carte l'ignore, plutôt que de la ranger « en attente » faute de lien vers
   sa confirmation.
3. **Effacements** : avec le branchement de la boutique (`shop/redact`, la désinstallation d'une boutique de la console,
   la reprise par un autre espace), dans sa transaction mais derrière un point de reprise, pour qu'une table absente ne
   fasse pas échouer le reste ; `customers/redact` (les commandes citées), au mieux ; le ménage périodique du worker
   retire une ligne jamais expédiée à 60 jours, toute ligne à 400.
4. **Route** `/stats/joignabilite` (formule Pro, comme `/stats/ventes`), la réponse partagée
   (`web/lib/partage/joignabilite-shopify.ts`) ; la carte en bas de Performance Lab > Quantitatif > Shopify, chargée à
   part comme le ROI (absente sur un 404) : les deux nombres, le taux sur les commandes expédiées (jamais 0 % sans
   expédition), les quatre parts, le test à part.

## Méthode de livraison

**Implémenteur par lot + revue humaine du DIFF**, parce que le 2a supprime des fiches sur un accusé Meta, chemin que la
production emprunte, avec une migration avant le code et des invariants invisibles (le repli des campagnes, la branche
d'échec des scénarios, le quota d'effacement, la marque posée à l'insertion seulement). Je code et teste chaque lot,
une relecture indépendante passe, Julien relit le diff avant le déploiement. L'essai réel qui clôt le 2a : sur la
boutique de développement, une commande avec un mobile qui n'est pas sur WhatsApp, la confirmation part, la fiche
disparaît au `131026` ; une commande avec un fixe de livraison et un mobile client part au mobile. Le 2b : la carte
d'un espace de test, relue contre ces commandes.

## Déploiement

2a : `migration=avant`, puis l'API et les workers (le job tourne dans le worker). 2b : sa migration `avant`, l'API,
puis la console (la carte appelle une route neuve : poussée après le déploiement de l'API, ou tolérante au 404).
