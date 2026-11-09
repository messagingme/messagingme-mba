-- 0285_numero_par_la_ligne.sql : le numéro arrivé par la fenêtre du partenaire (lot E5 du Crédit WhatsApp, plan
-- docs/superpowers/plans/2026-11-09-credit-whatsapp-fenetre-du-partenaire.md, jaunes 3 et 4 de la relecture du lot E).
--
-- `par_la_ligne_le` : le moment où la fin d'une connexion par la fenêtre de Meta ouverte avec la solution du partenaire
-- a marqué ce numéro (rejouée, la marque garde son premier moment). Nul pour tout autre numéro. C'est la trace en base de
-- la connexion (l'alerte Telegram était la seule, et elle s'est perdue à l'essai réel 236), et ce qui fait attendre sa
-- ligne à une Entreprise (`etatLigneCredit` : `en_attente`, plus « sur demande »). La marque part avec le numéro : sa
-- ligne `phone_numbers` est supprimée par « Déconnecter le numéro ».
--
-- Colonne nullable sans défaut : aucune réécriture de `phone_numbers`, un verrou d'un instant. Posée AVANT le code
-- (`migration=avant`) : le code neuf l'écrit et la lit ; l'ancien ne la nomme nulle part (aucun `select *` sur la table).
set local lock_timeout = '5s';
alter table phone_numbers add column if not exists par_la_ligne_le timestamptz;
