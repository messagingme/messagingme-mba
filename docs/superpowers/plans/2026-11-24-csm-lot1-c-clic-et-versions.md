# Lot 1 du CSM virtuel, lot C : le clic de mise en ligne (B2) et les versions de scénario (B3)

Source : le plan « Lot 1 : tout en outils » (https://claude.ai/artifact/LfwZTpZXFZ6sNALo6jsGAw), sections « La mise en
ligne : un bouton qui vaut accord », « Brouillon et publication » et lignes B2, B3 des briques et des tests. Suit B0
(`2026-11-24-csm-lot1-b0-contrats.md`). Décisions de Julien du 24 novembre : un seul bouton qui nomme l'effet, le clic
d'un admin enregistré côté serveur vaut accord, il couvre publication et activation, expire en 24 heures s'il n'est pas
cliqué, sert une fois s'il l'est, l'ordre d'envoi s'enregistre avec lui ; un admin retiré ou un accès révoqué avant
l'exécution bloque ; ni accord par action, ni second facteur en plus, ni écran d'approbation séparé.

## Le but

Que le CSM (Claude Code d'abord) prépare une mise en ligne et la montre avec UN bouton qui dit ce qui va se passer
(« Activer sur WhatsApp »), qu'un admin connecté clique, et que le serveur exécute alors exactement ce qui a été montré,
une fois, jusqu'au bout. Et qu'une publication se défasse : chaque version publiée d'un scénario est gardée.

## B3 · Les versions de scénario (d'abord : B2 s'en sert pour restaurer)

- Migration : la table `workflow_versions` (espace, scénario, numéro croissant par scénario, graphe, date), clé étrangère
  en cascade sur `workflows` (la suppression d'un scénario ou d'un espace emporte ses versions).
- Un DÉCLENCHEUR sur `workflows` : toute écriture qui change `graph` (création publiée, publication de la console, de
  l'API, d'une ligne HubSpot ou Shopify, publication programmée) insère une version. Un chemin ajouté demain en crée
  une sans y penser, ce qu'un appel posé dans chaque chemin ne garantirait pas. L'auteur reste au journal d'audit
  (`workflow.published`), qui le connaît déjà : le déclencheur n'a pas de session.
- Ce qui fait une version (relevé en écrivant B3) : un graphe non vide qui diffère de la DERNIÈRE version autrement que
  par la disposition. L'enregistrement automatique de l'éditeur range un bloc déplacé DANS le graphe publié (`update`) :
  sans cette règle, chaque déplacement serait une version. La comparaison reprend `forme` du store, par une fonction SQL
  jumelle que le test de la migration tient égale.
- Lecture : la liste des versions d'un scénario et le graphe d'une version, scopés à l'espace (`src/workflow/versions.pg.ts`),
  servis par l'outil MCP `list_scenario_versions`, qui part AVEC les outils de B2 (une seule régénération du catalogue,
  de la doc de `web/public` et de la vitrine). Pas de route de console : aucun écran ne montre encore les versions, elle
  viendra avec lui. Restaurer = republier le graphe d'une version, donc une mise en ligne (B2).
- Le comportement des conversations en cours est relevé et figé par un test AVANT d'écrire la restauration (le plan :
  le répondeur fige sa version au départ, d'autres parcours relisent la version publiée) ; un contact arrêté sur un
  bloc qui n'existe plus sort du parcours vers l'équipe.

## B2 · Le clic de mise en ligne

- Migration : la table `mises_en_ligne` : espace, qui l'a préparée (la personne du jeton OAuth), le libellé du bouton,
  le récapitulatif montré, la liste ORDONNÉE des actions, l'empreinte de ce qui a été montré, l'état (`proposee`,
  `acceptee`, `en_cours`, `faite`, `echouee`, `expiree`), l'échéance (24 heures), qui a cliqué et quand, le résultat
  action par action.
- Le cœur (`src/mise-en-ligne/`) : `proposer` (vérifie chaque action sans rien écrire, calcule l'empreinte sur l'état
  relu en base, la même mise en forme canonique que `src/campaign/confirmation.ts`) ; `accepter` (une seule transition
  atomique `proposee -> acceptee`, sous l'échéance, pour un admin actif de l'espace, sur une empreinte inchangée,
  sinon un refus qui dit de remontrer) ; `executer` (les actions dans l'ordre, chacune idempotente, le résultat écrit
  au fur et à mesure : une reprise après coupure reprend où elle s'est arrêtée et rend le même résultat).
- Les actions du pilote : publier un scénario (son brouillon tel que montré, B4) et brancher le répondeur sur lui. Les
  autres (campagnes, suppression, envois) arrivent avec B8, sur le même cœur.
- L'exécution passe par une file pg-boss (`BASE_QUEUES`), avec un verrou d'exécution à bail, jeton de garde et relance
  (le modèle de `src/campaign/run-lock.ts`) : deux clics simultanés ne produisent qu'un effet, un worker tué ne bloque
  pas la mise en ligne.
- La console : une page `/mise-en-ligne?id=` (session d'admin, comme toute écriture) qui montre le récapitulatif et le
  bouton au libellé de l'effet, puis l'état jusqu'à « actif ». Aucune autre page : le bouton vit là où le CSM le montre.
- Les outils MCP : `propose_go_live` (écriture, une personne : rend le lien de la page et le libellé) et
  `get_go_live` (lecture : l'état et le résultat). Le CSM n'a AUCUN outil qui clique : le clic passe par la route de
  la console, que seule une session d'admin ouvre.
- Le journal d'audit : la proposition, le clic (qui, quand) et le résultat.

## Tests

- B3 : chaque publication crée une version, quel que soit le chemin (console, API, ligne Shopify, programmée) ; une
  restauration redonne exactement le graphe d'alors ; un contact arrêté sur un bloc disparu sort vers l'équipe ; la
  liste est scopée à l'espace.
- B2 : sans clic, avec un clic expiré, déjà utilisé, d'un autre espace, ou sur une empreinte qui a changé : refusé ;
  deux clics simultanés : un seul effet ; une exécution reprise rend le résultat déjà obtenu ; aucun outil MCP ne
  clique ; un admin retiré ou désactivé avant l'exécution la bloque ; tout part au journal.
- Les tests d'intégration (le verrou, la transition atomique, le déclencheur) tournent sur le Postgres jetable de la CI
  et, avant le push, sur le banc PGlite.

## Déploiement

Deux migrations qui CRÉENT des tables lues seulement par le code neuf : `migration=avant`, avant l'API. La page de la
console part APRÈS le déploiement de l'API qui sert ses routes (sinon elle appelle une route absente). Le plugin Claude
Code se republie après l'API, version montée, sa compétence apprenant le bouton.

## Méthode de livraison

Implémenteur par lot, puis une relecture indépendante du diff avant le déploiement, parce que la production emprunte ce
chemin (il publie des scénarios et, avec B8, il enverra), qu'il porte des invariants invisibles (une seule exécution,
une transition atomique, une empreinte qui dit « ce qui a été montré ») et deux migrations. L'essai réel qui clôt le
lot : sur l'espace de test, depuis Claude Code, un scénario préparé puis montré, le clic d'un admin dans la console, le
scénario publié et le répondeur branché ; un second clic sur le même lien refusé ; une version restaurée.
