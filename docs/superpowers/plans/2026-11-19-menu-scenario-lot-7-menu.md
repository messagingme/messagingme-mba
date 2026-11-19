# Menu « Scénario », lot 7 : le menu (Builder, et Automation par source)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** la barre de la console montre « Scénario » à la place d'« Automation », avec **Builder** (l'actuel Contenu >
Scénario, déplacé) et **Automation**, rangée par source : **Shopify** (visible avec une boutique), **HubSpot** (visible
avec un portail HubSpot relié, l'écran du lot 6) et **Autres** (les automations d'aujourd'hui). L'aide et ses captures
suivent.

**Architecture:** console seulement, aucune route d'API. La barre (`web/lib/nav.ts`) gagne un groupe `scenario` à la place
de l'entrée `automations` ; l'entrée `workflows` quitte Contenu pour ce groupe, sous le libellé « Builder » ; un sous-groupe
`automation` porte `automations-shopify` (`/automations/shopify`), `automations-hubspot` (`/automations/hubspot`) et
`automations` (`/automations`, libellé « Autres »). Les adresses existantes ne bougent pas (`/workflows`, `/automations`) :
un favori ou un lien d'e-mail continue d'ouvrir la même page. `navSansShopify` retire aussi `automations-shopify` sans
boutique ; une nouvelle `navSansHubspot` retire `automations-hubspot` sans portail. `AppShell` lit déjà la boutique ; le
portail HubSpot se lit sur `account-status` (`hubspotPortal.connected`), déjà servi.

**Tech Stack:** Next.js (console), vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-18-menu-scenario-automations-design.md`, § 2 (l'arbre du menu), § 2.1 à 2.3,
§ 5.9 (aide, `aide:carte`). Le plan du lot 5, A8 (« le lot 7 la range sous Scénario »).

## Méthode de livraison

**Implémenteur** (un agent, dans sa propre copie détachée), puis UNE relecture indépendante : le lot ne touche aucun
chemin que la production emprunte pour envoyer, ses critères sont vérifiables par des tests (l'arbre de la barre, les
filtres, les pages, `aide:carte`), il est réversible d'un retour de commit, et son seul invariant invisible est la chaîne
des clés de la barre (`cheminDeNav`, `ongletDeLaPage`, `accesAutorise`), que `web/lib/nav.test.ts` tient. Il se pousse
APRÈS le lot 6, dont il range l'écran HubSpot. Il se clôt par l'essai réel décrit plus bas, dans la console de la
SANDBOX.

## Tâches

1. **La barre** (`web/lib/nav.ts`, `web/lib/nav.test.ts`) : le groupe `scenario` (icône `flow`), ses entrées et leur
   ordre (Builder, puis Automation : Shopify, HubSpot, Autres) ; `workflows` sort de Contenu ; `navSansShopify` et
   `navSansHubspot` (toute profondeur, comme aujourd'hui) ; les rôles : les nouvelles clés suivent `automations` dans
   `ECRANS_ENCADREMENT` et `accesAutorise` ; `fonction: 'scenarios'` sur Builder comme aujourd'hui. Tests : l'arbre,
   les deux filtres (avec et sans), `cheminDeNav` et `groupesAOuvrir` pour chaque nouvelle clé, `ongletDeLaPage`.
2. **Les pages** : `web/app/automations/shopify/page.tsx` (la section `AutomationsShopify`), `web/app/automations/hubspot/page.tsx`
   (la section HubSpot du lot 6), `/automations` ne garde que les Autres ; chaque page déclare sa clé de barre. Les liens
   qui menaient à `/automations` pour Shopify ou HubSpot (`ReglageShopify.tsx`, `ReglageHubspot.tsx`, l'écran Automation)
   mènent à leur page. E2E : `web/e2e/shopify.spec.ts` et l'e2e HubSpot du lot 6 sur leurs nouvelles adresses, un e2e de la
   barre (Scénario ouvert, ses entrées, Shopify absent sans boutique).
3. **L'aide** : chaque fiche qui nomme le menu (« menu Automation », « menu Scénario », grep sur `docs/aide/fiches`) dit
   « Scénario > Builder » ou « Scénario > Automation > Shopify / HubSpot / Autres », français et anglais (`traduit_de`) ;
   les empreintes restent justes (`tests/aide-proposer.test.ts`) ; `npm run aide:carte` (barre modifiée) ;
   `npm run vitrine:aide` ; les captures de la console qui montrent la barre se refont (`npm run aide:captures` sur un port
   libre, puis le webp) ; `features.md` dit le nouveau chemin.
4. **Vérifier** : `npm test` et `npm run typecheck` à la racine, `npx vitest run`, `npx tsc --noEmit` et `npm run lint`
   dans `web/`, les e2e touchés sur le build de production (port libre, jamais 3000).

## Déploiement

Console seulement : publiée par Vercel au push, APRÈS celui du lot 6 (son écran HubSpot). Puis `aide:charger` par Julien
(fiches changées). Aucune migration, aucun déploiement de l'API.

## Essai réel

Dans la console de la SANDBOX : la barre montre Scénario > Builder et Scénario > Automation > Shopify (la boutique de
développement est branchée) ; HubSpot apparaît une fois le portail de test relié ; « Ouvrir le scénario » d'une
automation Shopify ouvre le builder avec « Scénario > Builder » éclairé. Numéro libre dans `docs/prive/ESSAIS-REELS.md`.
