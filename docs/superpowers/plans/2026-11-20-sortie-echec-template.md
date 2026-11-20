# Sortie « En cas d'échec » du bloc template d'un scénario

Demande de Julien, 2026-11-20 : un template envoyé par un scénario que Meta ne livre pas doit pouvoir partir par une
branche à lui (un RCS, un e-mail, une étiquette, l'équipe), comme le bloc « Message RCS » le fait déjà avec sa sortie
« Non joignable ». Échec de LIVRAISON seulement, jamais « livré mais pas lu ».

## Décisions (Julien, 2026-11-20)

1. **La suite attend « livré »** quand la sortie Échec est branchée, là où le template continuait sans attendre (agent
   de Meta actif ou parcours d'événement, sans bouton ni délai « pas de réponse ») : le parcours reste sur le bloc et
   repart par la suite à l'accusé `delivered` (ou `read`). Un téléphone éteint retarde la suite. Partout ailleurs le
   template attendait déjà la réponse du contact, et ça ne change pas. Sortie non branchée : rien ne change.
2. **Seuls les échecs de Meta** prennent la sortie : le statut `failed` (131026, 131049 et les autres échecs de livraison
   arrivent par lui). ⚠️ Écart au cadrage, relevé à l'implémentation : un refus SYNCHRONE de Meta à l'envoi (modèle en
   pause, variables refusées) ne la prend pas. C'est une erreur de configuration, pas un échec de livraison, et il garde
   son comportement : parcours clos, conversation à l'équipe. Un STOP, un accord marketing absent, une fenêtre fermée, un
   Crédit WhatsApp à sec restent des règles, comme aujourd'hui.
3. **Jamais deux rattrapages pour un même échec.** Mesuré à l'implémentation : un message est SOIT un message de campagne
   (sa chaîne de repli le rattrape), SOIT l'envoi d'un bloc de scénario (sa sortie le rattrape). Le seul recouvrement est
   le parcours d'événement (Shopify, HubSpot), né sur le template de sa campagne, qui n'a pas de chaîne mais une
   politique de réessai : quand le scénario prend la sortie, le destinataire sort des relances (`cederAuScenario`), AVANT
   que la branche n'envoie.

## Tâches

**Lot 1, serveur** (rien de visible tant que la console ne propose pas la sortie)
- Poignée `non_livre` (`SORTIE_NON_LIVRE`, `web/lib/partage/sortie-non-livre.ts`) sur le bloc `template`. 🔴 Invariant :
  AUCUN chemin de suite libre ne la prend (`nextNode`, `nextNodeHorsTimeout`) ; seul l'accusé `failed` y mène.
- `walk` : un template parti dont la sortie `failed` est branchée rend `waiting` (avec son délai s'il en a un).
- `executor` : deux méthodes publiques sur le modèle de `rcsUndeliverable` /
  `rcsDelivered` : `templateNonLivre(wamid)` et `templateLivre(wamid)`, qui retrouvent le bloc par `blocDuMessage` et
  n'agissent que si le parcours de ce contact attend sur CE bloc (rejeu sans effet, dédup `lastMessageId`).
  `templateLivre` n'avance que sans bouton et sans délai.
- `processStatuses` (`src/webhooks/delivery.ts`) : un puits de plus, best-effort, à côté de `clorePremierNonLivre`
  (vérifier que ce dernier ne clôt pas un parcours d'événement que la sortie Échec doit reprendre : la sortie passe avant).
- Campagne : `cederAuScenario` (`PgCampaignRepo`), appelée par le puits avant la branche (point 3).
- Tests (`tests/workflow-template-non-livre.test.ts`) : walk (attente, aucune suite libre par la sortie), executor (échec,
  rejeu, livré qui avance ou non, autre bloc, parcours d'événement), puits (cession avant la branche), ordre dans
  `processStatuses`.
- Aucune migration prévue.

**Lot 2, console, MCP, aide** (poussé APRÈS le déploiement du lot 1)
- Poignée rouge « En cas d'échec » sur le bloc template (`WorkflowNode.tsx`, `WorkflowConfigPanel.tsx`), comptée dans les
  mesures du bloc (`web/lib/mesures-scenario.ts`).
- MCP `create_scenario` / `update_scenario` : la poignée `non_livre` documentée ; catalogue et doc régénérés, plugin à monter.
- Aide : `bloc-envoi-template` (fiche publique : `vitrine:aide`, version `en/`, `aide:charger`), `features.md` et son
  empreinte dans le même commit.

🔴 **Ordre obligatoire** : le moteur en production prend aujourd'hui la PREMIÈRE arête hors `timeout` comme suite d'un
template. Une console qui laisserait brancher `non_livre` avant le lot 1 enverrait TOUS les contacts dans la branche
d'échec. La console part après le `up` de l'API.

## Méthode de livraison

Implémenteur par lot + revue humaine du diff, une relecture indépendante à la fin du lot 1 : le chemin est emprunté par
la production (statuts Meta, avance des parcours, bascule des campagnes) et porte un invariant invisible (aucune suite
libre par `non_livre`). L'essai réel sur la SANDBOX (section plus bas) clôt la feature : aucun test ne le remplace.

## Déploiement

Lot 1 : `deploy-scaleway.yml`, `migration=aucune`. Lot 2 : push de la console après le `up`, puis `aide:charger` et la
publication du plugin.

## Essai réel qui clôt la feature

Sur la SANDBOX, un scénario template → (Échec) e-mail, lancé vers un numéro sans WhatsApp : l'e-mail part et la frise du
contact le montre. Le même scénario vers le numéro d'essai de Julien : la suite part à l'accusé « livré », la branche
Échec ne part pas. Puis une campagne à chaîne de repli ouvrant ce scénario : un seul rattrapage, celui du scénario.

## Jaunes de la relecture du lot 1 (2026-11-20, aucun rouge), à traiter avec le lot 2

1. Un accusé traité AVANT que le parcours n'écrive son attente sur le bloc (quelques centaines de ms après l'envoi) est
   perdu : `failed` ne prend pas la branche, `delivered` laisse le parcours attendre. Piste : rejouer l'accusé quand une
   mesure `sent` existe sans parcours qui attend, depuis moins de quelques secondes.
2. `cederAuScenario` part avant l'avance ; une avance qui n'écrit pas (bail perdu, fil d'un opérateur) laisse le
   destinataire hors des relances sans branche d'échec. Ne céder qu'une fois l'avance écrite.
3. Miroirs console à aligner AVANT d'exposer la poignée : `web/lib/campaign-eligibility.ts` (première arête hors
   `timeout`) et `web/lib/partage/fenetre-scenario.ts` (la sortie lue comme une réponse du contact).
4. `envoyerBlocDepuisAgent` : un template à sortie branchée part sans parcours qui l'attende ; le refuser comme un bloc à
   délai.
5. Sortie débranchée entre l'envoi et l'accusé : le parcours qui attendait `delivered` n'avance plus.
6. `findWaitingSurBloc` ne vérifie pas que le parcours trouvé est celui du wamid (relance du même scénario, très rare).
7. `cederAuScenario` exige `retry_count = 0` : un destinataire déjà relancé une fois n'est pas cédé.
8. `envoiDuMessage` lit par identifiant Meta seul (même modèle que `recordStatusForMessage`) ; vérifier que le numéro du
   statut appartient à l'espace trouvé coûterait peu.
9. Tests : SQL de `cederAuScenario` et `envoiDuMessage` en intégration, câblage sur les deux files du worker, cas 1, 2, 5.
