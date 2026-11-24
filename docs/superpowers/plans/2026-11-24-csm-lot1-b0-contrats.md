# Lot 1 du CSM virtuel, brique B0 : les contrats partagés des outils MCP

Source : le plan « Lot 1 : tout en outils » (https://claude.ai/artifact/LfwZTpZXFZ6sNALo6jsGAw), lignes B0 des briques et
des tests, et « Les propriétés que chaque outil doit avoir ». Suit la brique B1 (`2026-11-24-csm-lot1-b1-parite.md`).

## Le but

Qu'un agent qui pilote par outils (Claude Code aujourd'hui, le CSM virtuel demain) sache quoi faire d'un refus selon sa
cause, emmène le client sur ce qui vient d'être fait, réponde à « qui a changé ça ? », et ne crée jamais un champ
fantôme sur une faute de frappe. Rien de cela n'existe aujourd'hui : un refus d'outil est une phrase (`RefusOutil`, 165
sites dans `src/mcp`), le statut d'un refus métier se perd dans `valeurOuRefus`, aucun résultat ne donne l'adresse de
son écran, et le journal d'audit ne voit presque aucune écriture faite par MCP.

## Les sous-lots, chacun se déploie seul

### B0a · Les refus codés

- `RefusOutil` prend un code OBLIGATOIRE, dans un vocabulaire fermé aligné sur celui de `/v1` (`invalid_args`,
  `not_found`, `conflict`, `plan_required`, `forbidden`, `rate_limited`, `window_closed`, `opted_out`, `too_large`,
  `unavailable`...), et en option le délai avant de réessayer et le geste à proposer au client. Le type force les 165
  sites : aucun refus ne part sans sa cause.
- `valeurOuRefus` traduit le statut d'une issue métier (400, 402, 404, 409...) par UNE table exhaustive sur `StatutRefus`.
- Le serveur rend, à côté du texte inchangé, `structuredContent` (MCP 2025-06-18) : `{ code, message, retry_after?,
  action? }`. Les refus du serveur lui-même (offre, filière application, clé inconnue) prennent aussi leur code.
- Tests : la table des statuts est exhaustive ; un refus d'outil sort avec son code et son délai ; le texte d'un refus
  reste celui d'aujourd'hui (un client qui ne lit pas `structuredContent` ne voit aucune différence).

### B0b · L'adresse d'écran

- Chaque outil d'écriture déclare l'écran de ce qu'il a fait (la fiche d'un agent `/agents?id=`, un scénario
  `/workflows?open=`, une conversation `/inbox?c=`, sinon la liste de l'objet), par un point de passage unique
  (`src/mcp/ecran.ts`, sur `APP_URL`). Le type l'exige des outils d'écriture ; un outil sans écran le dit, avec sa raison.
- Le serveur l'ajoute au résultat (`ecran`), sans toucher à la logique des outils.

### B0c · La trace au journal d'audit

- Toute écriture réussie par MCP laisse une ligne au journal d'audit de l'espace : la personne (jeton OAuth) ou la clé,
  l'outil, l'objet touché quand le résultat le nomme, `via: 'mcp'`. Posée au serveur, une fois, pour tous les outils
  d'écriture, et best-effort comme `makeJournal` : un journal en panne ne fait pas croire qu'une écriture n'a pas eu lieu.
- La séance du CSM (son identifiant) voyagera dans le même détail quand le CSM existera : rien à migrer.

### B0d · Le champ visé existe, et un champ omis n'est pas touché

- Un outil qui vise un champ de contact (`set_contact_field`, les variables d'une campagne, les cibles des outils
  d'agent) refuse un champ inconnu (`not_found`, avec la liste des champs proches) au lieu d'en créer un fantôme.
- Chaque outil de modification dit, dans sa description et par un test, la même règle : un champ omis n'est pas touché ;
  `null` vide un champ facultatif quand l'outil le permet.

### Hors de B0 : l'unification des formats

Les neuf incohérences de formats du plan (longueur d'un tag, forme d'une clé, mots réservés, valeur vide, « maintenant »,
origine d'une donnée, valeurs permises, longueur d'une clé, risque d'un appel) attendent l'arbitrage de Julien. Les
propositions du plan sont reprises telles quelles dans un lot à part, dès qu'il les a validées.

## Tests

Par sous-lot, vérifiés dans les deux sens (le code fautif remis, l'échec et son symptôme constatés, puis restauré) :
le type qui force le code d'un refus et l'écran d'une écriture ; le serveur qui rend `structuredContent` et `ecran` ; la
ligne d'audit après une écriture par MCP (serveur de test, journal en mémoire) ; le refus d'un champ inconnu. La parité
(B1) reste verte : aucune route ni aucun champ ne change.

## Déploiement

L'API seule, sans migration (sauf si l'action d'audit exige une contrainte en base, à vérifier en B0c). Le plugin
Claude Code (`plugin/`) se republie après l'API, version montée, quand sa FAQ ou ses compétences parlent des codes.

## Méthode de livraison

Implémenteur par lot, puis une relecture indépendante du diff : une pour B0a (faite, aucun rouge, ses jaunes partis avec
B0b), une pour B0b, B0c et B0d ensemble, avant le déploiement de l'API (une relecture par lot, jamais par bloc). Chaque
réponse d'outil que lisent
déjà les clients qui pilotent par Claude Code change de forme (ajouts seulement, mais sur un chemin que la production
emprunte), et le code touche un invariant invisible (un refus n'est jamais une panne, et une panne ne rend jamais son
message d'origine). L'essai réel qui clôt chaque sous-lot : depuis Claude Code, sur l'espace de test, un outil qui
refuse (un agent inconnu) rend son code, une écriture (un champ créé) rend son écran, et la ligne apparaît au journal
d'audit de la console.
