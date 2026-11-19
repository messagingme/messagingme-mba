# Le code d'espace, visible (design court, 2026-11-19)

## Intention

Identifier un espace sans ambiguïté, à l'oral comme à l'écrit. Aujourd'hui un espace n'a qu'un UUID illisible et un
nom libre, non unique (plusieurs « Test », plusieurs « SANDBOX »). Le client doit pouvoir lire son code dans sa console
et le donner au support ; nous devons le retrouver dans `/ops` et le lire dans nos alertes sans ouvrir la base.

## Ce qui existe déjà

`tenants.public_code` (migration 0031) : 6 caractères base32 Crockford minuscules (sans i, l, o, u), dérivés de l'UUID
par `deriveTenantCode` (`src/ids/code.ts`), donc déterministes et immuables, uniques par index partiel. Posé à la
création (`creerEspaceEtAdmin`, `src/user/store.pg.ts`). Il est déjà la racine de chaque identifiant public de l'API
(`scn_k7m2p3_…`, `usr_k7m2p3_…`). Il n'est affiché nulle part. La colonne est nullable et le script de remplissage
d'origine (`db/backfill-codes.ts`) n'existe plus : un espace ancien peut ne pas en avoir.

## Objectifs

- La **console** montre le code de l'espace courant dans le menu du compte, avec un bouton copier, et celui de
  chaque espace de la liste.
- **`/ops`** affiche le code dans la liste des espaces, et un champ filtre la liste sur le nom OU le code (sans casse).
- Les **alertes Telegram** qui citent un espace par son UUID le citent aussi par « Nom (code) ».

## Non-objectifs

- Le MCP et le plugin (`list_workspaces`, sélecteur) : un lot suivant si le besoin se confirme.
- Stripe (métadonnées, factures).
- Un nouveau code en chiffres seuls : écarté, on montre celui qui existe.

## Anti-objectifs (ce qui ferait échouer le lot même s'il marche)

- 🔴 **Le code n'ouvre rien.** Aucune route ne l'accepte à la place du `tenantId`, aucune garde ne le lit. 6
  caractères s'énumèrent : c'est un repère, pas une clé. L'isolation reste sur l'UUID et `etapeEspace`.
- Deux codes pour un espace : celui de la console doit être, caractère pour caractère, celui des identifiants de l'API.
- Une alerte perdue ou retardée par l'enrichissement : s'il échoue, le texte part tel quel.

## Approches retenues (choix de Julien, 2026-11-19)

**Quel code.** Afficher `public_code` (retenu) plutôt que créer un code numérique à 6 chiffres : zéro migration de
schéma et un seul code partout ; le numérique aurait fait deux codes par espace.

**Garantir sa présence.** Remplir les vides une fois (retenu) : une sonde compte en production les espaces sans code,
un script idempotent les remplit par `deriveTenantCode(id)` ; tout affichage se rabat sur ce même calcul quand la
colonne est vide (fonction pure, aucune écriture à la lecture). Écarté : une migration NOT NULL, qui obligeait à
réécrire la création d'espace (le code y est posé par une seconde requête, après l'insertion) et à migrer après le
déploiement, pour un gain faible.

**Alertes.** Enrichissement central à l'envoi (retenu) : tout UUID du texte qui est celui d'un espace reçoit
« Nom (code) », en UNE lecture en base ; un UUID qui n'est pas un espace reste tel quel ; une lecture qui échoue ou
traîne laisse partir le texte inchangé. Écarté : réécrire une vingtaine de messages un par un, que la prochaine alerte
oublierait.

## Décisions laissées au constructeur, et mes appels

- **Forme affichée** (mon appel) : minuscules, telle que stockée, identique à l'API. Pas de majuscules ni de groupes.
- **Libellé** : « Code d'espace » / « Workspace code » (i18n de la console, vouvoiement).
- **Câblage de l'enrichissement** : un module dédié (`src/ops/`) qui prend le pool et la fonction d'envoi ; il est
  branché là où `src/index.ts` et `src/worker.ts` fabriquent leurs `alerter`. Ces deux fichiers sont du câblage
  partagé : annonce aux sessions voisines avant de les éditer, commit en plomberie.
- **Plafond de la lecture d'enrichissement** : court (de l'ordre de la seconde), à fixer dans le plan.
- Les e-mails internes : il n'en existe pas en dehors de Telegram (l'annonce d'un espace neuf y passe déjà) ; rien à
  faire de plus.

## Essai réel qui clôt

Ouvrir la console sur un vrai espace, lire et copier le code dans le menu, le retrouver par le filtre de `/ops`, et
recevoir une alerte réelle (création d'un espace d'essai) qui porte « Nom (code) ».
