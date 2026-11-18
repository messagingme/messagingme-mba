---
description: Le bloc Appel API d'un scénario WhatsApp : jouer un appel de Tools > Connecteurs API, ranger sa réponse dans un champ, traiter l'échec.
ecran: workflows
source_section: Automatisations (menu « Scénario », ex-« Flow »)
source_empreinte: a3025d
publique: oui
rubrique: construire-un-scenario
rang: 16
---
# Le bloc Appel API

Joue un appel que vous avez mis au point dans Tools > Connecteurs API, et range sa réponse dans un champ du contact.

**1. Choisir l'appel.** Cliquez sur le bloc, puis choisissez dans « Quel appel ».

- Le bloc est grisé dans la palette tant qu'aucun appel n'est déclaré dans Tools > Connecteurs API.
- Un appel utilisé par un bloc ne se supprime pas : retirez-le d'abord du bloc.
- Chaque appel s'écrit dans le journal des appels.

**2. Choisir où ranger la réponse.** « Où ranger la réponse », facultatif.

- Sans champ, l'appel envoie seulement : la réponse n'est pas lue, et le parcours continue qu'il réussisse ou non.
- Un champ ordinaire reçoit les champs de réponse déclarés sur l'appel ; un champ JSON reçoit la réponse entière,
  16 Ko au plus.
- Si l'appel échoue (10 secondes sans réponse, réponse de plus de 64 Ko, système injoignable, information
  manquante, refus du système), le champ est vidé : branchez une Condition « ce champ est vide ».
- Un fichier reçu par un bloc Question part vers votre système par un lien valable 15 minutes.

**3. Relier la suite.** Le bloc n'a qu'un point, en bas : la suite part tout de suite.

- Une Condition placée juste après lit la réponse qui vient d'arriver, sauf dans une campagne ou derrière « Puis, sans
  attendre » : elle lit alors l'ancienne valeur. Placez une Attente entre les deux, après le premier template.
- L'appel part même pour un contact qui a dit STOP.
- Il peut suivre la sortie « Puis, sans attendre » d'un message rapide.
- Relié à rien, le parcours s'arrête là.
