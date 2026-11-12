# Le bloc « Envoyer au MBA » ne transmet plus un message déjà répondu (2026-11-12)

## Le constat, mesuré

Sur MUTAC, agent de Meta en audience EVERYONE et routage des modèles marketing et utility vers Messaging Me (réglé par
Julien dans Meta Business Suite) : les appuis sur les boutons de modèle nous arrivent, le scénario enchaîne. Mais le
message du client que nous avons reçu, transmis à l'agent par le bloc (`agent_event` `message_sans_suite`), échoue
chez Meta ; la question suivante du client arrive directement à l'agent, qui y répond (essais de 17 h 29 et 17 h 34).
La parade de scénario : « posez-nous votre question », puis « Envoyer au MBA », sans bloc Question. Elle exige que le
bloc ne transmette pas le dernier message du client quand le scénario lui a déjà répondu : sinon l'événement échoue et
le filet passe la conversation à l'équipe 45 s plus tard, avant même la question.

## Ce que fait le lot

- `PgInboxStore.saisieSansReponse` : le dernier message de la conversation s'il vient du client (texte non vide, hors
  réaction), sinon `null`.
- `confierAuMbaParLeBloc` (`src/workflow/wiring.ts`) la lit au lieu de `derniereSaisieDuContact` : rien à transmettre,
  aucun événement (`prevenir` se tait sur un texte vide), l'agent répond à la question suivante.

## Tests attendus

- Le vrai câblage (`tests/bloc-mba-saisie.test.ts`) : rien de transmis quand le scénario a parlé en dernier, le
  message transmis sinon ; vérifié dans les deux sens (l'ancienne lecture remise, les deux cas rougissent).
- La requête en base (`tests/integration/saisie-sans-reponse.integration.test.ts`, en CI) : dernier message du client,
  scénario qui a parlé après, réaction, appui sans texte, autre espace.

## Ordre de déploiement

Aucune migration ; l'API et le worker partent ensemble.

## Méthode de livraison

**Implémenteur par lot, puis revue humaine du diff**, parce que le bloc est un chemin que la production emprunte (la
remise d'une conversation à l'agent de Meta). Une relecture indépendante en fin de lot.

Essai réel qui clôt le lot : sur MUTAC, le scénario « devis » modifié (bouton « Vous avez une question », message « je
vous écoute », « Envoyer au MBA ») ; la question tapée ensuite reçoit la réponse de l'agent, et la conversation ne part
pas dans « À traiter ».
