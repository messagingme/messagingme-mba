# L'arbre du numéro sans l'application, et la marketplace en HTTPS (2026-11-12)

**But :** un plugin propre avant les vidéos du lot 6 (Julien, 2026-11-12). Deux changements :

1. **Sans compte Meta Business et sans l'application WhatsApp Business, on ne propose plus l'application** : un numéro API
   direct, le compte Meta Business créé en chemin par la fenêtre de Meta. Son numéro s'il est libre (mode `apporte`),
   sinon un numéro fourni par la fenêtre de Meta (mode `fourni`). Un numéro qui sert dans WhatsApp, l'application
   ordinaire, passe dans WhatsApp Business puis se garde (mode `coexistence`, la phrase `WHATSAPP_ORDINAIRE`). Le numéro
   fourni mis DANS l'application (mode `fourni_application`, parcours C) sort de l'arbre ; les espaces déjà reliés ainsi
   continuent de marcher. Décisions de Julien du 2026-11-12, en réponse à ses essais du soir : « si le mec l'a pas, c'est
   plus simple de lui dire de faire de l'API si on crée le BM à la volée ».
2. **La marketplace du plugin s'ajoute par l'adresse HTTPS complète** (`https://github.com/messagingme/messagingme-plugin.git`) :
   l'adresse courte fait cloner en SSH, qui échoue sans clé GitHub (mesuré sur un PC neuf le 2026-11-11). Claude Code et
   Codex l'acceptent (mesuré).

**Spec :** [docs/superpowers/specs/2026-11-08-aide-connexion-numero-design.md](../specs/2026-11-08-aide-connexion-numero-design.md),
dont l'arbre change ; le parcours Claude Desktop (troisième demande de Julien) attend sa vidéo et fera un lot à part.

## Méthode de livraison

En direct, une relecture indépendante du diff : des textes et un arbre de questions, réversibles, tenus égaux par les tests
de parité (console, vitrine, plugin, consignes du serveur) ; les consignes du serveur MCP sont un chemin que la production
emprunte, d'où la relecture et le déploiement de l'API dans la foulée du push.

**Essai réel :** sur un espace Free sans numéro, `/messagingme:demarrer` répondu « pas de compte Meta Business, pas
d'application, pas de numéro » mène à un numéro fourni par la fenêtre de Meta, sans jamais proposer de télécharger
l'application ; la vidéo 2 du lot 6 le filme, compte Meta Business créé en chemin.

## Ce qui change

1. **L'arbre** (`web/lib/questions-numero.ts`, `scripts/vitrine/tunnel-textes.ts`, la skill `mise-en-service`, la console,
   le guide de la vitrine, les consignes de `src/mcp/outils-numero.ts`) : après « Non » à l'application, la question du
   numéro libre, puis le numéro API ; plus d'issue « téléchargez l'application » ni de numéro fourni dans l'application.
2. **Les commandes** (`COMMANDES_PLUGIN`, `COMMANDES_CODEX`, `web/lib/demarrer.ts`) en HTTPS, et tout ce qui les montre
   (vitrine, README du plugin, doc de la console), tenu par `tests/plugin.test.ts`.
3. **Les fiches et la doc** : le guide du numéro, la FAQ du plugin, `features.md`, la spec.
4. **Le plugin** : version montée, publié par Julien après le déploiement de l'API.

## Ordre de déploiement

1. Le push : la console et la vitrine par Vercel.
2. L'API, sans migration (les consignes du serveur MCP).
3. Julien : la publication du plugin, puis `aide:charger` si une fiche a bougé.
