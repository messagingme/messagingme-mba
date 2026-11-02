# L'Entreprise illimitée et le suivi des crédits

> Décisions de Julien du 2026-11-02 : « quand on est en Entreprise, on a un crédit infini, car on le fait payer d'une
> autre façon ; le rechargement de crédit et la défalcation ne concernent que les offres Pro et Business », et « je veux
> qu'on ait un endroit où on suit l'évolution du crédit ». Puis, en réponse aux questions : l'illimité vaut pour **les
> deux crédits** (IA et WhatsApp), le suivi est **pour le client et pour nous**, et l'onglet montre **une courbe au-dessus
> de l'historique**. Elles complètent la spec du Crédit WhatsApp (`2026-10-30-credit-whatsapp-design.md`, § « L'Entreprise »)
> et changent le Crédit IA de l'Entreprise.

## La règle

| Offre | Crédit IA | Crédit WhatsApp |
|---|---|---|
| Free | prépayé, comme aujourd'hui | jamais |
| Pro, Business | prépayé : achat, débit, arrêt à zéro | prépayé : achat, débit, arrêt à zéro |
| Entreprise | **illimité**, facturé au contrat | **illimité**, facturé au contrat |

- **Illimité veut dire** : aucun achat, aucune recharge, aucun arrêt à zéro, et **le solde ne bouge jamais** (décision).
  Chaque consommation reste écrite, au prix client (commission de l'espace comprise), pour la facture que Julien fait à
  la main chaque mois.
- **Toute Entreprise, sans interrupteur** (décision) : l'illimité se lit sur l'offre (`offre_de_l_espace = 'entreprise'`),
  jamais sur un réglage par espace. L'interrupteur `openBarWhatsapp` de `/ops` disparaît : l'oublier coupait un client
  Entreprise à zéro, réponses comprises.
- **Le solde d'avant reste intact** : un espace qui devient Entreprise garde son solde prépayé sans y toucher, et s'il
  quitte l'Entreprise il le retrouve tel quel, sans dette. Aujourd'hui l'open bar fait passer le solde en négatif : la
  sortie bloquerait tout d'un coup.
- **Un plafond de sécurité pour l'IA de l'Entreprise** (choix de Claude, retenu avec « les deux ») : l'IA se paie à
  Vercel au fil de l'eau, donc un agent qui boucle nous coûterait sans limite. Un plafond par mois et par espace,
  **100 € par défaut** (valeur à confirmer par Julien), réglable dans `/ops`. Alerte Telegram à Julien à 80 % puis à
  100 %, une fois chacune par mois et par espace. Au plafond, l'IA de l'espace s'arrête comme un crédit vide aujourd'hui,
  et l'écran dit « plafond de sécurité du mois atteint, contactez-nous ». La clé Vercel de l'espace suit : son plafond se
  remonte chaque heure à la consommation, plus un mois de plafond. Mesuré le 2026-11-02 : le plus gros mois d'IA d'un
  espace est de 1,38 € (la SANDBOX, en octobre).
- **Le WhatsApp de l'Entreprise reste sans plafond** (décision de la spec du 2026-10-30, inchangée).

## Le suivi (décisions)

- **Le client, dans Paramètres > Offre** : chaque onglet (Crédit IA, Crédit WhatsApp) montre une **courbe sur 90 jours**
  au-dessus de l'historique jour par jour qui existe déjà. En Pro et en Business, la courbe est le solde en fin de
  journée ; en Entreprise, la consommation de chaque jour, et l'onglet affiche « Illimité » à la place du solde, sans
  bouton d'achat, avec la consommation du mois. L'onglet Crédit WhatsApp s'ouvre à l'Entreprise dès qu'un de ses numéros
  est sur la ligne (en v1, il lui était fermé).
- **Nous, dans `/ops`** : une vue « Crédits », un espace par ligne : l'offre, pour chaque crédit le solde (ou « Illimité »)
  et la consommation du mois en cours et du mois précédent, et pour l'Entreprise le **montant à facturer** (IA plus
  WhatsApp, au prix client) et où en est son plafond IA. Un espace s'ouvre sur les mêmes courbes que le client.
- La vue du mois prévue au lot 3 du plan du Crédit WhatsApp (régularisation, envois hors Messaging Me) viendra s'ajouter
  à celle-ci, au lieu d'en être une seconde.

## Ce qui ne change pas

La Free et son Crédit IA prépayé ; le Pro et le Business ; les deux assistants de configuration, sur notre clé, avec leur
propre plafond ; la commission de chaque offre ; le crédit offert au premier numéro (en Entreprise, il tombe dans un
solde que l'espace n'use pas, sans dommage).

## Mesuré en production (lecture seule, 2026-11-02)

8 espaces Entreprise (6 avec un numéro), 3 en Free, **aucun Pro, aucun Business**. Aucun numéro sur la ligne, aucun solde
ni mouvement WhatsApp, l'interrupteur d'open bar coché nulle part : côté WhatsApp, la nouvelle règle ne touche personne.
Côté IA, elle touche les Entreprises qui consomment : Groupama PJ (solde 4,82 €, clé plafonnée à 5 €), la SANDBOX
(58,55 €), Messaging Me demo (9,87 €). L'essai du prépayé demande donc un espace de test passé en Business.
