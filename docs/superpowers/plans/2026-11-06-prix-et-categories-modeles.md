# Le prix et la catégorie des modèles, dits par Claude (2026-11-06)

Vécu par Johan, bêta-testeur, le 2026-11-06 : « c'est quoi le tarif Meta actuel pour chaque message welcome envoyé ?
C'est gratuit car inclus dans l'offre Free ? » ; Claude « n'a pas su répondre ». Demande de Julien : que Claude réponde
(qui paie, où mettre la carte), dise le prix, et apporte une expertise utility contre marketing quand il soumet un modèle.

## Ce que la lecture a établi

1. **Qui paie et où mettre la carte : déjà dans la FAQ du plugin** (`scripts/plugin/faq.ts`, « Pourquoi Meta me demande
   une carte »). Ce qui manque, c'est le chiffre : la FAQ et la skill `regles-whatsapp` interdisent tout prix et renvoient
   à la grille de Meta.
2. **Le serveur a déjà la grille de Meta en euros**, par marché, catégorie et palier (`grilles_meta`, chargée dans
   `/ops` pour le Crédit WhatsApp, en vigueur depuis le 2026-10-01 en production). Elle change chaque trimestre : un
   chiffre écrit dans une skill serait faux au trimestre suivant, un chiffre lu dans la grille ne l'est pas.
3. **Les règles de Meta sur les catégories** (pages officielles relues le 2026-11-06 : `updates-to-pricing/new-template-
   guidelines`, `templates/template-categorization`) : utility = non promotionnel ET propre à une commande, un compte,
   une demande de la personne (ou une alerte essentielle) ; un contenu mêlé ou flou est marketing ; une relance de panier
   est marketing ; depuis le 2025-04-09, un utility jugé marketing est APPROUVÉ en marketing (et non refusé), révisable
   60 jours depuis le Gestionnaire WhatsApp ; un abus répété de l'utility est sanctionné (débit limité, tous les utility
   passés en marketing) ; un code à usage unique ne part que par un modèle d'authentification.
4. **La formule Pro et l'option Crédit WhatsApp restent dehors** : l'option n'est pas en vente, et le lot B du Crédit
   WhatsApp (une autre session) pose la question « Qui paie vos messages à Meta ? » dans le guide du numéro.

## Tâches

1. `src/mcp/prix-meta.ts` : `prixMetaFrance(grille)`, les tarifs de base de Meta pour la France (marketing, utility,
   authentification, service), en euros HT par message livré, avec la date de la grille ; `null` sans grille ou sans
   tarif français (jamais le tarif d'un autre marché sous le nom de la France).
2. `DepsModelesMcp.grilleMeta()` (une ligne de câblage dans `src/index.ts`, la grille du Crédit WhatsApp).
   `list_templates` rend `prix_meta` ; `create_template` rend le prix de SA catégorie. Une grille illisible ne fait
   échouer aucun des deux (`null`, journalisé). Les descriptions des outils ne changent pas (recopiées dans trois
   fichiers générés).
3. Plugin : `regles-whatsapp` porte les règles des catégories et la conduite avant `create_template` (la catégorie
   choisie et pourquoi, le prix, ce que Meta vérifiera, la version utility quand le besoin s'y prête) ; la FAQ dit que
   Claude donne le prix en vigueur et pose une question « Utility ou marketing ? » (régénérée par `npm run
   plugin:generer`, donc les deux pages Développeurs de la vitrine) ; `mise-en-service` lève l'interdit sur un prix lu
   par un outil ; `plugin.json` 0.3.26.
4. Tests : `prixMetaFrance` (la table, le refus d'un autre marché, sans grille) ; les deux outils (le prix rendu, la
   catégorie de la création, une grille en panne). Dans les deux sens : la catégorie échangée, le test doit échouer.
5. Doc : `documentation.md` (les outils de modèles), le journal, `todo.md` (la formule Pro et l'option, après la vente).

## Ordre de déploiement

API (`migration=aucune`), puis la publication du plugin : publiée avant, la skill annoncerait un `prix_meta` absent.

## Méthode de livraison

En direct (moi), puis UNE relecture indépendante en fin de lot, parce que le changement est petit (un module pur, deux
sorties d'outils, des textes de skill) et ses critères mécaniquement testables, mais qu'il fait dire un prix à des
clients : un chiffre faux ou mal étiqueté (un marché pour un autre, le prix de Meta pris pour le nôtre) serait un
montant faux.

Essai réel qui clôt le lot : dans Claude Code, après la publication du plugin, demander « combien coûte un message de
bienvenue ? », puis faire créer un message de bienvenue promotionnel et une confirmation de commande : Claude doit dire
la catégorie, pourquoi, le prix de la grille en vigueur pour la France, et ce que Meta pourra reclasser ; la catégorie
rendue par Meta après sa revue doit être celle que Claude a annoncée.
