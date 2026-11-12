-- 0292_hubspot_stop.sql : la ligne « Desabonnement WhatsApp » de Tools > Integrations > HubSpot (plan
-- docs/superpowers/plans/2026-11-12-stop-vers-hubspot.md, decisions de Julien du 2026-11-12).
--
-- UN INTERRUPTEUR PAR ESPACE, a cote de hubspot_injoignable (0251) :
--   hubspot_stop  un desabonnement ou un reabonnement WhatsApp coche ou decoche la case de la fiche HubSpot   defaut VRAI
-- Allume par defaut, comme le contact injoignable : il n ecrit que sur des fiches que le portail porte deja, et il dit
-- au client un refus qu il doit connaitre. Eteint, ni le flag stop ni l analyse ne touchent la case.
--
-- MIGRATION=AVANT : le code neuf ecrit cette colonne (l ecran du choix). L ancien code ne la nomme pas (la lecture des
-- reglages est un select etoile) : il survit a la migration. Une base en retard la rendrait absente, lue allumee.
set local lock_timeout = '5s';

alter table tenant_settings add column if not exists hubspot_stop boolean not null default true;
