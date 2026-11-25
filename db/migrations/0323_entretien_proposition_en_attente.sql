-- 0323 : la proposition de l entretien de construction d un agent IA, gardee jusqu a ce qu elle soit enregistree ou
-- jetee (Maison Saint-Honore, 2026-11-24).
--
-- La proposition ne partait que dans la reponse du tour qui la produisait : un rechargement ou un onglet rouvert, et
-- la relecture du fil (GET /setup) la perdait. Le dernier message disait « Relisez la proposition ci-dessous »
-- au-dessus de rien, sans plus aucun bouton pour enregistrer ni activer. Elle est gardee ici (en-attente.ts) et
-- relue recalculee contre l agent.
--
-- Nullable SANS defaut, comme connaissance_url (0228) : absente veut dire « rien en attente ». Aucun index : on la lit
-- avec la ligne, par sa cle primaire.
--
-- ORDRE : colonne neuve que l ancien code ignore. Le code neuf la nomme dans la lecture et l ecriture de chaque tour
-- de l assistant de construction (un select qui la cite rendrait 42703 sans elle) : elle passe AVANT le up de l API.
set local lock_timeout = '5s';

alter table agent_setup_conversations add column if not exists en_attente jsonb;
