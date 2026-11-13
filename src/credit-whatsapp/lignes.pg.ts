import type { Pool } from 'pg';

/**
 * LES NUMÉROS SUR LA LIGNE DE CRÉDIT (migration 0264, `lignes_credit_whatsapp`). Une ligne en cours est active (le numéro
 * envoie, chaque message provisionné) ou arrêtée (l'option a pris fin mais la ligne paie encore chez Meta : la garde
 * refuse tout envoi) ; une ligne retirée ne compte plus. Lue avant CHAQUE envoi Meta : gardée cinq secondes par numéro,
 * comme les gardes du numéro délié et suspendu.
 *
 * 🔴 UNE LIGNE COUVRE TOUT LE COMPTE WHATSAPP (WABA) DE SON NUMÉRO : Meta attache la ligne de crédit au compte, pas au
 * numéro, donc tout numéro de ce compte est payé par la ligne et chacun de ses messages doit être provisionné. Un numéro
 * ajouté ou remplacé dans le compte (« Déconnecter le numéro » efface `phone_numbers` sans toucher la ligne) est couvert
 * par la ligne déjà posée, sans geste dans `/ops`. Relevé par la relecture du calcul du 2026-11-02.
 */
const CACHE_MS = 5_000;

/**
 * Un accusé de Meta arrive jusqu'à la fin de vie du message (30 jours) : la ligne retirée depuis moins longtemps se lit
 * encore pour lui, sinon l'échec ou la gratuité d'un message parti juste avant le retrait ne rendrait jamais sa provision.
 */
const JOURS_ACCUSES_APRES_RETRAIT = 35;

export interface LigneCredit {
  id: string;
  tenantId: string;
  phoneNumberId: string;
  wabaId: string | null;
  origine: 'ops' | 'option';
  depuis: string;
  /** L'option a pris fin : la garde refuse les envois du numéro. */
  arreteeLe: string | null;
  /** La ligne est retirée : seuls les accusés des messages partis avant la lisent encore (`ligneDesAccuses`). */
  retireeLe: string | null;
}

/** Ce que la pose d'un numéro sur la ligne vérifie (`/ops`, puis l'option du lot 2). */
export interface NumeroPourLaLigne {
  wabaId: string | null;
  /** `waba_credentials.fournisseur` ; sans compte propre, le jeton de notre portefeuille : `meta`. */
  fournisseur: string;
  /** L'application WhatsApp Business envoie elle aussi depuis ce numéro, sans passer par nous. */
  coexistence: boolean;
  delie: boolean;
}

/** Un numéro de l'espace tel que la fenêtre de l'offre de `/ops` le montre. */
export interface NumeroDeLEspace extends NumeroPourLaLigne {
  phoneNumberId: string;
  /** Le numéro tel que Meta l'affiche (« +33 5 25 68 02 50 »). */
  numero: string | null;
  /** Le nom vérifié chez Meta. */
  nom: string | null;
  /**
   * Arrivé par la fenêtre du partenaire (`phone_numbers.par_la_ligne_le`, migration 0285, relecture du lot E, jaunes 3
   * et 4) et AUCUNE ligne de l'espace posée depuis, retirées comprises : une Entreprise attend alors sa ligne
   * (`etatLigneCredit`). 🔴 Une ligne posée depuis l'éteint pour de bon : retirée ensuite, l'Entreprise relit « sur
   * demande » et le conseil de sa carte chez Meta (le rouge de la relecture du lot E5).
   */
  attendLigne: boolean;
}

/**
 * Un numéro arrivé par la fenêtre du partenaire qui attend sa ligne, tel que la liste de `/ops` le montre, tous espaces
 * confondus (relecture du lot E5, jaune 3) : le geste à faire (demander l'attache au partenaire, puis poser la ligne)
 * ne dépend plus d'une alerte Telegram, qui peut se perdre (essai 236).
 */
export interface NumeroEnAttente {
  tenantId: string;
  /** Le nom de l'espace. */
  espace: string;
  phoneNumberId: string;
  /** Le numéro tel que Meta l'affiche ; `null` s'il ne l'a pas rendu. */
  numero: string | null;
  /** Le moment de la connexion par la fenêtre (la marque). */
  depuis: string;
}

/**
 * « Le numéro `p` attend sa ligne » : marqué par la fenêtre du partenaire, et AUCUNE ligne de son espace posée depuis,
 * retirées comprises. Écrit UNE fois : l'état des cartes (`numerosDeLEspace`) et la liste de `/ops`
 * (`numerosEnAttenteDeLigne`) disent la même chose de chaque numéro. `p` est l'alias de `phone_numbers` dans les deux.
 */
const ATTEND_LIGNE_SQL = `(p.par_la_ligne_le is not null and not exists (
  select 1 from lignes_credit_whatsapp l where l.tenant_id = p.tenant_id and l.depuis >= p.par_la_ligne_le
))`;

/** La liste de `/ops` est bornée : au-delà, ce n'est plus une liste de gestes à faire, c'est une panne à lire en base. */
const MAX_NUMEROS_EN_ATTENTE = 200;

export class PgLignesCreditStore {
  private readonly cache = new Map<string, { lue: number; valeur: LigneCredit | null }>();
  /** Une lecture en vol par numéro : une rafale d'envois simultanés ne fait qu'une requête. */
  private readonly enVol = new Map<string, { lecture: Promise<LigneCredit | null> }>();

  constructor(private readonly pool: Pool, private readonly maintenant: () => number = () => Date.now()) {}

  /** La ligne en cours qui couvre le numéro (la sienne, ou celle de son compte), active ou arrêtée ; `null` sinon. */
  async ligneDuNumero(phoneNumberId: string): Promise<LigneCredit | null> {
    const l = await this.ligneLue(phoneNumberId);
    return l !== null && l.retireeLe === null ? l : null;
  }

  /**
   * Pour un accusé : la ligne en cours qui couvre le numéro, ou à défaut celle retirée depuis moins de
   * `JOURS_ACCUSES_APRES_RETRAIT` jours. L'ajustement y retrouve l'espace de la provision du message.
   */
  async ligneDesAccuses(phoneNumberId: string): Promise<LigneCredit | null> {
    return this.ligneLue(phoneNumberId);
  }

  private async ligneLue(phoneNumberId: string): Promise<LigneCredit | null> {
    const t = this.maintenant();
    const c = this.cache.get(phoneNumberId);
    if (c !== undefined && t - c.lue < CACHE_MS) return c.valeur;
    const deja = this.enVol.get(phoneNumberId);
    if (deja !== undefined) return deja.lecture;
    const vol: { lecture: Promise<LigneCredit | null> } = { lecture: Promise.resolve(null) };
    vol.lecture = (async () => {
      try {
        const valeur = await this.lireLigne(phoneNumberId);
        // Une écriture pendant la lecture (`poser`, `arreter`, `retirer`) l'a retirée : rendue, jamais gardée.
        if (this.enVol.get(phoneNumberId) === vol) this.cache.set(phoneNumberId, { lue: t, valeur });
        return valeur;
      } finally {
        if (this.enVol.get(phoneNumberId) === vol) this.enVol.delete(phoneNumberId);
      }
    })();
    this.enVol.set(phoneNumberId, vol);
    return vol.lecture;
  }

  /**
   * La ligne du numéro, ou celle d'un autre numéro de son compte ; une ligne en cours passe avant une ligne retirée, et la
   * sienne avant celle du compte. Un numéro effacé de `phone_numbers` ne se lit plus que par sa propre ligne.
   */
  private async lireLigne(phoneNumberId: string): Promise<LigneCredit | null> {
    const { rows } = await this.pool.query<{
      id: string; tenant_id: string; phone_number_id: string; waba_id: string | null; origine: 'ops' | 'option'; depuis: Date;
      arretee_le: Date | null; retiree_le: Date | null;
    }>(
      `select l.id, l.tenant_id, l.phone_number_id, l.waba_id, l.origine, l.depuis, l.arretee_le, l.retiree_le
         from lignes_credit_whatsapp l
        where (l.phone_number_id = $1 or l.waba_id = (select p.waba_id from phone_numbers p where p.id = $1))
          and (l.retiree_le is null or l.retiree_le > now() - make_interval(days => $2))
        order by l.retiree_le is null desc, l.phone_number_id = $1 desc, coalesce(l.retiree_le, l.depuis) desc
        limit 1`,
      [phoneNumberId, JOURS_ACCUSES_APRES_RETRAIT],
    );
    const r = rows[0];
    return r === undefined ? null : {
      id: r.id,
      tenantId: r.tenant_id,
      phoneNumberId: r.phone_number_id,
      wabaId: r.waba_id,
      origine: r.origine,
      depuis: r.depuis.toISOString(),
      arreteeLe: r.arretee_le?.toISOString() ?? null,
      retireeLe: r.retiree_le?.toISOString() ?? null,
    };
  }

  /**
   * Après une écriture : la prochaine lecture repart de la base, sans rejoindre une lecture lancée avant. TOUT le cache, pas
   * le seul numéro écrit : sa ligne couvre aussi les autres numéros de son compte. Les écritures sont des gestes rares.
   */
  private oublier(): void {
    this.cache.clear();
    this.enVol.clear();
  }

  /** Les lignes en cours d'un espace (la vue de `/ops`, l'achat permis). */
  async lignesDeLEspace(tenantId: string): Promise<LigneCredit[]> {
    const { rows } = await this.pool.query<{
      id: string; tenant_id: string; phone_number_id: string; waba_id: string | null; origine: 'ops' | 'option'; depuis: Date; arretee_le: Date | null;
    }>(
      `select id, tenant_id, phone_number_id, waba_id, origine, depuis, arretee_le
         from lignes_credit_whatsapp where tenant_id = $1 and retiree_le is null order by depuis`,
      [tenantId],
    );
    return rows.map((r) => ({
      id: r.id, tenantId: r.tenant_id, phoneNumberId: r.phone_number_id, wabaId: r.waba_id, origine: r.origine,
      depuis: r.depuis.toISOString(), arreteeLe: r.arretee_le?.toISOString() ?? null, retireeLe: null,
    }));
  }

  /** Les numéros de l'espace, ce que la fenêtre de `/ops` propose de poser sur la ligne (plus d'identifiant à taper). */
  async numerosDeLEspace(tenantId: string): Promise<NumeroDeLEspace[]> {
    const { rows } = await this.pool.query<{
      id: string; display_phone_number: string | null; verified_name: string | null; waba_id: string | null;
      fournisseur: string; coexistence: boolean; delie: boolean; attend_ligne: boolean;
    }>(
      // `attend_ligne` : marqué par la fenêtre du partenaire, et aucune ligne de l'espace posée depuis, retirées comprises.
      `select p.id, p.display_phone_number, p.verified_name, p.waba_id, coalesce(w.fournisseur, 'meta') as fournisseur,
              p.coexistence, p.delie_le is not null as delie, ${ATTEND_LIGNE_SQL} as attend_ligne
         from phone_numbers p left join waba_credentials w on w.waba_id = p.waba_id
        where p.tenant_id = $1 order by p.created_at, p.id`,
      [tenantId],
    );
    return rows.map((r) => ({
      phoneNumberId: r.id, numero: r.display_phone_number, nom: r.verified_name, wabaId: r.waba_id,
      fournisseur: r.fournisseur, coexistence: r.coexistence, delie: r.delie, attendLigne: r.attend_ligne,
    }));
  }

  /**
   * Les numéros qui attendent leur ligne, TOUS ESPACES (la liste de `/ops`, délibérément transverse, relecture du lot E5,
   * jaune 3), par le même prédicat que l'état des cartes, les plus anciens d'abord.
   */
  async numerosEnAttenteDeLigne(): Promise<NumeroEnAttente[]> {
    const { rows } = await this.pool.query<{
      tenant_id: string; nom: string; id: string; display_phone_number: string | null; par_la_ligne_le: Date;
    }>(
      `select p.tenant_id, t.name as nom, p.id, p.display_phone_number, p.par_la_ligne_le
         from phone_numbers p join tenants t on t.id = p.tenant_id
        where ${ATTEND_LIGNE_SQL}
        order by p.par_la_ligne_le, p.id
        limit $1`,
      [MAX_NUMEROS_EN_ATTENTE],
    );
    return rows.map((r) => ({
      tenantId: r.tenant_id, espace: r.nom, phoneNumberId: r.id, numero: r.display_phone_number,
      depuis: r.par_la_ligne_le.toISOString(),
    }));
  }

  /**
   * « Ne pas poser » (relecture du lot E6, jaune 5) : efface la marque d'un numéro de CET espace qui attend VRAIMENT sa
   * ligne (le prédicat de la liste), quand le partenaire n'attache pas, que le client renonce, ou que l'attache est
   * vérifiée sur un compte déjà couvert. N'efface QUE la marque, jamais une ligne : l'espace relit ensuite l'état de ses
   * lignes (une Entreprise sans autre ligne, le texte du numéro connecté avec sa carte, `NUMERO_AVEC_CARTE` ; une option payée sans
   * ligne, en attente ; un compte déjà couvert garde la sienne). Sur un compte déjà couvert SANS attache, ce n'est pas le
   * geste, notre ligne resterait : la JSDoc de la route et le texte de la liste de /ops le disent, mais ni la route ni ce
   * magasin ne peuvent le refuser, l'attache ne se voyant pas d'ici (relecture des lots V9 et V10, jaunes 1). `false`
   * sinon (un autre espace, une attente déjà éteinte).
   */
  async abandonnerAttente(tenantId: string, phoneNumberId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `update phone_numbers p set par_la_ligne_le = null where p.tenant_id = $1 and p.id = $2 and ${ATTEND_LIGNE_SQL}`,
      [tenantId, phoneNumberId],
    );
    return (rowCount ?? 0) > 0;
  }

  /**
   * Marque un numéro de CET espace comme arrivé par la fenêtre du partenaire (relecture du lot E, jaunes 3 et 4) : la trace
   * en base de la connexion, et ce qui fait attendre sa ligne à une Entreprise. Rejouée, la marque garde son premier
   * moment. `false` si le numéro n'est pas de l'espace (le filtre `tenant_id`, seul contrôle sous le rôle de l'application).
   */
  async marquerParLaLigne(tenantId: string, phoneNumberId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `update phone_numbers set par_la_ligne_le = coalesce(par_la_ligne_le, now()) where tenant_id = $1 and id = $2`,
      [tenantId, phoneNumberId],
    );
    return (rowCount ?? 0) > 0;
  }

  /** Un numéro de CET espace, `null` s'il n'en est pas (un numéro d'un autre espace ne se lit pas). */
  async numeroDeLEspace(tenantId: string, phoneNumberId: string): Promise<NumeroPourLaLigne | null> {
    const { rows } = await this.pool.query<{ waba_id: string | null; fournisseur: string; coexistence: boolean; delie: boolean }>(
      `select p.waba_id, coalesce(w.fournisseur, 'meta') as fournisseur, p.coexistence, p.delie_le is not null as delie
         from phone_numbers p left join waba_credentials w on w.waba_id = p.waba_id
        where p.tenant_id = $1 and p.id = $2`,
      [tenantId, phoneNumberId],
    );
    const r = rows[0];
    return r === undefined ? null : { wabaId: r.waba_id, fournisseur: r.fournisseur, coexistence: r.coexistence, delie: r.delie };
  }

  /**
   * Met un numéro sur la ligne. `false` s'il y est déjà (une ligne en cours par numéro, garanti par l'index unique).
   * L'appelant a vérifié que le numéro appartient à l'espace (`tenant_id = $1` côté route).
   */
  async poser(tenantId: string, phoneNumberId: string, wabaId: string | null, origine: 'ops' | 'option', note: string): Promise<boolean> {
    try {
      const { rowCount } = await this.pool.query(
        `insert into lignes_credit_whatsapp (tenant_id, phone_number_id, waba_id, origine, note) values ($1, $2, $3, $4, $5)
         on conflict (phone_number_id) where retiree_le is null do nothing`,
        [tenantId, phoneNumberId, wabaId, origine, note],
      );
      return (rowCount ?? 0) > 0;
    } catch (err) {
      // 🔴 Une ligne par compte WhatsApp (0276) : la base refuse une seconde ligne en cours sur un compte déjà couvert, que
      // la route n'a pas vue (le cache de 5 s d'une autre copie). Rien n'est écrit : « déjà sur la ligne ».
      const e = err as { code?: unknown; constraint?: unknown };
      if (e.code === '23505' && e.constraint === 'lignes_credit_whatsapp_un_compte_uidx') return false;
      throw err;
    } finally {
      this.oublier();
    }
  }

  /**
   * Les numéros de l'espace que ses lignes `'option'` en cours et actives couvrent (le numéro de la ligne, ou un autre de
   * son compte WhatsApp), délié exclu : ceux que comptent les places de l'option (décision de Julien du 2026-11-03). Rangés
   * pour l'attribution des places : le numéro d'une ligne d'abord, puis les autres par ancienneté dans l'espace.
   */
  async numerosCouvertsParOption(tenantId: string): Promise<string[]> {
    const { rows } = await this.pool.query<{ id: string }>(
      `with lignes as (
         select phone_number_id, waba_id from lignes_credit_whatsapp
          where tenant_id = $1 and origine = 'option' and retiree_le is null and arretee_le is null
       )
       select p.id from phone_numbers p
        where p.tenant_id = $1 and p.delie_le is null
          and (p.id in (select phone_number_id from lignes) or p.waba_id in (select waba_id from lignes where waba_id is not null))
        order by (p.id in (select phone_number_id from lignes)) desc, p.created_at, p.id`,
      [tenantId],
    );
    return rows.map((r) => r.id);
  }

  /**
   * La fin de l'option de l'espace (fin de droit, impayé abandonné, résiliation) : TOUTES ses lignes `'option'` en cours
   * sont arrêtées, par ligne et non par numéro (une ligne couvre tout son compte). Les lignes posées par `/ops` (un essai
   * forcé, une Entreprise) ne bougent pas. Rend le nombre de lignes arrêtées.
   */
  async arreterLesLignesDeLOption(tenantId: string): Promise<number> {
    const { rowCount } = await this.pool.query(
      `update lignes_credit_whatsapp set arretee_le = now()
        where tenant_id = $1 and origine = 'option' and retiree_le is null and arretee_le is null`,
      [tenantId],
    );
    this.oublier();
    return rowCount ?? 0;
  }

  /**
   * L'option reprise après sa fin (relecture du lot 4a, jaune 4) : les lignes `'option'` en cours que cette fin avait
   * arrêtées envoient de nouveau, sans retirer ni reposer la ligne (Meta l'a gardée attachée au compte). Seule la fin de
   * l'option arrête une ligne `'option'` (`arreterLesLignesDeLOption`) : la relancer ne contourne aucun autre arrêt. Une
   * ligne retirée reste retirée. Rend le nombre de lignes relancées.
   */
  async relancerLesLignesDeLOption(tenantId: string): Promise<number> {
    const { rowCount } = await this.pool.query(
      `update lignes_credit_whatsapp set arretee_le = null
        where tenant_id = $1 and origine = 'option' and retiree_le is null and arretee_le is not null`,
      [tenantId],
    );
    this.oublier();
    return rowCount ?? 0;
  }

  /** L'option a pris fin : les envois du numéro s'arrêtent, la ligne reste en cours (elle paie encore chez Meta). */
  async arreter(tenantId: string, phoneNumberId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `update lignes_credit_whatsapp set arretee_le = now()
        where tenant_id = $1 and phone_number_id = $2 and retiree_le is null and arretee_le is null`,
      [tenantId, phoneNumberId],
    );
    this.oublier();
    return (rowCount ?? 0) > 0;
  }

  /** Le numéro a quitté la ligne pour de bon : la garde l'ignore. */
  async retirer(tenantId: string, phoneNumberId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `update lignes_credit_whatsapp set retiree_le = now(), arretee_le = coalesce(arretee_le, now())
        where tenant_id = $1 and phone_number_id = $2 and retiree_le is null`,
      [tenantId, phoneNumberId],
    );
    this.oublier();
    return (rowCount ?? 0) > 0;
  }
}
