import { journaliser } from '../lib/journal';
import type { NumeroRepris } from '../otp/store.pg';

/**
 * LA REPRISE DES NUMÉROS FOURNIS QUI N'ONT JAMAIS SERVI (plan `docs/superpowers/plans/2026-11-18-numeros-fournis-retour-
 * au-stock.md`). Vécu le 2026-11-17 : un espace a pris un numéro du stock, ne l'a jamais relié, et l'a gardé ; le stock
 * s'est vidé, et Julien a dû le remettre à la main. Toutes les heures, un numéro attribué depuis 24 h sans avoir servi
 * revient au stock (la condition : `inutiliseSql`, `src/otp/store.pg.ts`), va d'abord à l'abonné qui attend le sien, et
 * Julien en est prévenu par une ligne Telegram, sans rien à faire.
 *
 * Un numéro par transaction (`reprendreSiInutilise` relit la condition sous le verrou de la ligne), et un échec n'arrête
 * pas les autres. Rôle principal du worker (`TACHES_PAR_ROLE`).
 */

/** Un numéro attribué qui n'a pas servi depuis ce délai revient au stock (décision de Julien du 2026-11-18). */
export const DELAI_NUMERO_INUTILISE_HEURES = 24;

export interface DepsRepriseInutilises {
  numeros: {
    numerosInutilises(delaiHeures: number): Promise<Array<{ id: string; tenantId: string }>>;
    reprendreSiInutilise(id: string, tenantId: string, delaiHeures: number): Promise<NumeroRepris | null>;
  };
  /**
   * Le numéro revenu au stock va d'abord à l'abonné qui attend le sien, jamais à `sauf` (`servirLAttente`, origine
   * `inutilise`). Ne lève pas ; rend l'abonné servi et son numéro, `null` si personne n'attend.
   */
  servirLAttente(sauf: string): Promise<{ tenantId: string; numero: string | null } | null>;
  /** Prévient Julien (Telegram). */
  alerter(texte: string): Promise<boolean>;
}

const jour = (d: Date): string => d.toISOString().slice(0, 10);

/** Un tour de la reprise. Rend le nombre de numéros revenus au stock. */
export async function reprendreLesNumerosInutilises(d: DepsRepriseInutilises): Promise<number> {
  let repris = 0;
  for (const c of await d.numeros.numerosInutilises(DELAI_NUMERO_INUTILISE_HEURES)) {
    let r: NumeroRepris | null;
    try {
      r = await d.numeros.reprendreSiInutilise(c.id, c.tenantId, DELAI_NUMERO_INUTILISE_HEURES);
    } catch (err) {
      journaliser('error', 'numero_inutilise_non_repris', { numeroId: c.id, tenantId: c.tenantId, err });
      continue;
    }
    // Il a servi entre la lecture et le verrou, ou il a quitté l'espace : rien n'est écrit.
    if (r === null) continue;
    repris += 1;
    journaliser('warn', 'numero_inutilise_repris', { numero: r.numero, tenantId: r.tenantId, attribueLe: r.attribueLe.toISOString() });
    // Au mieux : le numéro est déjà au stock, ni l'abonné suivant ni l'alerte ne doivent arrêter le tour.
    try {
      const servi = await d.servirLAttente(r.tenantId);
      const suite = servi?.numero ? ` Attribué aussitôt à l'abonné qui attendait le sien (espace ${servi.tenantId}).` : '';
      await d.alerter(`Numéro fourni rendu au stock : +${r.numero} (espace ${r.tenantId}), attribué le ${jour(r.attribueLe)}, aucun code n'a pu y être lu.${suite}`);
    } catch (err) {
      journaliser('error', 'numero_inutilise_alerte_non_partie', { numero: r.numero, tenantId: r.tenantId, err });
    }
  }
  return repris;
}
