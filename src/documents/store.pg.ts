import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { prefixeEspace, type MagasinObjets } from '../lib/magasin-objets';
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
   * Range un PDF reçu pour ce numéro et rend son code (lot B1). Le même fichier (même empreinte) déjà rangé pour ce
   * numéro, VIVANT et de MOINS D'UN JOUR, rend son code sans redépôt : un rejeu de HubSpot ne double rien. Plus vieux,
   * il est redéposé sous un nouveau code, qui repart pour 30 jours : repris au jour 29, il serait effacé par le balayage
   * dans l'heure, champ de la fiche compris (relectures des lots A et B1). L'objet est déposé AVANT la ligne : une ligne
   * ne nomme jamais un objet absent.
   * Sans magasin, lève : le PDF n'a nulle part où aller, et l'appelant retire le champ.
   */
  async deposer(e: { tenantId: string; waId: string; nom: string; octets: Buffer }): Promise<string> {
    if (this.magasin === null) throw new Error('stockage d’objets non configuré');
    const empreinte = createHash('sha256').update(e.octets).digest('hex');
    const deja = await this.pool.query<{ code: string }>(
      `select code from documents_contact
        where tenant_id = $1 and wa_id = $2 and empreinte = $3 and cree_le > now() - interval '1 day'
        order by cree_le desc limit 1`,
      [e.tenantId, e.waId, empreinte],
    );
    if (deja.rows[0]) return deja.rows[0].code;
    const code = `doc_${randomUUID().replace(/-/g, '')}`;
    const cle = `${prefixeEspace(e.tenantId)}documents/${code}.pdf`;
    await this.magasin.deposer(cle, e.octets, 'application/pdf');
    await this.pool.query(
      `insert into documents_contact (tenant_id, code, wa_id, nom, cle_objet, taille, empreinte) values ($1, $2, $3, $4, $5, $6, $7)`,
      [e.tenantId, code, e.waId, e.nom, cle, e.octets.length, empreinte],
    );
    return code;
  }

  /**
   * Le document d'un code, pour l'envoi (lot B2) : seulement s'il appartient à CET espace et à CE numéro, et s'il n'a pas
   * été marqué par une purge (`wa_id` vidé). Un code d'un autre espace, d'un autre contact, effacé ou inconnu rend null :
   * l'envoi refuse, rien ne part. Sans magasin, null aussi.
   */
  async lire(tenantId: string, waId: string, code: string): Promise<{ nom: string; octets: Buffer } | null> {
    if (this.magasin === null) return null;
    const { rows } = await this.pool.query<{ nom: string | null; cle_objet: string }>(
      `select nom, cle_objet from documents_contact where tenant_id = $1 and code = $2 and wa_id = $3`,
      [tenantId, code, waId],
    );
    const r = rows[0];
    if (!r) return null;
    const octets = await this.magasin.lireOctets(r.cle_objet);
    return octets === null ? null : { nom: r.nom ?? 'document.pdf', octets };
  }

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
