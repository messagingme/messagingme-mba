# Lot 3a de l'aide à la connexion : l'arbre, partout (la branche de la carte)

**But :** le même arbre du numéro partout (vitrine, console, skill du plugin, consignes de Claude, fiches), avec trois
changements décidés par Julien.
1. **Le cas 4** : après « Oui, j'ai l'application WhatsApp Business », une question de plus : « Voulez-vous utiliser
   ce numéro-là ? ». « Non » mène à un numéro de chez nous, relié par la fenêtre de Meta (mode `fourni`).
2. **WhatsApp ordinaire** : un numéro qui sert dans WhatsApp n'est plus envoyé vers un autre numéro. Il passe dans
   l'application WhatsApp Business, qui reprend ce numéro et ses conversations, puis on garde l'application.
3. **« Je mets un moyen de paiement (Visa / Mastercard) sur mon compte Meta Business »** remplace « Ma carte chez
   Meta », avec deux liens :
   - « Pourquoi un moyen de paiement ? », vers `la-fenetre-de-24-heures` (FR) ou `the-24-hour-window` (EN) ;
   - « Qu'est-ce qu'un compte Meta Business ? », vers `ce-qu-il-faut-chez-meta` (FR) ou `what-you-need-at-meta` (EN).

Le Crédit WhatsApp reste tel qu'il est : sa branche en libre-service part avec l'ouverture de la vente (lot 3v).

**Spec :** [docs/superpowers/specs/2026-11-08-aide-connexion-numero-design.md](../specs/2026-11-08-aide-connexion-numero-design.md),
« Lot 3 », « Ajouts de Julien (2026-11-09) » (ajout 2), « Décisions de Julien (2026-11-10) ».

## Méthode de livraison

Implémenteur (cette session) puis une relecture indépendante du diff, parce que l'arbre est un écran d'onboarding
que chaque nouvel espace emprunte, et que sa parité tient à quatre endroits écrits à part. Les tests de parité
existants, étendus, gardent les quatre ; chacun est vérifié dans les deux sens par mutation.

**Essai réel :** dérouler les cas du tunnel dans `/demarrer/`, dans la console (« Connecter WhatsApp ») et avec Claude
(plugin à jour), et comparer les feuilles :
- le cas 4 (Oui à l'application, Non au numéro) ;
- WhatsApp ordinaire (Non à l'application, un numéro qui sert dans WhatsApp) ;
- le compte Meta Business, avec un numéro qui sert dans WhatsApp ;
- la carte : les deux liens.

## Ce qui change

1. **Vitrine** (`scripts/vitrine/tunnel-textes.ts`, FR et EN, puis `npm run vitrine:cas`) :
   - une question `meme-numero` entre `application` (Oui) et `garder` ;
   - une issue `autre-numero` : le numéro fourni par la fenêtre de Meta, avec la consigne « Phone call » du lot 2c, et
     sa demande à coller ;
   - les textes de WhatsApp ordinaire dans `api`, `garder` et `telecharger` ;
   - la carte de `paiement` et ses deux liens.
2. **Console** (`web/lib/questions-numero.ts`, `ParcoursNumero.tsx`, `QuiRegleMeta.tsx`) : la même question, la même
   issue (son « Non » ouvre le numéro fourni, déjà là), les mêmes textes. Les adresses des deux fiches vont dans
   `web/lib/partage/aide-connexion.ts`, comme celles du lot 1.
3. **Plugin** : l'arbre de la skill `mise-en-service` ; la phrase de la FAQ (`scripts/plugin/faq.ts`, puis
   `npm run plugin:generer`) ; le plugin monte d'une version.
4. **Fiches** : `connecter-mon-numero-whatsapp` (FR, EN) dit le nouveau libellé, puis `npm run vitrine:aide` ; et
   `features.md` si une section citée bouge (empreintes). Sa capture n° 2 (la page « Connecter WhatsApp ») montre la
   phrase « garder » du numéro API, qui change : elle se refait (`aide:captures`, son seul scénario).
5. **Ce qu'il faut chez Meta, 3e condition** (`web/lib/partage/etapes-meta.ts`) : « Pas de numéro libre ? Nous vous en
   fournissons un » envoyait vers un numéro fourni tout numéro qui sert dans WhatsApp. La phrase de WhatsApp ordinaire
   y vit désormais (la console la reprend), et le numéro fourni ne vaut que sans numéro. La lisent l'encadré « Avant de
   commencer » de la console, Claude (MCP, mode `apporte`), la FAQ, le guide Meta de la vitrine et la fiche
   `ce-qu-il-faut-chez-meta` (FR, EN), et `features.md` le dit.

## Tests attendus

- **`tests/questions-numero-vitrine.test.ts`** : la console reprend au mot près la nouvelle question, la nouvelle issue,
  les textes de WhatsApp ordinaire et la carte.
- **Un test de l'arbre** : `application` Oui mène à `meme-numero` ; Oui y mène à `garder`, Non à `autre-numero` ; plus
  aucun texte n'envoie un numéro qui sert dans WhatsApp vers un autre numéro ; la carte porte ses deux liens, et leurs
  adresses existent (`tests/aide-connexion-adresses.test.ts`).
- **Les tests de la skill, de la FAQ et des pages de la vitrine** : générées égales à leur source.
- **Un e2e de la console** : le cas 4 jusqu'au numéro fourni.

## Ordre de déploiement

Un commit. Vercel publie la console et la vitrine. Ensuite :
1. l'API, si les consignes de Claude changent : elles changent, par la 3e condition chez Meta (`PREREQUIS_META`, que
   `src/mcp/outils-numero.ts` donne en mode `apporte`). Déploiement sans migration, approuvé par Julien ;
2. `aide:charger` par Julien, si la fiche change : deux fiches changent ; il se lance avec l'image de ce déploiement ;
3. la publication du plugin par Julien, après l'API.
