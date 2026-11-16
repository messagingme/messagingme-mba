# L'onglet « Shopify » de la fiche contact

Demande de Julien du 2026-11-16 : retrouver sur la fiche d'un client du mini-CRM tout ce que nous savons de lui côté
boutique. Cadrage du même jour (rondes de questions) : un résumé chiffré, la liste des commandes, les ventes dues à
WhatsApp et leur source, les paniers abandonnés ; **rien de plus stocké** (ni numéro « #1002 », ni produits, aucune
migration) ; l'onglet paraît **dès que l'espace a une boutique**, quelle que soit l'offre.

## Méthode de livraison

**En direct**, une relecture indépendante en fin de lot, parce que c'est une route de LECTURE seule et un onglet :
aucune écriture, aucune migration, rien que la production emprunte pour envoyer, réversible par un simple retour
arrière. L'essai réel qui clôt la feature : sur « Messaging Me demo », la fiche d'un client qui a passé une commande de
test montre l'onglet et sa commande, et un espace sans boutique ne le montre pas.

## Tâches

1. **Lecture en base** : `PgVentesStore.achatsDuContact(tenantId, contactId)` (`src/shopify/ventes.pg.ts`). Trois
   requêtes, chacune filtrée `tenant_id = $1` :
   - la boutique (`shopify_boutiques` : nom, domaine, devise, `commandes_depuis`, `coupee_le`) ; sans boutique, `null`
     et rien d'autre n'est lu ;
   - les commandes de la fiche (`shopify_commandes`, 100 au plus, les plus récentes d'abord), chacune avec son
     attribution (`ventes_attribuees` par `commande_id`, nom de la campagne par `campaigns`) ; le compte et la dépense
     totale se lisent sur TOUTES ses commandes, par Postgres, dans la devise de la boutique, test compris : la même
     règle que les filtres « Achats et activité » qui ciblent ce client ;
   - les paniers de son téléphone (`shopify_paniers`, 20 au plus) ; purgés à 7 jours, l'onglet le dit.
   Contact inconnu de l'espace : `null` (404).
2. **Route** : `GET /tenants/:tenantId/contacts/:contactId/shopify` dans le module `contacts` (classe `tenant`, même
   garde que `/resume` et `/bilan`), dépendance requise `achatsShopify` ; `tests/routes-inertes.ts` la déclare.
3. **Onglet** : `web/lib/api.ts` (`getAchatsShopify`, type partagé), `web/components/ContactShopifyPanel.tsx`, entrée
   « Shopify » dans `ONGLETS_FICHE`, montrée seulement quand `chargerSegments` (déjà en cache) dit une boutique. Une
   API qui rend 404 sur la route (console poussée avant l'API) : le panneau dit « indisponible », la fiche reste.
4. **Textes** FR et EN, vouvoiement, aucun tiret long ; la phrase « commandes suivies depuis le … » reprise des filtres.

## Tests

- Unitaires : la route (404, 200, espace croisé refusé par `scope-tenant`), le panneau (rendu des montants, vide).
- Intégration (CI) : `achatsDuContact` sur un Postgres jetable : isolation entre espaces, devise, test, attribution,
  panier par téléphone.
- E2E : `web/e2e/contact-shopify.spec.ts`, mocks comme `contact-filtre-achats.spec.ts` : onglet présent avec boutique
  et ses commandes, absent sans boutique.

## Déploiement

API d'abord (`migration=aucune`), puis la console (le panneau tolère le 404 de toute façon).

**Essai réel qui clôt la feature** : sur « Messaging Me demo » (boutique de développement), la fiche d'un client qui a
passé une commande de test montre l'onglet et sa commande ; un espace sans boutique ne le montre pas.
