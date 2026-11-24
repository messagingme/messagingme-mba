# Guide de démarrage de la console (cadrage du 2026-11-24)

Remplace la fenêtre de bienvenue actuelle (`web/components/AccueilBienvenue.tsx`, plan `2026-11-19-accueil-pro`),
jugée trop pauvre par Julien : un titre, une phrase, quatre boutons gris. Le but : une fenêtre qui donne envie, puis
un guide qui ACCOMPAGNE la personne sur l'écran où elle arrive, au lieu de la lâcher après le clic.

## Ce qui existe et se réutilise

- **Le déclencheur** : `/me` rend `accueilAFaire` tant que `users.accueil_choisi_le` est vide (0303). Il ne dépend PAS
  du numéro WhatsApp : chaque membre voit la fenêtre à sa première connexion, tant qu'il n'a pas choisi.
- **La visite** (`VisiteConsole.tsx`) : cadre posé sur un élément mesuré, sans voile plein écran. C'est le moteur de
  surlignage des parcours, à étendre (cible sur plusieurs pages, flèche).
- **L'état de mise en service** (`src/mcp/mise-en-service.ts`, `lireMiseEnService`) : ce qui est fait et l'étape
  suivante, déjà calculés pour le MCP. Il coche la checklist.
- **Les films d'aide** (`site/films/aide-*`, avec miniature `.webp`) : 8 aujourd'hui, aucun de bienvenue.

## Décisions de Julien (2026-11-24)

1. **Fenêtre de bienvenue** plus visuelle : une miniature du film de bienvenue en tête, puis une **checklist** qui se
   coche toute seule d'après l'état réel de l'espace. Elle peut revenir tant que tout n'est pas fait.
2. **Ordre de la checklist** :
   0. Relier le numéro WhatsApp (seulement s'il ne l'est pas) ;
   1. Brancher Shopify, HubSpot ou un autre outil ;
   2. Premier scénario OU première campagne avec import de contacts ;
   3. Un agent IA qui répond aux questions des clients ;
   4. Poser la bulle WhatsApp sur le site.
3. **Le guide qui suit** : une **carte flottante** ancrée en haut à droite, repliable en pastille. Elle donne l'étape
   en cours en une phrase, encadre ou fléche le bouton à cliquer, et la console reste cliquable dessous.
4. **Avancement** : la carte avance seule quand elle constate que c'est fait (page atteinte, panneau déplié, objet
   créé), et garde un « Suivant » si la détection rate.
5. **Parcours guidés en V1** : agent IA, Shopify, campagne avec import de contacts, premier scénario. La bulle
   WhatsApp et HubSpot viennent ensuite (ils restent dans la checklist, en lien simple).
6. **Retour au guide** : une carte « Bien démarrer, N étapes sur 5 » en haut de l'Accueil tant que tout n'est pas
   fait, et une entrée dans le bouton d'aide pour le rouvrir à tout moment.
7. **Film de bienvenue** : un film motion d'environ 60 s, fait dans `~/engageme-motion` comme les films d'aide (écran
   d'ordinateur dans une fenêtre de navigateur), FR et EN.
8. **Maquette cliquable d'abord**, validée par Julien avant le code.

## Exemple de parcours : l'agent IA

1. Accueil : la carte dit « Ouvrez AI Agent » et encadre l'entrée du menu.
2. Liste des agents : « Créez votre agent », cadre sur « Nouvel agent ».
3. Écran de l'agent : « Restez dans Construire en parlant : décrivez votre activité, l'assistant écrit l'agent. Les
   autres onglets serviront à l'améliorer plus tard. » Cadre sur l'onglet, puis sur la zone de saisie.
4. Agent prêt : « Faites-le répondre à vos clients », cadre sur le choix du répondeur.

## Points ouverts (au plan)

- Les cibles des parcours sont des `data-guide` posés sur les écrans : un test doit refuser une étape dont la cible
  n'existe plus (même famille que `etapesVisibles`).
- L'état de mise en service est lu côté console par une route d'espace (classe `tenant`), à poser AVANT l'écran qui
  l'appelle (règle « un écran qui appelle une route neuve casse dès le push »).
- Les rôles : un membre non administrateur garde le film et la visite, sans les parcours qui mènent à des écrans
  d'administrateur.
- Les textes de la carte vouvoient, comme toute la console (`tests/web-vouvoiement.test.ts`).

## Méthode de livraison

Implémenteur par lot et revue humaine du diff : l'écran est visuel (pas pour feature-loop) et touche la coquille
partagée (`AppShell`) ; l'essai réel qui clôt la feature est un compte neuf qui suit le parcours agent IA de bout en
bout dans la console de production.
