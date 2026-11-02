import type { Pool } from 'pg';

/**
 * LA VUE « CRÉDITS » DE `/ops` (Entreprise illimitée, lot C ; décision de Julien du 2026-11-02 : le suivi du crédit
 * « pour le client et pour nous »). Un espace par ligne, ses deux crédits, le mois de Paris en cours et le précédent, et
 * pour une Entreprise ce qui se FACTURE au contrat : ses débits IA et ses messages WhatsApp illimités, au prix client
 * (commission comprise, ce que ses onglets lui montrent). Aucun autre écran ne donne ce montant.
 *
 * 🔴 LA SOMME DES PLAFONDS IA DES ENTREPRISES QUI ONT UNE CLÉ se lit à côté du budget d'équipe de la passerelle d'IA
 * chez Vercel (rouge de la relecture du lot B) : chacune peut consommer son plafond dans le mois, et à 100 % du budget
 * d'équipe Vercel coupe toutes les clés, donc l'IA de tous les clients. La veille horaire du budget alerte quand la
 * somme le dépasse (`creerVeilleVercel`).
 *
 * Une instruction, un instantané : les montants d'une ligne sont cohérents entre eux. Les index `(tenant_id, at desc)`
 * des mouvements et `(tenant_id, cree_le desc)` des provisions servent les deux mois de chaque espace.
 */

/** Un mois et le précédent, en micro-euros. */
export interface DeuxMois {
  moisMicroEur: number;
  moisPrecedentMicroEur: number;
}

export interface LigneCreditsOps {
  tenantId: string;
  nom: string;
  offre: string;
  ia: {
    /** Une Entreprise : illimitée, son solde ne bouge pas. */
    illimite: boolean;
    soldeMicroEur: number;
    /** Tous les débits du mois (tours, recherches, fiches, traductions, transcriptions), illimités compris. */
    consommation: DeuxMois;
    /** Le plafond de sécurité du mois (le sien, sinon le défaut) ; `null` hors Entreprise. */
    plafondMicroEur: number | null;
    plafondAtteint: boolean;
    /** L'espace a une clé de modèle chez Vercel. */
    cle: boolean;
  };
  whatsapp: {
    /** Un numéro de l'espace est sur la ligne de crédit. */
    surLaLigne: boolean;
    soldeMicroEur: number;
    /** Les provisions non rendues du mois, illimitées comprises. */
    consommation: DeuxMois;
  };
  /**
   * Ce qui se facture au contrat : les débits IA et les messages WhatsApp ILLIMITÉS. Toujours rendu pour une Entreprise ;
   * pour un espace qui en est sorti en cours de mois, tant qu'il lui reste de l'illimité à facturer ; `null` sinon.
   */
  aFacturer: DeuxMois | null;
}

export interface VueCreditsOps {
  espaces: LigneCreditsOps[];
  /** Le plafond IA d'une Entreprise qui n'a pas le sien (`ENTREPRISE_PLAFOND_IA_EUROS_MOIS`). */
  plafondIaParDefautMicroEur: number;
  /** La somme des plafonds IA des Entreprises qui ont une clé : ce qu'elles peuvent consommer chez Vercel ce mois-ci. */
  plafondsEntreprisesAvecCleMicroEur: number;
  /**
   * La même somme en dollars, au taux du jour (`EUR_PER_USD`), à comparer au budget d'équipe de Vercel : une borne
   * haute de ce que Vercel compterait (elle est au prix client, commission comprise), comme la veille horaire.
   */
  plafondsEntreprisesAvecCleDollars: number;
}

export class PgCreditsOpsStore {
  constructor(
    private readonly pool: Pick<Pool, 'query'>,
    private readonly plafondIaParDefautMicroEur: number,
    /** Euros par dollar (`EUR_PER_USD`). */
    private readonly tauxEurParDollar: number,
  ) {}

  async vue(): Promise<VueCreditsOps> {
    const { rows } = await this.pool.query<{
      id: string; nom: string; offre: string; acces_ia: string; solde_ia: string; plafond_ia: string; cle: boolean;
      ia_mois: string; ia_precedent: string; ia_illimite_mois: string; ia_illimite_precedent: string;
      solde_wa: string; sur_la_ligne: boolean;
      wa_mois: string; wa_precedent: string; wa_illimite_mois: string; wa_illimite_precedent: string;
    }>(
      `with bornes as (
         select (date_trunc('month', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris') as debut_mois,
                ((date_trunc('month', now() at time zone 'Europe/Paris') - interval '1 month') at time zone 'Europe/Paris') as debut_precedent
       )
       select t.id::text, t.name as nom, offre_de_l_espace(t.id) as offre,
              acces_credit_ia(t.id, $1::bigint) as acces_ia,
              coalesce(c.solde_micro_eur, 0) as solde_ia,
              coalesce(t.entreprise_plafond_ia_micro_eur, $1::bigint) as plafond_ia,
              exists (select 1 from agent_gateway_keys k where k.tenant_id = t.id) as cle,
              ia.mois as ia_mois, ia.precedent as ia_precedent,
              ia.illimite_mois as ia_illimite_mois, ia.illimite_precedent as ia_illimite_precedent,
              coalesce(w.solde_micro_eur, 0) as solde_wa,
              exists (select 1 from lignes_credit_whatsapp l where l.tenant_id = t.id and l.retiree_le is null) as sur_la_ligne,
              wa.mois as wa_mois, wa.precedent as wa_precedent,
              wa.illimite_mois as wa_illimite_mois, wa.illimite_precedent as wa_illimite_precedent
         from tenants t
        cross join bornes b
         left join agent_credits c on c.tenant_id = t.id
         left join credits_whatsapp w on w.tenant_id = t.id
        cross join lateral (
          select coalesce(-sum(m.delta_micro_eur) filter (where m.at >= b.debut_mois), 0) as mois,
                 coalesce(-sum(m.delta_micro_eur) filter (where m.at < b.debut_mois), 0) as precedent,
                 coalesce(-sum(m.delta_micro_eur) filter (where m.illimite and m.at >= b.debut_mois), 0) as illimite_mois,
                 coalesce(-sum(m.delta_micro_eur) filter (where m.illimite and m.at < b.debut_mois), 0) as illimite_precedent
            from agent_credit_mouvements m
           where m.tenant_id = t.id and m.delta_micro_eur < 0 and m.at >= b.debut_precedent
        ) ia
        cross join lateral (
          select coalesce(sum(p.montant_micro_eur) filter (where p.cree_le >= b.debut_mois), 0) as mois,
                 coalesce(sum(p.montant_micro_eur) filter (where p.cree_le < b.debut_mois), 0) as precedent,
                 coalesce(sum(p.montant_micro_eur) filter (where p.illimite and p.cree_le >= b.debut_mois), 0) as illimite_mois,
                 coalesce(sum(p.montant_micro_eur) filter (where p.illimite and p.cree_le < b.debut_mois), 0) as illimite_precedent
            from credit_whatsapp_provisions p
           where p.tenant_id = t.id and p.etat <> 'rendu' and p.cree_le >= b.debut_precedent
        ) wa
        where t.status <> 'locked'
        order by (offre_de_l_espace(t.id) = 'entreprise') desc, lower(t.name), t.id`,
      [this.plafondIaParDefautMicroEur],
    );
    const espaces = rows.map((r): LigneCreditsOps => {
      const entreprise = r.offre === 'entreprise';
      const facture: DeuxMois = {
        moisMicroEur: Number(r.ia_illimite_mois) + Number(r.wa_illimite_mois),
        moisPrecedentMicroEur: Number(r.ia_illimite_precedent) + Number(r.wa_illimite_precedent),
      };
      return {
        tenantId: r.id,
        nom: r.nom,
        offre: r.offre,
        ia: {
          illimite: entreprise,
          soldeMicroEur: Number(r.solde_ia),
          consommation: { moisMicroEur: Number(r.ia_mois), moisPrecedentMicroEur: Number(r.ia_precedent) },
          plafondMicroEur: entreprise ? Number(r.plafond_ia) : null,
          plafondAtteint: r.acces_ia === 'plafond',
          cle: r.cle,
        },
        whatsapp: {
          surLaLigne: r.sur_la_ligne,
          soldeMicroEur: Number(r.solde_wa),
          consommation: { moisMicroEur: Number(r.wa_mois), moisPrecedentMicroEur: Number(r.wa_precedent) },
        },
        aFacturer: entreprise || facture.moisMicroEur > 0 || facture.moisPrecedentMicroEur > 0 ? facture : null,
      };
    });
    const somme = espaces.filter((e) => e.ia.illimite && e.ia.cle).reduce((s, e) => s + (e.ia.plafondMicroEur ?? 0), 0);
    return {
      espaces,
      plafondIaParDefautMicroEur: this.plafondIaParDefautMicroEur,
      plafondsEntreprisesAvecCleMicroEur: somme,
      plafondsEntreprisesAvecCleDollars: Math.round((somme / 1_000_000 / this.tauxEurParDollar) * 100) / 100,
    };
  }
}
