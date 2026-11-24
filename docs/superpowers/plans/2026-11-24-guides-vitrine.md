# Les guides de la vitrine (Ressources › Guides)

Source : une note d'implémentation proposée par un autre assistant (23 novembre 2026), relue avec Julien le 2026-11-24.

## Le but

Des ARTICLES lisibles sans fouiller l'aide, qui expliquent la logique d'ensemble (pourquoi, quand, que choisir, ce que
ça change). Le détail (étapes, écrans, réglages) reste dans les fiches d'aide : chaque guide renvoie vers sa fiche
pour le « comment », et ne recopie aucun pas-à-pas.

## Le menu

Ressources › Guides, un sous-menu en cascade à deux groupes titrés :
- « Guides d'intégration » : Salesforce, HubSpot, toutes les intégrations, développeurs ;
- « Tout comprendre : WhatsApp, RCS et SMS » : les articles, au fur et à mesure qu'ils sont en ligne ;
- « Tous les guides » vers le hub `/guides/`.

L'ancien lien direct « Guides d'intégration » (vers `/integrations/`) devient le premier groupe. Un guide n'entre dans
le menu, le hub et le pied de page que le jour où sa page est en ligne : jamais de lien vers une page absente.

## Les lots

1. Le menu, le hub `/guides/` et le comparatif RCS, SMS et WhatsApp (FR, et EN générée par les dictionnaires).
2. L'opt-in WhatsApp et la coexistence WhatsApp.
3. La page « API WhatsApp Business », dans le menu produit à côté de Développeurs.

## Ce qui est écarté de la note

- Les tableaux de prix remplis de « à confirmer » : un seul tarif de Meta, la réponse en France (déjà sur la page
  Salesforce), et un renvoi vers la grille de Meta pour le reste (décision D3 du plan SEO).
- Aucun chiffre non sourcé (part des téléphones compatibles RCS, délai de validation d'un agent RCS).
- Les compteurs écrits en dur (points d'API, outils MCP) sur la page API : tirés du code ou retirés.
- Les redirections de www (WordPress) et de messagingme.app : hors de ce dépôt.

## Tests

`tests/vitrine-entete.test.ts` (le menu Ressources à deux cascades), `vitrine-seo` (FAQ affichée égale au JSON-LD,
description sous 160 caractères), `vitrine-anglais` (pages EN égales à leur génération), sitemap.

## Méthode de livraison

En direct, sans agent : pages statiques de la vitrine, réversibles par un commit, que la production de l'API n'emprunte
pas ; chaque lot est montré à Julien en aperçu avant le push. L'essai réel qui clôt chaque lot : la page en ligne lue
par curl (200, H1 unique, JSON-LD valide sur validator.schema.org) et le menu ouvert dans un navigateur.
