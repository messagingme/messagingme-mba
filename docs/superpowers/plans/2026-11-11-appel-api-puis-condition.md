# Une Condition après un Appel API lit la valeur d'AVANT l'appel (2026-11-11)

Révélé par l'essai réel du champ JSON (Julien, scénario « testJSON ») : la fiche portait bien la réponse, « Blue Frock »
compris, et la Condition « panier contient Blue Frock » a pris « Sinon ».

## La cause

`walk` (`src/workflow/engine.ts`) parcourt d'un trait les blocs qui n'attendent rien et décide les Conditions sur une
COPIE de travail du contexte ; l'exécuteur n'applique les actions (donc ne fait l'appel) qu'après. Un bloc Action se
répercute sur la copie (`applyToWork`), un Appel API ou une Fonction JS ne le peut pas : sa valeur n'existe qu'une fois
l'appel parti. Toute Condition qui les suit dans le même enchaînement lit la valeur d'avant, y compris « le champ est
vide » que l'aide du bloc conseille. Défaut d'origine du bloc, pas du champ JSON.

## Le correctif

- `walk` reçoit une option `attendreLesAppels` : après un Appel API ou une Fonction JS qui RANGE un champ, s'il reste un
  bloc à suivre, la marche s'arrête en sommeil sur ce bloc, `resumeInMs` minimal. L'exécuteur applique les actions
  (l'appel part, le champ s'écrit), le réveil court (`reveilCourt`) reprend au bloc suivant (`resume` : `nextNode`), sur un
  contexte relu (`buildCtx`). Aucun nouvel état de parcours : c'est le chemin d'un bloc Attente en secondes.
- L'option n'est posée que par `walkResolved`, la marche des trois chemins qui savent reprendre un parcours endormi
  (démarrage, réveil, avance). Gardent l'ancien comportement : le bloc lancé par un agent IA (`envoyerBlocDepuisAgent`,
  qui refuse un sommeil), `blocSeul` (un bloc seul n'a pas de suite), et la suite « Puis, sans attendre » d'un message
  rapide (son repos est ignoré : s'y arrêter perdrait le reste de la suite en silence).
- Un Appel API qui pousse (sans champ) ou un bloc en fin de chaîne ne s'arrête pas : il n'y a rien à relire.
- **Relecture, deux rouges corrigés** : (1) un démarrage de MASSE (campagne, workflow HubSpot, bloc de l'agent de Meta,
  `publieLesEtiquettes` faux) ne s'endort pas, sa reprise perdrait les variables du modèle d'ouverture, son exemption
  d'accord marketing et la règle « aucun chemin de masse n'émet » : il garde la marche d'avant (limite écrite au
  manuel) ; (2) pas d'arrêt quand la suite revient sur l'appel sans traverser un bloc qui attend
  (`revientSansAttente`), sinon chaque réveil rappellerait le client sans fin.

## Tests

Moteur : arrêt après Appel API et Fonction JS avec champ et suite ; pas d'arrêt sans l'option, sans champ, sans suite,
en « sans attendre ». Exécuteur : Appel API puis Condition sur le champ rangé, la branche « vraie » prise à la reprise ;
vu ROUGE sur le code d'avant. Aucun test existant n'attendait la suite d'un appel dans le même tour : les 56 fichiers
`workflow-*` passent tels quels, d'où le défaut resté invisible. Suite racine entière, lint, auto-attaque ; pas d'e2e : le moteur
n'est pas dans la console (aucun import de `src/workflow/engine.ts` sous `web/`).

## Ordre de déploiement

Serveur seul, `migration=aucune`. Aucune console. Un parcours endormi par l'ancien code n'existe pas sur un bloc Appel
API : le nouveau seul en crée, et l'ancien code saurait le reprendre (le chemin de reprise est celui de l'Attente).

## Méthode de livraison

**En direct, puis UNE relecture indépendante du diff**, parce que le changement tient en une option du moteur posée par
un seul appelant et réutilise un état de parcours existant, mais que l'exécuteur est un chemin chaud de la production :
la relecture cherche ce que le sommeil change ailleurs (statistiques par bloc, message reçu pendant le sommeil,
campagnes de masse). Essai réel qui clôt : Julien renvoie « blue » depuis son téléphone sur le scénario « testJSON », et
reçoit le message de la branche « contient Blue Frock ».
