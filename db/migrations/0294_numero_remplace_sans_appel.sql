-- 0294 : la marque d'un numero fourni remplace sans aucun appel (plan docs/superpowers/plans/2026-11-18-numeros-fournis-
-- retour-au-stock.md). « Le code n'arrive pas ? En obtenir un autre » rend desormais au stock un numero sur lequel aucun
-- code n'a pu etre lu. Sans aucun appel, Meta l'a peut-etre refuse (deja actif sur WhatsApp ailleurs) : la premiere fois,
-- il revient au stock et la marque se pose, avec l'espace qui l'a posee ; si un AUTRE espace le remplace ensuite, lui
-- aussi sans appel, il est bloque. Un appel recu depuis la marque l'annule. Un numero marque s'attribue en dernier.
--
--  - remplace_sans_appel_le : l'heure du dernier remplacement sans appel ;
--  - remplace_sans_appel_par : l'espace qui l'a fait. Sans cle etrangere, deliberement : un espace supprime n'a rien a
--    emporter ici, et une cle poserait un verrou sur tenants (chemin chaud).
--
-- Nulles, sans defaut : l'ancien code les ignore, le neuf les lit et les ecrit (le remplacement et l'attribution). Elle
-- part AVANT le code (migration=avant) : le code neuf echouerait en 42703 sans elles.
--
-- ⚠️ add column sans defaut ne reecrit pas la table, mais prend un ACCESS EXCLUSIVE bref sur numeros_fournis, que l'appel
-- entrant et l'attribution lisent : lock_timeout pour echouer au bout de 5 s plutot que de les faire attendre.
set local lock_timeout = '5s';

alter table numeros_fournis
  add column if not exists remplace_sans_appel_le timestamptz,
  add column if not exists remplace_sans_appel_par uuid;
