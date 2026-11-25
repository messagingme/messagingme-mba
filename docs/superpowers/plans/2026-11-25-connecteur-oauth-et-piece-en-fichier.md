# Connecteur : connexion par identifiant et mot de passe, et pièce envoyée en fichier (2026-11-25)

**Pourquoi.** Essai avec Everial (Wizidee, reconnaissance de pièces). Un scénario demande une photo de pièce
d'identité ou de justificatif de domicile, puis la transmet à leur API d'analyse. Leur API :

- n'accepte pas de lien (réponse d'Everial du 2026-11-25) : elle attend le fichier en `multipart/form-data`, champ
  `file` ;
- s'authentifie par un jeton Keycloak obtenu avec identifiant et mot de passe (`grant_type=password`,
  `client_id=api`), qui expire (`expires_in`).

Ce qui existe déjà (2026-11-02) : le bloc Question range une pièce sous forme de mention, et l'Appel API d'un scénario
envoie à la place un lien `/f/` valable 15 minutes. On garde ce mécanisme et on y ajoute l'envoi du fichier lui-même.

## Méthode de livraison

**Implémenteur par lot (moi) + une relecture indépendante du diff en fin de lot**, pas feature-loop : le chemin porte
un secret (mot de passe d'un système client) et une pièce d'identité, qui sont exactement les cas où un test écrit par
l'auteur ne suffit pas. Réversible (aucune donnée transformée, une colonne et deux CHECK élargis). Essai réel qui clôt
la feature : un scénario de la SANDBOX demande une photo, l'envoie à Wizidee, et la réponse de Wizidee se lit dans le
champ du contact (Julien envoie la photo depuis son téléphone).

## Lot 1 : la source se connecte par identifiant et mot de passe

- **Migration 0325** (`migration=avant`) : `auth_kind` accepte `oauth_password` ; colonne `auth_oauth jsonb` (adresse
  du jeton, `client_id`, identifiant, `scope`) ; le mot de passe va dans `auth_secret_enc`, chiffré comme les autres ;
  le CHECK `agent_tool_sources_auth_chk` exige secret ET `auth_oauth` pour ce mode. Même migration : `body_mode`
  accepte `formulaire` (lot 2), pour une seule migration avant le code.
- `src/agent/jeton-oauth.ts` : demande le jeton (formulaire `grant_type=password`), par le transport des connecteurs
  (mêmes gardes d'adresse publique, pas de redirection, lecture bornée). Cache en mémoire par source et par version de
  configuration, jusqu'à `expires_in` moins une marge ; une demande en vol par source ; un 401 ou 403 de l'API vide le
  cache. Le jeton et le mot de passe n'entrent dans aucun journal ni aucune erreur.
- Le résolveur HTTP et l'épreuve de source passent par lui. Les serveurs MCP refusent ce mode (route inchangée).
- Routes `agent-sources` : le mode et ses champs (adresse HTTPS publique pour le jeton), vue sans le mot de passe.
- Duplication d'espace : la colonne neuve suit.

## Lot 2 : une pièce part en fichier

- Corps « formulaire » (`multipart/form-data`) : lignes `cle`, `valeur`, case `fichier`. Une ligne `fichier` dont la
  valeur est le champ d'une pièce envoie le FICHIER (relu chez Meta, comme `/f/`), sinon l'appel est refusé.
- Seul l'Appel API d'un scénario reçoit la capacité de lire une pièce (`fichiers` requis dans l'appel, `null` pour
  l'agent IA, la poussée d'opt-out et le relais du MBA, qui refusent un connecteur à fichier). Chaque envoi est tracé
  au journal des actions comme un téléchargement par lien.
- Délai de 30 s et lecture de réponse jusqu'à 2 Mo pour un appel qui porte un fichier (une analyse de pièce prend
  plusieurs secondes et sa réponse est grosse) ; les autres appels ne changent pas.

## Lot 3 : la console

- Connecteurs API : le mode « Identifiant et mot de passe (OAuth) » à la création et à l'édition d'une source.
- Éditeur de requête : le corps « Formulaire (avec fichier) » et sa case par ligne.
- `features.md`, fiche d'aide des connecteurs si elle cite la section, `documentation.md`, journal.

## Déploiement

0325 seule d'abord (`migration=avant`, relue en base), puis l'API, puis la console (elle appelle des modes que
l'ancienne API refuserait).
