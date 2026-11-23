# Segments Shopify, lot 1 : le volet Shopify et l'onglet Shopify de l'audience

Spec : [`docs/superpowers/specs/2026-11-21-segments-shopify-enrichis.md`](../specs/2026-11-21-segments-shopify-enrichis.md),
section « Filtres Shopify, mini-CRM et audience de campagne » et lot 1 de la feuille de route (ordre confirmé par
Julien le 2026-11-22).

Refactor de la console seulement. Aucun critère nouveau, aucune route, aucune migration : les trois critères déjà
livrés (commandes payées, dépense, dernière commande) changent de place, et l'audience d'une campagne gagne une entrée
« Shopify » qui montre la même liste filtrée.

- **`FiltresShopify`** (nouveau) : un volet repliable « Shopify » (`details` et `summary`, le patron de
  `VoletIntegration`), replié par défaut, ouvert dès qu'un critère Shopify est posé ou quand l'écran le force. Il porte
  les trois lignes de commandes et la phrase de suivi (depuis quand, remboursements non déduits, coupure).
- **`FiltresAchatsActivite`** ne garde que l'activité (actif, inactif). Elle marche sans boutique.
- **`ContactFilterPanel`** rend les deux, et reçoit `voletShopifyOuvert`. Pas de boutique : pas de volet (masqué, comme
  le bouton HubSpot), sauf un critère déjà posé, qui reste visible pour être retiré. API qui ne répond pas à
  `/contacts/segments` : ni l'un ni l'autre, comme aujourd'hui.
- **Audience** : `SourceAudience` gagne `shopify`. Le bouton « Shopify » (logo, `audience-source-shopify`) se place
  après HubSpot, n'apparaît que si `/contacts/segments` annonce une boutique (branchée ou coupée), reste cliquable une
  fois coupée (l'aide dit la date). Il montre `ListeDestinataires`, volet ouvert ; le compte et la création passent
  par le même chemin que « Liste de contacts » (`audienceParListe`). Les filtres restent d'un bouton à l'autre.
- **Brouillons** : la source `shopify` se relit ; une console plus ancienne la ramène sur `crm`, filtres intacts.

## Méthode de livraison

**En direct + une relecture indépendante en fin de lot**, parce que le lot ne déplace que des contrôles de la console,
sans critère, sans route ni migration : il est réversible au prochain push, et ses invariants (un critère posé reste
visible, rien n'est proposé sans annonce de l'API, la création ne lit que filtres et sélection) se vérifient par les
tests purs de `web/lib` et les e2e. Le chemin que la production emprunte, la cible d'une campagne, ne change pas de
calcul : la source `shopify` passe par la même ligne que `crm`. L'essai réel qui clôt : sur un espace de test avec une
boutique branchée, ouvrir le volet dans Contacts, poser « au moins 1 commande », puis dans une campagne passer de
« Liste de contacts » à « Shopify » et retour, et lire le même nombre au pied des deux.

## Tâches

1. `web/lib/audience.ts` : `shopify` dans `SourceAudience`, `audienceParListe` ; `campagne-brouillon.ts` relit
   `shopify` ; tests purs. Les clés du volet sont `CLES_COMMANDES`, déjà là : les lots suivants l'étendront.
2. `FiltresShopify.tsx`, `FiltresAchatsActivite.tsx` allégé, `ContactFilterPanel.tsx`, `ListeDestinataires.tsx`.
3. `EtapeAudience.tsx` (bouton `aria-pressed`) et un `LogoShopify` dans `LogosCanaux.tsx`.
4. E2E : `contact-filtre-achats.spec.ts` (volet replié, absent sans boutique, replier ne retire rien),
   `campagne-assistant-audience.spec.ts` (bouton présent ou absent, même compte, filtres gardés, brouillon repris qui
   ouvre le volet, corps de la création).
5. Aide : fiches FR et EN « Brancher ma boutique Shopify » (étape 10 et sa capture), « Importer mes contacts »,
   « Lancer une campagne », `npm run vitrine:aide`, `features.md` et empreintes, `documentation.md` ; `aide:charger`
   après le push.

## Déploiement

Console seule, publiée au push. Aucune migration, aucun déploiement de l'API : les clés envoyées sont celles d'avant.
