-- L'essai du Business (révision du Crédit WhatsApp, 2026-11-04, décision 1) : Julien pose un Business en essai de 14
-- jours sur demande ; tant que sa date n'est pas effacée par la confirmation, l'option Crédit WhatsApp ne s'ouvre pas.
-- Une date passée sans confirmation reste un essai. Le retrait du Business ou la pose de l'Entreprise l'effacent
-- (PgOffresStore.ecrireEntreprise).
--
-- Une colonne nullable sans défaut sur tenants : instantané (métadonnées seules), réversible par un drop column une fois
-- le code qui la lit retiré. Le verrou attend au plus 5 s derrière une transaction longue, puis la migration échoue et se
-- rejoue. Lue par l'ouverture de l'option et par /ops, jamais par un chemin chaud : elle part en migration=avant, avec le
-- code qui l'écrit.
set local lock_timeout = '5s';

alter table tenants add column if not exists offre_business_essai_fin_le timestamptz;
