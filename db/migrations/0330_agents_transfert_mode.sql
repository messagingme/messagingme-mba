-- 0330 : « Quand votre équipe est joignable » réglé par agent IA (plan
-- docs/superpowers/plans/2026-11-26-transfert-par-agent.md, décision de Julien du 2026-11-26).
--
-- agents.transfert_mode : ce que CET agent a le droit de promettre en passant la main (always, business_hours,
-- never), les mêmes valeurs que tenant_settings.agent_transfert_mode. Nul = la valeur de l'espace, puis always
-- (lireContexteAgentComplet) : aucun remplissage, un agent existant dit exactement ce qu'il disait.
--
-- MIGRATION=AVANT : le code neuf écrit cette colonne (PATCH de l'agent, set_transfer_mode). L'ancien code ne la nomme
-- pas (lectures et returning en colonnes explicites) : il survit à la migration. Nullable sans défaut ; le CHECK
-- parcourt une table de quelques centaines de lignes, sous un verrou bref.
set local lock_timeout = '5s';

alter table agents add column if not exists transfert_mode text
  constraint agents_transfert_mode_check check (transfert_mode in ('always', 'business_hours', 'never'));
