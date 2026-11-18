---
description: Le bloc Agent IA d'un scénario WhatsApp : confier plusieurs échanges à un agent, relier ses règles d'arrêt et ses cinq sorties automatiques.
ecran: workflows
source_section: Automatisations (menu « Scénario », ex-« Flow »)
source_empreinte: a3025d
publique: oui
rubrique: construire-un-scenario
rang: 15
---
# Le bloc Agent IA

Confie la conversation à l'un de vos agents IA pour plusieurs échanges : le parcours reprend quand l'agent en sort, par
l'une de ses sorties.

**1. Choisir l'agent.** Cliquez sur le bloc, puis choisissez dans « Quel agent tient la conversation ».

- Seuls vos agents actifs sont proposés : le bloc est grisé dans la palette tant qu'aucun ne l'est. L'agent se
  construit dans le menu AI Agent ; sa fiche « Construire un agent IA » le détaille.
- Tant qu'il tient la conversation, chaque message du contact lui revient et le scénario n'avance pas. Une réaction
  (un emoji) ne le relance pas.
- Il écrit du texte libre : il ne part que dans une conversation ouverte. Un scénario qui commence par lui ne peut donc
  pas partir en campagne.
- Il ne peut pas suivre la sortie « Puis, sans attendre » d'un message rapide : le scénario ne se publie pas.

**2. Relier ses règles d'arrêt.** Chaque règle d'arrêt de l'agent devient une sortie du bloc, à son nom.

- Les règles se déclarent sur la fiche de l'agent, dans le menu AI Agent.
- Une règle reliée à rien a un point rouge : si l'agent en sort par là, la conversation passe à votre équipe.
- Si les règles de l'agent ont changé, « Mettre à jour les sorties du bloc » les reprend, sans toucher aux sorties
  automatiques.

**3. Relier les sorties automatiques.** Cinq sorties existent toujours : Pas de réponse, Aucune source, Transfert à un
humain, Plafond atteint, Échec technique.

- Pas de réponse : après le délai d'inactivité réglé sur la fiche de l'agent, 30 minutes par défaut.
- Aucune source : l'agent n'a rien trouvé dans sa base de connaissance.
- Plafond atteint : tours, actions ou budget épuisés, ou crédit IA indisponible.
- Échec technique : le modèle ou un envoi a échoué.
- Reliées à rien, aucun point rouge ne les signale : « Pas de réponse » arrête le parcours, les quatre autres passent
  la conversation à votre équipe.
