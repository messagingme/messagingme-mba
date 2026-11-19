/**
 * Remplir `tenants.public_code` des espaces qui n'en ont pas (code d'espace visible, 2026-11-19).
 *
 * La colonne est nullable depuis 0031 et le script de remplissage d'origine n'existe plus : un espace ancien peut ne pas
 * avoir de code. L'affichage s'en passe (`codeDEspace` calcule la même valeur), mais la colonne doit dire vrai pour qui la
 * lit en SQL. La valeur posée est `deriveTenantCode(id)`, celle que la création et `resolveTenantCode` posent : un
 * remplissage ne change donc aucun code déjà affiché ni aucun identifiant d'API déjà émis.
 *
 * Idempotent (`where public_code is null`), une ligne à la fois. Lancé par Julien, après le déploiement, sur la
 * machine des workers (la base n'a qu'une adresse privée). L'image ne porte pas `scripts/` : copier ce fichier dans
 * `/opt/messagingme/sondes/` et le monter, comme le pas 4 des médias (`DEPLOY.md`) :
 *   docker run --rm --env-file /opt/messagingme/.env.prod \
 *     -v /opt/messagingme/sondes/remplir-codes-espaces.mts:/app/scripts/remplir-codes-espaces.mts:ro \
 *     <image> npx tsx scripts/remplir-codes-espaces.mts --compter    # lecture seule ; sans --compter, remplit
 */
import { Pool } from 'pg';
import { pgSsl } from '../src/db/ssl';
import { deriveTenantCode } from '../src/ids/code';

const url = process.env['DATABASE_URL'] ?? '';
if (url === '') {
  console.error('DATABASE_URL absente');
  process.exit(1);
}
const compterSeulement = process.argv.includes('--compter');
const pool = new Pool({ connectionString: url, max: 1, application_name: 'remplir-codes-espaces', ssl: pgSsl(url) });

async function sansCode(): Promise<string[]> {
  return (await pool.query<{ id: string }>('select id::text as id from tenants where public_code is null order by created_at')).rows.map((r) => r.id);
}

try {
  const avant = await sansCode();
  console.log(`espaces sans code : ${avant.length}`);
  if (!compterSeulement) {
    let poses = 0;
    for (const id of avant) {
      const r = await pool.query('update tenants set public_code = $2 where id = $1 and public_code is null', [id, deriveTenantCode(id)]);
      poses += r.rowCount ?? 0;
    }
    console.log(`codes posés : ${poses}`);
    console.log(`espaces sans code après : ${(await sansCode()).length}`);
  }
} catch (err) {
  // Une collision (23505 sur tenants_public_code_key) arrête le script : elle se règle à la main, jamais par un autre code.
  console.error('échec :', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
} finally {
  await pool.end();
}
