-- 0289 : le type `json` d'un champ perso (spec docs/superpowers/specs/2026-11-11-champ-json-appel-api-design.md).
--
-- Un champ `json` reçoit la réponse ENTIÈRE d'un bloc « Appel API », puis un bloc d'extraction y lit des valeurs.
--
-- ÉLARGISSEMENT PUR, comme 0076 : toute valeur déjà en base reste valide, la contrainte accepte une valeur de plus.
-- Aucune ligne à reprendre. Le nom de la contrainte est celui que 0076 a posé explicitement, aucune migration ne l'a
-- changé depuis. `user_fields` est petite (quelques lignes par espace) : le verrou ACCESS EXCLUSIVE du `add constraint`
-- est bref, `lock_timeout` borne l'attente et une migration refusée se rejoue. AVANT le code (`migration=avant`) :
-- l'ancien code ne crée jamais de `json`, le nouveau en crée.
set local lock_timeout = '5s';
alter table user_fields drop constraint if exists user_fields_type_check;
alter table user_fields add constraint user_fields_type_check
  check (type in ('text', 'number', 'date', 'datetime', 'boolean', 'url', 'json'));
