# Lot 2c de l'aide à la connexion : « Phone call », pas « Text message », pour un numéro fourni

**But :** pour un numéro acheté chez nous, la consigne dit, lourdement, de choisir « Phone call » (l'appel) dans la
fenêtre de Meta, surtout pas « Text message ». Au bout de 45 secondes sans code, on redemande le code, toujours par
« Phone call ». Aujourd'hui tout dit l'inverse (« Text message », retenu à l'essai 99 du 2026-10-13). Demande de Julien
du 2026-11-09 : « il faut lourdement insister ».

**Spec :** [docs/superpowers/specs/2026-11-08-aide-connexion-numero-design.md](../specs/2026-11-08-aide-connexion-numero-design.md), section « Lot 2c ».

## Méthode de livraison

En direct, parce que le changement est un texte écrit une seule fois (`ETAPES_NUMERO_FOURNI`), que la page et Claude
reprennent, plus ses copies dans la skill, la fiche et sa capture. Il est réversible, et chaque surface se vérifie par
un test de parité. Une relecture indépendante en fin de lot.

**Essai réel :** sur un espace de test, ouvrir le parcours d'un numéro fourni. L'étape « Phone call » s'affiche en gras,
avec la ligne discrète dessous, et Claude (plugin 0.3.31) redit la même. Puis, à la prochaine vraie connexion d'un
numéro fourni, le code arrive par l'appel et s'affiche sur la page.

## Décisions de Julien (2026-11-09)

- Le lot passe juste après le lot 2b.
- Le visuel attend ses rushes. D'ici là, le texte (l'étape en gras), et la capture générique de la fiche inversée
  (« Phone call » coché).
- Si Meta ne propose que « Text message » : une ligne discrète dit de le prendre (notre ligne reçoit aussi le SMS).
- Les libellés de Meta sont « Phone call » et « Text message » (la fenêtre en anglais de nos essais) ; « Voice call »
  n'existe pas.

## Ce qui change

1. `web/lib/partage/etapes-numero-fourni.ts` :
   - l'étape 3 devient « choisissez « Phone call » (l'appel), surtout pas « Text message » », marquée `insiste` ;
   - l'étape 5 devient « redemandez-le, toujours par « Phone call » » ;
   - une ligne à part, `SI_SEUL_TEXT_MESSAGE`.
2. `web/components/ParcoursNumero.tsx` : l'étape `insiste` en gras, et la ligne à part sous la liste, en petit.
3. `src/mcp/outils-numero.ts` : la consigne et la suite du numéro attribué disent d'insister sur l'étape de l'appel, et
   portent la ligne à part.
4. `plugin/skills/mise-en-service/SKILL.md` : les étapes du numéro fourni. Le plugin passe en 0.3.31 (publication par
   Julien, après le déploiement de l'API).
5. Les fiches et la doc :
   - les fiches `connecter-mon-numero-whatsapp` (FR, EN), puis `npm run vitrine:aide` ;
   - `features.md` (le numéro fourni) et l'empreinte de la fiche ;
   - la capture générique de la fenêtre de Meta (`web/e2e/captures/fenetre-meta.ts`), qui coche « Phone call ».

## Tests attendus

- `tests/etapes-numero-fourni.test.ts` :
  - l'ordre devient : GB, « Phone call », le code, 45 s par « Phone call », « Finish » ;
  - l'étape de l'appel dit « surtout pas « Text message » » et porte `insiste` ;
  - plus aucune étape n'envoie vers « l'autre méthode » ;
  - la page affiche la ligne à part ;
  - la skill du plugin dit « Phone call » avant toute mention de « Text message ».
- `tests/mcp-numero.test.ts` : la consigne et la suite portent l'insistance et la ligne à part.
- La parité des pages d'aide (`npm run vitrine:aide`) et les empreintes.

## La relecture

Une relecture indépendante, sans rouge. Ses jaunes, corrigés dans le même commit sans relecture propre :
- la suite d'attente revient à chaque tour : l'insistance n'y accompagne que des étapes redonnées ;
- « notre ligne reçoit aussi le SMS » était inexact : une ligne fixe britannique ne reçoit pas de SMS, l'opérateur le
  lit à voix haute par un appel, un chemin plus fragile (`src/otp/extraire-code.ts`). La ligne discrète dit désormais
  « le SMS nous parvient lu à voix haute par un appel, et le code s'affiche en général de la même façon » ;
- les guillemets imbriqués de la consigne MCP sont retirés ;
- le film de la fiche, qui montre sans doute « Text message », va au `todo.md`, avec le visuel des rushes.

Un cinquième point (la skill et la consigne MCP formulent l'exception un peu différemment, dans le même sens) n'appelle
rien.

## Ordre de déploiement

Ce lot repose sur `77f3988c` (lot E5 de la session voisine, migration 0285 en `avant`) : son déploiement emporterait
E5, donc il part APRÈS celui d'E5. Un seul commit, puis :
1. Vercel publie la console ;
2. l'API (les consignes de Claude) par `deploy-scaleway.yml`, `migration=aucune`, sur l'accord de Julien ;
3. `aide:charger` par Julien, la fiche étant publique ;
4. la publication du plugin 0.3.31, par Julien.
