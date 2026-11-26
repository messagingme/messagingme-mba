# Lot 1 du CSM virtuel, lot G : les prérequis (B7)

Source : le plan « Lot 1 : tout en outils » (https://claude.ai/artifact/LfwZTpZXFZ6sNALo6jsGAw), ligne B7 des briques
(« Lecture de l'état du compte, activation d'un numéro, outil Support avec contexte »), et les quatre adresses que la
table de parité range en B7 : `GET /account-status`, `POST /numero/code`, `POST /numero/activer`, `POST /support`. Suit
le pilote (B9, réussi le 2026-11-26).

## Le but

Que Claude lève les prérequis d'une mise en service sans renvoyer la personne à la console : lire l'état du compte
WhatsApp, faire envoyer le code de vérification d'un numéro relié et l'activer, écrire au Support avec le contexte de
l'espace.

## Ce qui change

- `get_account_status` (lecture, au nom d'une personne : la console réserve l'Accueil aux admins) : la lecture de l'Accueil (`GET /account-status`, le même service) : le nom affiché
  et son statut, la qualité, le palier d'envoi, la vérification d'entreprise, l'état de Marketing Messages, la
  pastille et sa raison.
- `request_number_code` (écriture, au nom d'une personne) : `demanderCodeNumero`, l'appel vocal par défaut, le SMS au
  choix ; la description dit le quota de Meta (10 demandes par 72 heures) et qu'un numéro déjà vérifié n'en demande pas.
- `activate_number` (écriture, au nom d'une personne) : `activerNumero` avec le code, la même trace `numero.active` que
  la console, aucune relance automatique.
- `contact_support` (écriture, au nom d'une personne) : `sendSupport`, l'adresse du compte en réponse (lue en base,
  jamais prise des arguments), le sujet et le message bornés comme la console, le plafond de la console (5 par minute
  et par personne), et le CONTEXTE de l'espace joint par le serveur (l'état de mise en service : offre, numéro, agents,
  répondeur, avertissements), jamais écrit par Claude.
- La table de parité : les quatre adresses passent aux outils.

## Câblage

Les dépendances des trois routes vivent aujourd'hui en littéraux dans l'appel à `buildServer` (`src/index.ts`) : le MCP
ne peut pas les réutiliser. Elles en sortent, telles quelles, en constantes nommées (`depsEmbeddedSignup`, `depsAccount`,
`depsSupport`), typées par le paramètre de `buildServer` pour garder leur typage contextuel ; la console et le MCP
reçoivent les mêmes objets, jamais une recopie. Le calcul de `GET /account-status` sort de la route dans une fonction exportée
du même fichier (`lireEtatDuCompte`, `src/http/account.ts`) que la route et l'outil appellent. Annoncé aux sessions voisines (fichier de câblage
partagé), appliqué par rejeu sur la version d'origin.

## Tests

- Chaque outil appelle le service de la console, et rien d'autre ; les écritures exigent une personne, laissent leur
  trace au journal d'audit (B0c) et rendent leur écran (B0b).
- Le code : l'appel vocal par défaut, le SMS accepté, toute autre méthode refusée ; un refus de Meta rendu avec sa cause.
- L'activation : le code transmis tel quel, la trace `numero.active`.
- Le Support : le contexte joint par le serveur, le plafond, l'adresse de réponse lue en base.
- La parité des adresses et des champs.

## Déploiement

Aucune migration : `migration=aucune`. Des outils neufs : le plugin se republie après l'API, sa version montée.

## Méthode de livraison

En direct, puis la relecture indépendante du lot avant le déploiement : chaque outil appelle le service que la console
appelle déjà (les mêmes gardes, le même quota de Meta), sans logique propre ; le seul effet neuf est un point d'entrée,
tenu par la parité et par les tests de garde (personne, trace, écran). L'essai réel qui clôt le lot : sur la SANDBOX,
`get_account_status` relu contre l'Accueil, et une demande au Support reçue par l'équipe avec son contexte ; le code et
l'activation se jouent sur le prochain numéro à activer (aucun espace de test n'en a besoin aujourd'hui), à défaut
par les tests.
