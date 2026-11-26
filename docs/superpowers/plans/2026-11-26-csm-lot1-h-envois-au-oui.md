# Lot 1 du CSM virtuel, lot H : les envois au oui (B8)

Source : le plan « Lot 1 : tout en outils » (https://claude.ai/artifact/LfwZTpZXFZ6sNALo6jsGAw), ligne B8 des briques
(« Campagnes, suppression de contacts, envoi individuel, envoi de modèle et de message par MCP : le code de confirmation
laisse place au oui, et l'ordre d'envoi s'enregistre avec lui ») et son critère (« Les campagnes, la suppression et les
envois refusent sans oui ; coupé juste après l'enregistrement de l'ordre, l'envoi part une seule fois au redémarrage, ou
son échec se voit ; après le préavis, l'ancien code n'est plus délivré »). Dépend de B2 (le oui de mise en ligne, en
production).

Décisions de Julien du 2026-11-26 : les réponses dans une conversation ouverte (`reply_in_open_window`, `send_message`)
partent directement, hors du oui, pour que l'assistant d'Inbox reste utilisable ; aucun préavis pour le code de
confirmation, qui disparaît au déploiement (mesuré en production en lecture seule : en 90 jours, seul l'espace SANDBOX
s'en est servi, deux codes le 20 octobre ; aucune écriture d'envoi par Claude depuis les traces de B0c).

## Le but

Que tout envoi de Claude à de vrais contacts hors d'une conversation ouverte, et toute suppression de contacts, parte
sur le oui d'un admin : un clic dans la console, enregistré côté serveur, valable pour ce qui lui a été montré, une
fois, 24 heures.

## Ce qui change

- Le oui de B2 (`mises_en_ligne`, `src/mise-en-ligne/mise-en-ligne.ts`) gagne des actions d'envoi, chacune SEULE dans
  sa mise en ligne : `campagne` (lancer, programmer ou reprendre une campagne préparée, par `lancerCampagne`, le chemin
  du bouton « Lancer »), `suppression` (effacer les contacts d'une sélection, le service de la suppression en masse),
  `modele` (un modèle à un contact) et `envoi_scenario` (un scénario à un contact), ces deux derniers par le cycle de
  l'API publique, avec une clé d'idempotence tirée de la mise en ligne. Le bouton nomme l'effet (« Envoyer à N
  contacts », « Programmer l'envoi à N contacts », « Reprendre l'envoi à N contacts », « Supprimer N contacts »,
  « Envoyer à 1 contact », « Lancer le scénario pour 1 contact »). Le clic relit l'état montré (son empreinte) et
  refuse ce qui a changé.
- Les outils : `prepare_campaign`, `control_campaign` (`prepare_resume`) et `prepare_contacts_deletion` rendent le
  bouton (l'adresse de la page du oui) au lieu d'un code ; `launch_campaign` et `delete_contacts` prennent
  l'identifiant du oui au lieu du code : ils rendent le résultat du clic, ou reprennent un envoi coupé, jamais sans le
  clic ; `send_template_to_contact` et `send_scenario_to_contact` préparent leur envoi et rendent le bouton au lieu
  d'envoyer, et `get_go_live` (ouvert à toutes les offres) en rend le résultat. Le code de confirmation n'est plus émis ni accepté ;
  `campagne_confirmations` reste la marque d'un brouillon de l'assistant.
- La page du oui (`web/app/mise-en-ligne/page.tsx`) montre ces actions et leur résultat. 🔴 Elle s'ouvre à la Free
  (`MODULES_OUVERTS_AU_FREE`, `ECRANS_FREE`) : la suppression de contacts par Claude est le seul chemin d'une Free qui
  dépasse sa limite, et la passer au oui sur une page fermée la bloquerait. Une publication de scénario y reste refusée
  par l'offre, au relevé comme au clic.
- La table de parité : `POST /campaigns/:campaignId/recipients/:recipientId/retry` (le renvoi à un destinataire en
  échec) passe à B10 : aucun outil ne liste encore les destinataires en échec d'une campagne (`GET
  /campaigns/:campaignId`, en partie), sans quoi un outil de renvoi n'a rien à viser. Il ira au oui, comme tout envoi.

## Exécution et reprise

Celle de B2 : le clic accepte (l'ordre est la liste des actions gardées, enregistrée à la préparation, acceptée par le
clic en une écriture) puis exécute sous bail. Une coupure laisse la mise en ligne « interrompue », la page le dit, et
un nouveau clic, ou l'outil qui prend l'identifiant du oui, reprend après le dernier résultat écrit. Chaque action se
rejoue sans double effet : une campagne déjà partie depuis le clic rend « déjà lancée » ; une suppression ne retrouve
que ce qui reste ; un envoi individuel réutilise sa clé d'idempotence, et la reprise rend le résultat du premier.

## Livraisons

1. Les campagnes (lancement, programmation, reprise) et la suppression de contacts : le code disparaît.
2. Les envois de modèle et de scénario à un contact (le renvoi à un destinataire en échec passe à B10).

Chacune a sa relecture indépendante, son déploiement et la note de version du plugin.

## Livraison 2 : les envois à une personne

- `send_template_to_contact` et `send_scenario_to_contact` préparent un oui (actions `modele` et `envoi_scenario`) au
  lieu d'envoyer. La préparation juge la cible comme l'envoi la jugera, sans rien écrire (`jugerCible`, les pièces du
  cycle de `POST /v1/sends` : le modèle approuvé chez Meta et ses variables, le scénario qui peut partir, la catégorie
  de Meta, qui entre dans l'empreinte), et refuse une personne qui a dit STOP ou bloquée. Un scénario se garde par son
  identifiant et son code `scn_`, que l'envoi vise (renommé avant le clic, il est refusé, comme tout ce qui a changé).
  Préparé deux fois, le même envoi rend le même bouton.
- Le clic envoie par le cycle de `POST /v1/sends`, le consentement déclaré au nom de la personne qui a préparé (le
  récapitulatif le dit à l'admin qui clique), sous une clé d'idempotence tirée du oui (`oui:<id>:<rang>`) : une reprise
  retrouve le rapport de l'envoi fait, et une clé encore « en cours » est une panne, que le prochain clic reprend.
  🔴 La clé vit 24 heures : une reprise plus de 23 heures après le clic est refusée (`trop_tard`), elle pourrait
  envoyer une seconde fois.
- 🔴 Aucune donnée de contact DURABLE dans le oui : il garde ce que l'outil a donné (le numéro, ou la fiche), les
  valeurs des variables (souvent un nom) et le numéro masqué que le récapitulatif montre, le temps du clic seulement.
  Ils s'effacent, avec le récapitulatif et l'empreinte, dans la requête qui ferme le oui (`terminer`), et par un
  balayage horaire du worker quand le bouton a expiré ou que le clic est trop ancien pour reprendre (`expurgerEchues`).
  Garder le numéro plutôt que créer la fiche à la préparation : un bouton jamais cliqué ne crée rien, et n'entame pas
  la limite de contacts de l'offre.
- Un envoi parti sur le clic est un envoi de la console : hors du quota du jour de l'API (qui se compte par clé), et le
  plafond coûteux de l'espace se compte à la préparation, comme une campagne de l'assistant. `quotaEnvois` et
  `envoyerModele` quittent les dépendances du MCP : aucun outil n'envoie plus de modèle.
- `get_go_live` s'ouvre à toutes les offres : un modèle envoyé à une personne, ouvert à toutes, s'y lit (`send_id`).
- Le renvoi à un destinataire en échec passe à B10 (voir « Ce qui change »).

## Tests

- Chaque outil refuse sans oui ; le clic envoie ce qui a été montré, une fois ; un état changé depuis la préparation
  est refusé au clic ; une coupure après l'acceptation se reprend sans double envoi (campagne, suppression, envoi
  individuel par sa clé), ou se lit « interrompue » ; un code n'est plus ni émis ni accepté ; la page montre chaque
  action ; la parité et les montages de test.

## Déploiement

Aucune migration : les actions vivent dans `mises_en_ligne.actions` (jsonb, sans contrainte sur leur forme). Le plugin
se republie après l'API, sa version montée, et sa note dit que le code disparaît. La page de la console et l'API se
tolèrent dans les deux ordres (aucune route neuve ; la page ancienne ne voit pas d'action neuve tant que l'API ancienne
n'en produit pas).

## Méthode de livraison

Implémenteur par livraison, puis la relecture indépendante du diff avant chaque déploiement : la production emprunte
ces chemins (des envois à de vrais contacts, une suppression irréversible) et ils portent des invariants invisibles
(l'empreinte de ce qui a été montré, l'usage unique du clic, la reprise sans double envoi). Les critères se testent
(refus sans oui, un seul envoi après une coupure) ; l'essai réel qui clôt chaque livraison : sur la SANDBOX, une
campagne à un seul contact (le numéro d'essai de Julien) préparée par Claude et envoyée sur le clic, puis un modèle
envoyé à ce contact sur le clic.
