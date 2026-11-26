# Un STOP fait taire l'agent de Meta (2026-11-26)

Le 2026-11-26 à 9 h 56, chez MUTAC, un contact a répondu « Stop » à la campagne `relance_pdf`. Nous l'avons désabonné,
mais Meta envoie les messages libres directement à son agent (routage Business Suite, audience « tout le monde ») :
l'agent lui a répondu en proposant un conseiller, sa consigne exigeant un conseiller à chaque réponse. À la main le même
jour : une consigne `arret-des-messages` sur les trois agents allumés (MUTAC, Groupama PJ, SANDBOX), vérifiée au bac à
sable, et leurs relances à 1 h coupées. Ce lot fait tenir la parade sans geste à la main. Décisions de Julien du même jour.

## Méthode de livraison

**Implémenteur par lot, une relecture du diff.** Les deux moitiés touchent des chemins que la production emprunte
(chaque allumage de l'agent, chaque STOP reçu) et une file neuve du worker ; les critères sont testables, mais l'effet
chez Meta ne se mesure qu'en réel (l'essai réel qui clôt le lot est en fin de plan).

## Tâches

1. **La consigne posée à l'allumage.** `src/mba/consigne-stop.ts` : le texte (`CONSIGNE_STOP`, celui des trois agents)
   et `poserConsigneStop` (liste les consignes de l'agent, crée la nôtre si aucune ne porte son titre ; ne lève jamais,
   rend son issue). Appelée par `ecrireRollout` après l'allumage réussi : les trois chemins qui allument l'agent
   (Accueil et « Qui répond au client », route `rollout`, assistant) y passent. La consigne reste celle de l'espace :
   modifiable, supprimable, reposée seulement au prochain allumage.
2. **Le retrait de la liste, 2 minutes après le STOP.** `src/mba/retrait-stop.ts` : `creerOptOutEntrant` (la fiche passe
   `opted_out`, puis, si le contact est sur la liste de l'agent, un job `mba-retrait-stop` part dans 2 minutes, le temps
   que l'agent envoie sa confirmation) et le traitement du job (`retirer`). Les deux câblages du STOP du worker (files
   `webhook` et `application-entrant`) passent par la même fonction. Sans effet en audience « tout le monde », où seule la
   consigne joue.

## Tests

- Consigne : posée quand absente, rien quand présente (titre insensible à la casse), aucun appel sans `agent_id`, échec
  journalisé sans lever ; `ecrireRollout` la pose après le PUT d'allumage, jamais à l'extinction ni sur un allumage refusé.
- Retrait : fiche écrite d'abord ; job programmé à +2 min seulement si le contact est sur la liste ; une panne du
  programme n'empêche pas le désabonnement ; job illisible ignoré ; le job retire.
- `tests/queue-names.test.ts` (file neuve dans `BASE_QUEUES` et sa cadence).

## Déploiement

API et workers, `migration=aucune`. Après : `audience-mba` et les journaux du worker sans erreur, puis l'essai réel.

## Essai réel qui clôt le lot

Sur la SANDBOX (audience « tout le monde », consigne déjà posée) : rien à attendre du retrait. Le retrait se juge sur un
contact confié à l'agent en audience « liste » : depuis le +33633921577, sur un espace en mode liste, « Stop » ; la
confirmation doit arriver, puis, 2 minutes après, le journal du worker dit le retrait et la ligne `mba_liste` disparaît.
La consigne se juge au prochain allumage d'un agent (journal « consigne STOP posée »).
