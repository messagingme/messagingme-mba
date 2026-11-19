import type { Pool } from 'pg';
import { codeDEspace } from '../ids/code';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Au plus autant d'espaces lus par alerte : une alerte en cite un ou deux, le reste serait du bruit. */
const MAX_IDS = 10;

/**
 * Le libelleur des alertes Telegram (code d'espace visible, 2026-11-19) : chaque UUID d'espace du texte reçoit
 * « Nom » (code), l'UUID restant pour la base. Une seule lecture, plafonnée ; un UUID qui n'est pas un espace reste tel
 * quel. 🔴 Il ne perd jamais une alerte : base en panne ou trop lente, le texte part inchangé.
 *
 * Lecture d'exploitation cross-espace, sans filtre `tenant_id` : son seul consommateur est l'alerte interne.
 */
export function creerLibelleurEspaces(
  pool: { query: Pool['query'] },
  opts: { plafondMs?: number } = {},
): (texte: string) => Promise<string> {
  const plafondMs = opts.plafondMs ?? 1000;
  return async (texte) => {
    const ids = [...new Set((texte.match(UUID) ?? []).map((s) => s.toLowerCase()))].slice(0, MAX_IDS);
    if (ids.length === 0) return texte;
    let minuteur: ReturnType<typeof setTimeout> | undefined;
    try {
      const lecture = pool.query<{ id: string; name: string; public_code: string | null }>(
        'select id::text as id, name, public_code from tenants where id = any($1::uuid[])',
        [ids],
      );
      const delai = new Promise<null>((resoudre) => { minuteur = setTimeout(() => resoudre(null), plafondMs); });
      const res = await Promise.race([lecture, delai]);
      if (res === null) return texte;
      const libelles = new Map(res.rows.map((r) => [r.id.toLowerCase(), `« ${r.name} » (${codeDEspace(r.id, r.public_code)})`]));
      return texte.replace(UUID, (u) => {
        const libelle = libelles.get(u.toLowerCase());
        return libelle ? `${u} ${libelle}` : u;
      });
    } catch {
      return texte;
    } finally {
      if (minuteur !== undefined) clearTimeout(minuteur);
    }
  };
}
