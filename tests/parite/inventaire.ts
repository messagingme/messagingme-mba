import Fastify, { type FastifyRequest } from 'fastify';
import { modulesDeRoutes, type Gardes } from '../../src/server';
import { DROITS } from '../../src/offres/offres';
import { STATUT_REFUS_OFFRE } from '../../src/offres/refus';
import type { SourceOffres } from '../../src/offres/offre.pg';
import { gardesOuvertes } from '../gardes';
import { GardeUsageMemoire } from '../aide/usage';

/**
 * LES ROUTES DE LA CONSOLE, ET CELLES QUE LE PRO PEUT APPELER (lot 1 du CSM virtuel, brique B1).
 *
 * 🔴 L'INVENTAIRE VIENT DU REGISTRE, ET L'OFFRE SE MESURE. Chaque module `tenant` de `modulesDeRoutes` est monté seul,
 * comme dans `tests/offres-fonctions.test.ts`, et chacune de ses routes est appelée par un espace Pro : l'étape d'offre
 * réelle refuse en 402 AVANT le handler une route réservée au Business ou à l'Entreprise. Aucune liste de ces routes
 * n'est écrite à la main, donc aucune ne peut dériver ; une route ajoutée demain entre ici sans que personne l'inscrive.
 * ⚠️ Le critère est le 402 SANS handler atteint : une route ouverte au Pro dont le handler répond lui-même 402 (HubSpot
 * qui refuse de BRANCHER sans sa fonction) reste ouverte au Pro.
 */

export interface RouteDeConsole {
  readonly module: string;
  readonly methode: string;
  readonly chemin: string;
  /** `METHODE /chemin`, sans le préfixe `/tenants/:tenantId` que portent presque toutes : la clé de `ADRESSES`. */
  readonly cle: string;
  readonly ouverteAuPro: boolean;
}

export const cleDe = (methode: string, chemin: string): string =>
  `${methode} ${chemin.replace(/^\/tenants\/:tenantId(?=\/|$)/, '')}`;

const bouchon = (): unknown => new Proxy(function () {} as never, {
  get: (_c, p) => (typeof p === 'symbol' || p === 'then' ? undefined : bouchon()),
  apply: () => bouchon(),
});
const toutBouchonne = new Proxy({}, { get: (_c, p) => (typeof p === 'symbol' ? undefined : bouchon()) }) as never;
const espacePro: SourceOffres = { offreDe: async () => ({ offre: 'pro', droits: DROITS.pro, retourEnBaseLe: null }) };
const adminT1 = async (req: FastifyRequest): Promise<void> => {
  (req as { auth?: unknown }).auth = { tenantId: 't1', userId: 'u1', role: 'admin' };
};

export async function routesDeConsole(): Promise<RouteDeConsole[]> {
  const usage = new GardeUsageMemoire(120, 0, () => Date.now(), 0);
  const gardes: Gardes = { ...gardesOuvertes, auth: adminT1, admin: adminT1, encadrement: adminT1, adminOuLien: adminT1, offres: espacePro };
  const toutes: RouteDeConsole[] = [];
  for (const m of modulesDeRoutes(toutBouchonne, usage)) {
    if (m.acces !== 'tenant') continue;
    const app = Fastify({ logger: false });
    const montees: Array<{ methode: string; chemin: string; atteinte: boolean }> = [];
    app.addHook('onRoute', (r) => {
      for (const methode of Array.isArray(r.method) ? r.method : [r.method]) {
        if (methode === 'HEAD' || methode === 'OPTIONS') continue;
        const montee = { methode, chemin: r.url, atteinte: false };
        montees.push(montee);
        const handler = r.handler;
        r.handler = function (this: unknown, ...a: Parameters<typeof handler>) {
          if (a[0].method === methode) montee.atteinte = true;
          return handler.apply(this as never, a);
        };
      }
    });
    m.monte(app, gardes);
    await app.ready();
    for (const r of montees) {
      const url = r.chemin.replace(':tenantId', 't1').replace(/:[A-Za-z_]+/g, 'x').replace('*', 'x');
      const avecCorps = r.methode !== 'GET' && r.methode !== 'DELETE';
      const res = await app.inject({
        method: r.methode as never,
        url,
        ...(avecCorps ? { payload: {}, headers: { 'content-type': 'application/json' } } : {}),
      });
      const refuseeParLOffre = res.statusCode === STATUT_REFUS_OFFRE && !r.atteinte;
      toutes.push({ module: m.nom, methode: r.methode, chemin: r.chemin, cle: cleDe(r.methode, r.chemin), ouverteAuPro: !refuseeParLOffre });
    }
    await app.close();
  }
  return toutes;
}
