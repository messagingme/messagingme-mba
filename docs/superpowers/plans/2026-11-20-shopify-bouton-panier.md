# Shopify : le lien du panier dans un bouton « Reprendre mon panier »

**Demande de Julien, 2026-11-20** : le message du panier abandonné ne montre plus l'adresse brute de reprise du panier
dans son texte ; elle part derrière un bouton lien. Meta n'accepte qu'une base fixe et une variable en fin d'adresse, et
dans ce dépôt cette variable porte déjà le JETON du lien tracé (`/r/<code>/<jeton>`) : c'est donc NOTRE redirection qui
retrouve le panier du client au clic.

- **Une clé réservée `{panier_shopify}`** dans l'adresse d'un bouton lien (`https://<boutique>/{panier_shopify}`). Au
  clic, la redirection lit le contact par son jeton, puis le dernier panier noté pour son numéro (ouvert d'abord) dans
  `shopify_paniers`, de CET espace, et redirige vers son lien de reprise (https exigé). Sans panier (purgé à 7 jours,
  jeton anonyme, numéro inconnu) : la boutique (la clé retirée).
- **Le message standard du panier** : le texte sans lien (« … Il vous attend : reprenez-le en un clic. ») et un bouton
  « Reprendre mon panier » vers `https://<boutique>/{panier_shopify}`. Seules les boutiques branchées après le
  déploiement le reçoivent (et un cas vide au premier allumage) ; un message déjà créé garde son lien dans le texte.
- **Le clic devient visible** (statistiques du lien, signal de clic), comme tout lien tracé.
- **La console** : dans « Écrire / Modifier ce template » d'un bloc de scénario Shopify, le menu du champ d'un bouton
  lien propose « Lien du panier (Shopify) », qui insère `{panier_shopify}` (la seconde relance a le même bouton).

## Méthode de livraison

**En direct + une relecture indépendante**, parce que le lot est petit et ne crée aucune table, mais touche la
redirection publique `/r/` (un chemin que la production emprunte, sous la règle « pas de redirecteur ouvert ») : je
l'écris moi-même, avec ses tests, puis UN relecteur. L'essai réel qui clôt : une boutique de dev neuve branchée à un
espace de test, le message standard approuvé, un panier abandonné reçu sur un vrai téléphone avec le bouton, le clic qui
ouvre le panier du client et compte dans les statistiques du lien.

## Tâches

1. `web/lib/partage/champs-url.ts` : `CLE_PANIER_SHOPIFY = 'panier_shopify'`, acceptée par `refusChampsUrl`.
2. `PgTrackedLinkStore.lienDuPanier(tenantId, contactId)` ; la redirection (`src/http/links.ts`) l'emploie quand la
   destination porte la clé ; tests (panier trouvé, absent, lien non https, autre espace).
3. `TEXTES_PROPOSES.checkout_abandoned` sans `{{checkout_url}}`, `corpsStandard(evenement, domaine)` avec le bouton ;
   `proposerMessageStandard` pose les boutons du template sur le bloc ; tests.
4. Console : l'option du menu du champ lien (`TemplateForm`), seulement avec les données d'un scénario Shopify ; e2e.
5. Doc : `features.md`, fiche publique FR/EN, skill `shopify` si elle cite le lien du panier, `documentation.md`, journal.

## Déploiement

Aucune migration. L'API d'abord, puis la console (publiée au push : l'option du menu insère une clé que l'ancienne API
refuserait à la création du template ; la fenêtre est celle du déploiement, et le refus est lisible).
