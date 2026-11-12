import type { Pool } from 'pg';
import type { MagasinObjets } from '../lib/magasin-objets';
import { texteDe } from '../lib/erreur';

/**
 * LES PDF PROPRES À UN CONTACT, recopiés de HubSpot (plan `docs/superpowers/plans/2026-11-12-pdf-par-contact-hubspot.md`,
 * migration 0291). Une ligne par fichier, rangée par numéro, l'objet dans le bucket privé de l'espace. Ce module porte,
 * au lot A, leur fin de vie ; la recopie et la lecture arrivent au lot B.
 */

/** 30 jours, décision de Julien du 2026-11-12 : assez pour les relances d'un cycle de vente. */
export const CONSERVATION_DOCUMENTS_JOURS = 30;

/** Le champ de fiche qui porte le code du document, posé par la recopie (lot B) et vidé par le balayage. */
export const CHAMP_DOCUMENT = 'hs_calc_document';

export class PgDocumentsContact {
  constructor(private readonly pool: Pool, private readonly magasin: MagasinObjets | null) {}

  /**
   * Efface au plus `taille` documents échus : plus vieux que la conservation, ou marqués par la purge RGPD d'un contact.
   * Dans l'ordre : l'objet, PUIS la ligne, comme la médiathèque (`purgerSupprimes`) : un objet qui ne s'efface pas garde
   * sa ligne, que le passage suivant reprend, et la passe lève pour que l'étape se voie en échec. Le champ de la fiche
   * qui portait ce code est vidé avec la ligne : un code mort ne doit pas faire croire à un document.
   * Sans magasin, rien ne s'efface : l'objet resterait au bucket et plus rien ne le nommerait.
   */
  async purgerEchus(taille: number): Promise<number> {
    if (this.magasin === null) return 0;
    const { rows } = await this.pool.query<{ tenant_id: string; code: string; cle_objet: string }>(
      `select tenant_id, code, cle_objet from documents_contact
        where a_effacer_le is not null or cree_le <= now() - make_interval(days => $2::int)
        order by cree_le limit $1`,
      [taille, CONSERVATION_DOCUMENTS_JOURS],
    );
    const effaces: Array<{ tenant_id: string; code: string }> = [];
    const echecs: string[] = [];
    for (const r of rows) {
      try {
        await this.magasin.effacer(r.cle_objet);
        effaces.push({ tenant_id: r.tenant_id, code: r.code });
      } catch (err) {
        echecs.push(texteDe(err));
      }
    }
    if (effaces.length > 0) {
      const lot = JSON.stringify(effaces);
      // Le champ d'abord : le code n'est vidé que sur la fiche de CET espace qui le porte encore.
      // `@>` et non `->> =` : la même condition, mais servie par l'index GIN de `contacts.fields` (0032), sans lire
      // toutes les fiches de l'espace à chaque lot.
      await this.pool.query(
        `update contacts c set fields = c.fields - $2::text, updated_at = now()
           from jsonb_to_recordset($1::jsonb) as x(tenant_id uuid, code text)
          where c.tenant_id = x.tenant_id and c.fields @> jsonb_build_object($2::text, x.code)`,
        [lot, CHAMP_DOCUMENT],
      );
      await this.pool.query(
        `delete from documents_contact d using jsonb_to_recordset($1::jsonb) as x(tenant_id uuid, code text)
          where d.tenant_id = x.tenant_id and d.code = x.code`,
        [lot],
      );
    }
    if (echecs.length > 0) throw new Error(`${echecs.length} document(s) du bucket non effacé(s), leurs lignes restent : ${echecs[0]}`);
    return effaces.length;
  }
}
