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
  du bouton « Lancer »), `renvoi` (renvoyer à un destinataire en échec de variable, le chemin de la console),
  `suppression` (effacer les contacts d'une sélection, le service de la suppression en masse), `modele` (un modèle à un
  contact) et `envoi_scenario` (un scénario à un contact), ces deux derniers par le cycle de l'API publique, avec une
  clé d'idempotence tirée de la mise en ligne. Le bouton nomme l'effet (« Envoyer à N contacts », « Programmer l'envoi
  à N contacts », « Reprendre l'envoi à N contacts », « Supprimer N contacts », « Envoyer le modèle à … »). Le clic
  relit l'état montré (son empreinte) et refuse ce qui a changé.
- Les outils : `prepare_campaign`, `control_campaign` (`prepare_resume`) et `prepare_contacts_deletion` rendent le
  bouton (l'adresse de la page du oui) au lieu d'un code ; `launch_campaign` et `delete_contacts` prennent
  l'identifiant du oui au lieu du code : ils rendent le résultat du clic, ou reprennent un envoi coupé, jamais sans le
  clic ; un outil neuf prépare le renvoi à un destinataire ; `send_template_to_contact` et `send_scenario_to_contact`
  préparent leur envoi et rendent le bouton au lieu d'envoyer. Le code de confirmation n'est plus émis ni accepté ;
  `campagne_confirmations` reste la marque d'un brouillon de l'assistant.
- La page du oui (`web/app/mise-en-ligne/page.tsx`) montre ces actions et leur résultat. 🔴 Elle s'ouvre à la Free
  (`MODULES_OUVERTS_AU_FREE`, `ECRANS_FREE`) : la suppression de contacts par Claude est le seul chemin d'une Free qui
  dépasse sa limite, et la passer au oui sur une page fermée la bloquerait. Une publication de scénario y reste refusée
  par l'offre, au relevé comme au clic.
- La table de parité : `POST /campaigns/:campaignId/recipients/:recipientId/retry` passe à l'outil du renvoi.

## Exécution et reprise

Celle de B2 : le clic accepte (l'ordre est la liste des actions gardées, enregistrée à la préparation, acceptée par le
clic en une écriture) puis exécute sous bail. Une coupure laisse la mise en ligne « interrompue », la page le dit, et
un nouveau clic, ou l'outil qui prend l'identifiant du oui, reprend après le dernier résultat écrit. Chaque action se
rejoue sans double effet : une campagne déjà partie depuis le clic rend « déjà lancée » ; une suppression ne retrouve
que ce qui reste ; un envoi individuel réutilise sa clé d'idempotence, et la reprise rend le résultat du premier.

## Livraisons

1. Les campagnes (lancement, programmation, reprise) et la suppression de contacts : le code disparaît.
2. Les envois de modèle et de scénario à un contact, et le renvoi à un destinataire en échec.

Chacune a sa relecture indépendante, son déploiement et la note de version du plugin.

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
