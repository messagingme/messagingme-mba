# La ligne de crédit prise depuis Claude Code ou Codex

Date : 2026-11-13. Cadré avec Julien en deux questions, après sa lecture de `/demarrer/` (formule Pro, « Claude Code ou
Codex », « Ligne de crédit » grisée qui renvoie à la console).

## Pourquoi

Un client en formule Pro qui démarre depuis Claude Code ou Codex ne peut pas choisir la ligne de crédit dans le guide :
la carte est grisée et l'envoie dans la console, alors que tout le reste du parcours se fait dans Claude. Rien ne
l'interdit : la carte date du lot 3v-2 (2026-11-11), quand la prise n'existait que dans la console. Il ne manque qu'un
outil MCP. Julien : « le mec paye son option sur Stripe, puis quand on a la confirmation on l'onboarde avec ou sans
numéro ».

**Le succès** : depuis Claude, un client Pro prend la formule, puis l'option, puis connecte son numéro (le sien ou un
numéro de chez nous) par la fenêtre du partenaire, sans carte chez Meta et sans passer par la console.

## Ce qui existe déjà (origin, 2026-11-13)

- `ouvrirOption` (`src/stripe/option-credit-whatsapp.ts`) et `POST /tenants/:tenantId/credit-whatsapp/option` : le
  Checkout de l'option, avec tous ses refus (`option_avec_le_pro`, `option_inutile`, `option_deja_prise`,
  `option_en_cours`, `formule_en_retard`, `option_apres_essai`, `numero_avec_carte`, `places_invalides`,
  `option_indisponible`).
- `subscribe_pro` (le lien du Pro), `start_whatsapp_connection` (ouvre la fenêtre du partenaire quand l'espace a droit à
  la ligne, `64c2db54`), `buy_credit` avec une offre `wa_*` (la recharge).
- L'option se prend dès que le Pro est actif, essai compris (`optionPrenable`), et se paie tout de suite.
- 🔴 Depuis `bd5e5222`, un numéro déjà connecté avec sa carte chez Meta ne prend plus l'option (`numero_avec_carte`) :
  **l'option se prend AVANT la connexion**, sinon le client reste à la carte.

## Objectifs

1. Un outil MCP qui fait prendre l'option depuis Claude.
2. Le guide `/demarrer/` (et sa version anglaise) : pour Pro + Claude Code, « Ligne de crédit » devient un vrai choix.
3. Les consignes de Claude (skill `mise-en-service` générée, `get_setup_state`) : l'ordre Pro, option, connexion,
   recharge.

## Hors sujet

- La console : son chemin ne change pas (Pro + console finit déjà dans la console).
- Free : la carte reste grisée, « Avec la formule Pro ».
- Business et Entreprise : l'option d'un Business se prend après sa confirmation par l'équipe, l'Entreprise l'a d'office.
- Un seul Checkout Pro + option : écarté (l'essai du Pro contre le paiement immédiat de l'option, et l'option a son
  propre abonnement Stripe en production).

## À ne pas faire

- Donner le lien de connexion avant que l'option soit payée : le numéro arriverait avec sa carte et ne pourrait plus
  passer sur la ligne.
- Nommer le partenaire, où que ce soit (dépôt public).
- Un texte du guide, de Claude ou de la console qui se contredit : les phrases partagées ont une source.

## Approches

| Approche | Ce qu'elle coûte | Retenue |
|---|---|---|
| **Outil MCP dédié** : Claude donne le lien Stripe de l'option après la confirmation du Pro, vérifie le paiement, puis donne le lien de connexion | un outil, ses tests, la publication du plugin | **Oui** (Julien) |
| Renvoi vers l'onglet de la console | aucun code serveur, mais le client sort de Claude au milieu du parcours | Non : c'est l'incohérence de départ |
| Un seul Checkout Pro + option dans `subscribe_pro` | refonte de l'abonnement de l'option | Non : voir « Hors sujet » |

## Ce que Julien a décidé

**L'outil MCP dédié** (question 1).

**La suite de l'arbre après « Ligne de crédit »** (question 2) : une phrase prévient que, avec la ligne de crédit, le
numéro quitte l'application WhatsApp Business. Puis une seule question, « Quel numéro ? », avec deux réponses, chacune
vers une issue « dites à Claude … » :

```
Qui paie vos messages à Meta ?
  → Ligne de crédit
     « Avec la ligne de crédit, votre numéro quitte l'application WhatsApp Business. »
Quel numéro ?
  → Un numéro à moi            → issue : dites à Claude …
  → Un numéro de chez vous     → issue : dites à Claude …
```

Pas de question sur le compte Meta Business : la fenêtre du partenaire le crée en chemin.

## Choix de Claude (à corriger si besoin)

- **Nom et forme de l'outil** : `take_credit_line`, paramètre `places` (nombre de numéros, 1 par défaut ; Claude le
  demande). Il appelle `ouvrirOption` avec l'origine `offre` et rend l'adresse du Checkout. Ses refus passent tels
  quels, avec leur code, comme ceux des autres outils.
- **Le retour de Stripe** se fait sur la page publique « paiement reçu » (`/paiement-recu?produit=option_credit_whatsapp`),
  comme `subscribe_pro` et `buy_credit` : la personne de Claude n'a pas forcément de session de console. `ouvrirOption`
  gagne l'origine `claude`, et la page, le texte « Retournez dans Claude : il vous confirme votre option… ».
  (Corrigé en écrivant le plan : le premier jet renvoyait sur l'onglet de la console.)
- **Savoir si l'option est payée** : appelé alors que l'option est déjà vivante, l'outil rend son état (active, nombre
  de places, ou paiement en attente) au lieu d'un refus nu. Claude n'a pas d'autre outil à apprendre.
- **L'issue « un numéro à moi »** rappelle qu'un numéro déjà connecté chez Meta avec sa carte ne passe pas sur la ligne
  (« écrivez au Support »), comme la consigne actuelle.
- **Les textes de l'issue** se construisent depuis la phrase du guide (`phraseGuide`), comme les autres issues.

## Laissé au constructeur

- L'endroit exact de l'outil (`outils-offre.ts` ou `outils-agent.ts`), sa fiche (`ficheOutilMcp`) et le catalogue
  publié (web/public et vitrine, cf. la règle du catalogue MCP).
- La place de la nouvelle question dans `tunnel-textes.ts` (fr et en, page anglaise générée) et ses tests
  (`vitrine-anglais`, `vitrine-entete`, profondeur de l'arbre).
- La consigne générée par `npm run plugin:generer`, la montée de version du plugin, et sa FAQ dans
  `scripts/plugin/faq.ts` si elle parle de la prise.

## Essai réel qui clôt le lot

Sur un espace de test en essai Pro, depuis Claude Desktop : formule Pro, puis option (un VRAI paiement de 30 € HT,
accord de Julien avant), puis connexion d'un numéro de chez nous par la fenêtre du partenaire, ligne posée seule, puis
une recharge `wa_*`. À ajouter à `docs/prive/ESSAIS-REELS.md`.
