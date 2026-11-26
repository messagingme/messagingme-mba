-- 0328 : le message de passage à un humain de l'agent de Meta, gardé chez nous (plan
-- docs/superpowers/plans/2026-11-26-message-de-passage-en-base.md).
--
-- tenant_settings.mba_handoff_message : le choix de la console, {"message_selection": "DEFAULT"|"AGENT"} ou
-- {"message_selection": "CUSTOM", "message": "..."}. Meta cache le bloc handoff de ses réglages tant que le passage
-- est éteint (mesuré chez MUTAC le 2026-11-26) : relu chez lui hors horaires, le choix n'existe plus, et le balayage
-- des heures ouvrées le remplaçait chaque matin par le texte standard. Chaque écriture du bloc le reprend d'ici.
-- Nul tant que rien n'a été choisi dans la console : le comportement d'avant (fusion avec ce que Meta rend).
--
-- MIGRATION=AVANT : le code neuf écrit cette colonne (choix du message dans la console). L'ancien code ne la nomme pas
-- (la lecture des réglages est un select étoile) : il survit à la migration. Nullable sans défaut : métadonnées
-- seules, sous un verrou bref.
set local lock_timeout = '5s';

alter table tenant_settings add column if not exists mba_handoff_message jsonb;
