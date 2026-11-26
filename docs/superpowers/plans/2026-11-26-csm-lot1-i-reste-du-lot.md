# Lot 1 du CSM virtuel, lot I : le reste du lot (B10)

Source : le plan « Lot 1 : tout en outils » (https://claude.ai/artifact/LfwZTpZXFZ6sNALo6jsGAw), ligne B10 des briques
(« Le reste du lot : les autres domaines, dans l'ordre que donnent les tests de parité », après B0 et B1). La liste de
travail est la table de parité (`tests/parite/adresses.ts`) : chaque `aFaire('B10', …)` y devient un outil, un geste
humain ou une exclusion écrite. Le lot 1 est fini quand il n'en reste aucun, ni aucun `reste` : le test qui l'exige
s'ajoute à la dernière livraison.

## Le but

Que tout ce que fait la console d'un espace Pro se fasse aussi depuis Claude, avec les garde-fous du lot : ce qui touche
de vrais contacts ou ne se défait pas part sur le oui d'un admin, un secret ne passe jamais par la conversation, un
paiement reste un geste de la personne.

## Les règles, communes à chaque livraison

- Une lecture est un outil de lecture (`mcp:read`), dans l'espace du jeton, sans donnée personnelle de plus que l'écran.
- Une écriture de réglage passe par le MÊME service que la route de la console (jamais une seconde implémentation), au nom
  d'une personne quand elle signe (`exigePersonne`), avec les acquis de B0 : l'écran de ce qu'elle a fait (B0b), sa trace
  au journal d'audit (B0c), un champ omis jamais touché (B0d), un refus dans le vocabulaire fermé (B0a).
- 🔴 Ce qui touche de vrais contacts ou ne se défait pas part sur le OUI d'un admin (une action de la mise en ligne, seule
  dans la sienne, comme B8) : la table le dit déjà route par route (« au clic »).
- 🔴 Un secret (mot de passe SMTP, clé d'un système ou d'un serveur MCP) ne passe jamais par la conversation : l'outil rend
  l'adresse de la page de la console où la personne le saisit, connectée.
- Un paiement rend le lien de Stripe (comme `buy_credit`) : la personne paie, jamais Claude.
- Chaque outil neuf entre au catalogue partagé (`web/lib/partage/catalogue-mcp.ts`), à sa famille, aux textes de la console
  (`web/lib/mcp-outils.ts`), à la documentation générée et aux tarifs (le nombre d'outils par offre de `site/tarifs/`).

## Livraisons, dans l'ordre de la table

1. **Contacts, champs et étiquettes** (23 routes) : lister, renommer et supprimer une étiquette (supprimer : au oui, elle
   quitte toutes les fiches) ; modifier un champ et savoir où il sert, le supprimer au oui (ses valeurs partent de toutes
   les fiches) ; l'aperçu et l'import de contacts (l'import au oui : il écrit des fiches et déclare leur consentement) ;
   les listes des désabonnés, des STOP ambigus et des bloqués ; l'historique, le bilan et l'export RGPD d'une fiche ;
   ajouter un contact ; l'appel de connecteur prévenu à chaque désabonnement (au oui : des données partent chez un tiers).
2. **L'Inbox** (15) : archiver, signaler, marquer urgent ou traité (et l'inverse), marquer lu ; lire le média d'un
   message ; transcrire un vocal (débité sur le crédit IA, comme la console) ; effacer les messages d'une conversation
   (au oui, ne se rattrape pas) ; qui peut prendre une conversation et le délai de reprise.
3. **L'agent IA** (15) : activer, désactiver, rattacher un outil, régler son autonomie (sur un appel `DELETE`, elle reste
   un clic dans la console), les outils encore offrables, le catalogue, les essais gardés, l'historique des réglages,
   modifier une fiche de connaissance, la mention d'IA, la promesse du transfert, la consommation et les messages d'un
   agent ; supprimer un agent (au oui).
4. **Les connecteurs API et MCP de l'agent** (19) : déclarer, modifier, éprouver et supprimer un système ou un serveur
   (sa clé se saisit sur la page de la console), déclarer, essayer et supprimer un appel, son risque compris ; l'aperçu,
   l'import et le réglage des outils d'un serveur MCP.
5. **Les campagnes** (10) : la liste et le statut ; les destinataires en échec d'une campagne et le renvoi à l'un d'eux
   (au oui, comme tout envoi) ; arrêter, archiver, désarchiver, supprimer ; les brouillons du formulaire de la console
   sont de la plomberie d'écran (exclue, raison écrite).
6. **L'offre, le compte, l'équipe et le numéro** (31) : les factures, le tarif réel, l'état de la ligne de crédit, le
   portail Stripe, les sièges et les packs (lien de paiement) ; résilier et démarrer le Pro avant la fin de l'essai (au
   oui) ; les applications autorisées, les clés d'API (révoquer : au oui), les préférences d'e-mails, le nom et le fuseau ;
   inviter, renommer, changer un rôle, désactiver, retirer un membre (retirer : au oui) ; délier et relier le numéro, ce
   que la déconnexion coupera, déconnecter (au oui, ne se rattrape pas), remplacer ou abandonner le numéro fourni.
7. **Le reste** (45) : l'e-mail (boîtes d'envoi, mot de passe sur la page de la console ; modèles d'e-mail), les webhooks
   entrants (brancher un scénario : au oui), les formulaires WhatsApp (publier chez Meta : au oui), les automations
   (allumer : au oui), les scénarios (dupliquer, la Fonction JS d'essai, le modèle d'un bloc, annuler une programmation),
   la médiathèque, les médias d'en-tête, les chiffres (audit, statistiques, ROI, joignabilité), les réglages lus, le
   rejeu des échecs des webhooks sortants, supprimer un widget ; puis le test qui exige qu'il ne reste ni `aFaire` ni
   `reste`.

Chaque livraison a sa relecture indépendante, ses mutations, son déploiement et la note de version du plugin.

## Tests

Par outil : son service est celui de la route (un faux qui compte les appels du service, pas une copie) ; ses refus ;
l'espace du jeton ; un outil au oui ne fait rien sans clic, et le clic exécute ce qui a été montré, une fois. La parité
des adresses et des champs (B1) passe chaque `aFaire` à son outil.

## Déploiement

Sans migration a priori (les outils appellent des services existants, et le oui garde ses actions dans
`mises_en_ligne.actions`). Une livraison qui en demanderait une le dit dans son plan.

## Méthode de livraison

Implémenteur par livraison, puis la relecture indépendante du diff avant chaque déploiement : la production emprunte ces
chemins (des écritures dans l'espace, des envois, des suppressions), et certains portent des invariants invisibles (le
oui, les secrets, l'offre). Les critères se testent (le service appelé, le refus sans clic) ; l'essai réel qui clôt chaque
livraison se joue sur la SANDBOX, par Claude, sur un geste de chaque famille, un geste au oui compris.
