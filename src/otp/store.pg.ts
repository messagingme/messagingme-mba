import type { Pool, PoolClient } from 'pg';
import { enTransaction } from '../db/transaction';

/**
 * La réserve de numéros fournis et les codes de vérification captés (migration 0210, lot 3a, spec
 * `docs/superpowers/specs/2026-10-05-pont-du-code-design.md`).
 *
 * ⚠️ LA RÉSERVE EST À NOUS, PAS À UN CLIENT : `declarer`, `lister`, `ecrireCode` et la suite ne filtrent sur aucun
 * espace, délibérément (la session d'exploitation de /ops et la route du pont, que l'Asterisk appelle pour un numéro
 * et non pour un espace). Ce qu'un CLIENT lit ou écrit (lot 3b : `attribuer`, `numeroDeLEspace`, `codeDeLEspace`,
 * `remplacerNumero`, `rendre` ; 0280 : `destinationDeLEspace`, `retenirDestination`) est filtré sur l'espace, sans exception.
 */

/** Un code ne vaut que dix minutes ; la transcription sert au dépannage une semaine, puis le balayage l'efface. */
export const RETENTION_CODES_VERIFICATION_JOURS = 7;

/** `bloque` (0212) : refusé par Meta (déjà actif ailleurs), sorti de la réserve sans être résilié chez DIDWW. */
export type StatutNumero = 'libre' | 'attribue' | 'resilie' | 'bloque';

/** Où va le numéro fourni d'un espace (migration 0280) : la fenêtre de Meta, ou l'application WhatsApp Business. */
export type DestinationNumeroFourni = 'api' | 'application';

/** La destination retenue, et l'heure où elle l'a été (`null` seulement pour une ligne écrite à la main). */
export interface DestinationRetenue {
  destination: DestinationNumeroFourni;
  depuis: Date | null;
}

/** Pourquoi un appel n'a pas rendu de code : la transcription n'a pas abouti, ou aucun code certain n'y figure. */
export type CauseSansCode = 'transcription_indisponible' | 'code_introuvable';

export interface NumeroFourni {
  id: string;
  /** Chiffres seuls, au format `wa_id` (« 442071234567 »). */
  numero: string;
  didwwDidId: string;
  statut: StatutNumero;
  tenantId: string | null;
  attribueLe: Date | null;
  creeLe: Date;
}

export interface CodeCapte {
  appelId: string;
  recuLe: Date;
  /** `null` = aucun code certain : `cause` dit pourquoi. */
  code: string | null;
  transcription: string;
  cause: CauseSansCode | null;
}

export interface NumeroEtDernierCode extends NumeroFourni {
  dernierCode: CodeCapte | null;
  /**
   * Un numéro LIBRE dont quelqu'un se sert déjà hors attribution (`UTILISE_AILLEURS_SQL`) : `application` (un compte
   * d'application WhatsApp Business l'a porté chez nous) ou `api` (le numéro API d'un espace). `null` sinon, et pour
   * tout numéro qui n'est pas libre.
   */
  ailleurs: 'application' | 'api' | null;
}

/** Ce que l'appel a produit, écrit tel quel. Les deux formes sont celles du CHECK `codes_verification_cause_chk`. */
export type ResultatAppel =
  | { appelId: string; code: string; transcription: string }
  | { appelId: string; code: null; transcription: string; cause: CauseSansCode };

interface LigneNumero {
  id: string; numero: string; didww_did_id: string; statut: StatutNumero; tenant_id: string | null;
  attribue_le: Date | null; cree_le: Date;
}

const COLONNES_NUMERO = 'n.id, n.numero, n.didww_did_id, n.statut, n.tenant_id, n.attribue_le, n.cree_le';

/**
 * 🔴 UN NUMÉRO DE LA RÉSERVE QUE QUELQU'UN UTILISE DÉJÀ NE PART JAMAIS (2026-10-28, plan
 * `docs/superpowers/plans/2026-10-28-reserve-numeros-ailleurs.md`). Vécu : le numéro DIDWW de l'application WhatsApp
 * Business de Julien, relié par QR code sans passer par l'attribution, était resté `libre` ; un client l'aurait reçu,
 * Meta l'aurait vérifié sur notre central, et l'application aurait perdu le numéro. Deux preuves, sur l'alias `n` :
 * un compte d'application qui porte ce numéro, QUEL QUE SOIT son statut (un compte retiré chez nous laisse
 * l'application en service sur le téléphone), ou un numéro API d'un espace aux mêmes chiffres. Prudence assumée : un
 * numéro écarté à tort coûte un abonnement DIDWW, un numéro donné à tort coupe l'application de quelqu'un. La garde se
 * DÉDUIT à chaque lecture (attribution, compte des libres, liste de /ops) : aucun statut à tenir à jour.
 */
const EN_APPLICATION_SQL = 'exists (select 1 from comptes_application ca where ca.numero = n.numero)';
const EN_API_SQL = "exists (select 1 from phone_numbers pn where regexp_replace(coalesce(pn.display_phone_number, ''), '[^0-9]', '', 'g') = n.numero)";
export const UTILISE_AILLEURS_SQL = `(${EN_APPLICATION_SQL} or ${EN_API_SQL})`;

function versNumero(l: LigneNumero): NumeroFourni {
  return {
    id: l.id, numero: l.numero, didwwDidId: l.didww_did_id, statut: l.statut, tenantId: l.tenant_id,
    attribueLe: l.attribue_le, creeLe: l.cree_le,
  };
}

/** Un code d'un espace ne vaut que le temps de le recopier dans la fenêtre de Meta (lot 3b). */
export const VALIDITE_CODE_ESPACE_MINUTES = 15;

/**
 * 🔴 L'APPEL DE L'APPLICATION WHATSAPP NE LIVRE SON CODE QU'À LA VOIE DE L'APPLICATION (2026-11-17, plan
 * `docs/superpowers/plans/2026-11-17-numero-fourni-application-et-essai.md`, lot 1). Vécu : un espace de la console a
 * tapé le numéro fourni dans son application WhatsApp au lieu de la fenêtre de Meta ; si le code lui était parvenu, notre
 * numéro aurait fini dans un téléphone, jamais relié, puis bloqué. Meta dicte son code dès le décroché ; l'application
 * demande d'abord une touche (« To receive your WhatsApp verification code, press… », « appuyez sur… », transcriptions
 * du 2026-10-21 et du 2026-11-17) : c'est ce menu qui la reconnaît, sur la transcription gardée avec chaque appel.
 * ⚠️ Le menu n'est reconnu qu'en anglais et en français (les numéros de la réserve sont britanniques) : dans une autre
 * langue, l'appel passe pour celui de Meta, et son code se montre comme avant ce lot (l'échec reste ouvert, jamais une
 * perte de numéro).
 *
 * DEUX QUESTIONS DISTINCTES, ET LA CONFONDRE A ÉTÉ LE ROUGE DE LA RELECTURE DU LOT :
 *  - « Le montrer MAINTENANT ? » (`CODE_A_MONTRER_SQL` : la page, Claude) : seulement si l'espace est sur la voie de
 *    l'application en ce moment. Un espace passé à la fenêtre de Meta ne doit pas y recopier un code de l'application.
 *  - « A-t-il PU servir ? » (`APPEL_APPLICATION_CACHE_SQL` : garder le numéro ou le rendre, à l'abandon comme au
 *    remplacement, et la reprise) : se juge à l'HEURE DE L'APPEL. Un code montré sur la voie de l'application, puis la
 *    voie changée pour la fenêtre de Meta, a pu créer un compte sur le téléphone : la destination courante ne le dit plus,
 *    et rendre ce numéro le donnerait à un autre client avec un compte vivant dessus. On ne connaît que la DERNIÈRE
 *    destination et son heure (0280) : un appel n'est sûrement caché que si l'espace n'est pas sur la voie de
 *    l'application ET ne l'a pas quittée depuis l'appel. Dans le doute, il compte (un numéro gardé à tort coûte un
 *    abonnement, un numéro rendu à tort coupe le compte de quelqu'un).
 */
export const MOTIF_MENU_APPLICATION = 'press|appuy';
const APPEL_APPLICATION_SQL = `c.transcription ~* '${MOTIF_MENU_APPLICATION}'`;
// ⚠️ `coalesce` : une destination nulle (la console, les espaces d'avant 0280) donnerait NULL, et les négations ne
// verraient plus jamais l'appel.
const SUR_LA_VOIE_APPLICATION_SQL = `coalesce(t.numero_fourni_destination, '') = 'application'`;
/** À montrer maintenant : un appel de Meta, ou celui de l'application tant que l'espace est sur sa voie. */
const CODE_A_MONTRER_SQL = `(not ${APPEL_APPLICATION_SQL} or ${SUR_LA_VOIE_APPLICATION_SQL})`;
/**
 * Un appel de l'application dont le code n'a JAMAIS pu se montrer : l'espace n'est pas sur la voie de l'application, et
 * sa destination n'a pas changé depuis l'appel (donc elle était déjà celle-ci à l'heure de l'appel).
 */
const APPEL_APPLICATION_CACHE_SQL = `(${APPEL_APPLICATION_SQL} and not ${SUR_LA_VOIE_APPLICATION_SQL}`
  + ' and (t.numero_fourni_destination_le is null or t.numero_fourni_destination_le <= c.recu_le))';

/** La même reconnaissance que `APPEL_APPLICATION_SQL`, côté serveur (tests, journal). */
export function estAppelDeLApplication(transcription: string): boolean {
  return new RegExp(MOTIF_MENU_APPLICATION, 'i').test(transcription);
}

/** Le numéro DIDWW est déjà déclaré sous un AUTRE numéro : une incohérence que la route rend en 409. */
export class DidDejaDeclare extends Error {
  constructor(readonly didwwDidId: string) {
    super(`le numéro DIDWW ${didwwDidId} est déjà déclaré sous un autre numéro`);
    this.name = 'DidDejaDeclare';
  }
}

export class PgNumerosFournisStore {
  constructor(private readonly pool: Pool) {}

  /**
   * Inscrit un numéro `libre`. Déjà déclaré : rend la ligne existante, `cree: false`, sans rien réécrire (une
   * seconde déclaration ne remet jamais à `libre` un numéro attribué). Le même identifiant DIDWW sous un autre
   * numéro lève `DidDejaDeclare`.
   */
  async declarer(numero: string, didwwDidId: string): Promise<{ numero: NumeroFourni; cree: boolean }> {
    try {
      const ins = await this.pool.query<LigneNumero>(
        `insert into numeros_fournis as n (numero, didww_did_id) values ($1, $2)
           on conflict (numero) do nothing
         returning ${COLONNES_NUMERO}`,
        [numero, didwwDidId],
      );
      if (ins.rows[0]) return { numero: versNumero(ins.rows[0]), cree: true };
    } catch (err) {
      if ((err as { code?: unknown }).code === '23505') throw new DidDejaDeclare(didwwDidId);
      throw err;
    }
    const existant = await this.parNumero(numero);
    if (!existant) throw new Error(`numéro ${numero} introuvable juste après un conflit d’insertion`);
    return { numero: existant, cree: false };
  }

  async parNumero(numero: string): Promise<NumeroFourni | null> {
    const res = await this.pool.query<LigneNumero>(`select ${COLONNES_NUMERO} from numeros_fournis n where n.numero = $1`, [numero]);
    return res.rows[0] ? versNumero(res.rows[0]) : null;
  }

  /** La réserve entière, avec le dernier appel reçu par numéro et ce qui retient un numéro libre, pour /ops. */
  async lister(): Promise<NumeroEtDernierCode[]> {
    const res = await this.pool.query<LigneNumero & {
      appel_id: string | null; recu_le: Date | null; code: string | null; transcription: string | null; cause: CauseSansCode | null;
      ailleurs: 'application' | 'api' | null;
    }>(
      `select ${COLONNES_NUMERO}, c.appel_id, c.recu_le, c.code, c.transcription, c.cause,
              case when n.statut = 'libre' and ${EN_APPLICATION_SQL} then 'application'
                   when n.statut = 'libre' and ${EN_API_SQL} then 'api' end as ailleurs
         from numeros_fournis n
         left join lateral (
           select appel_id, recu_le, code, transcription, cause from codes_verification
            where numero_id = n.id order by recu_le desc limit 1
         ) c on true
        order by n.cree_le desc`,
    );
    return res.rows.map((l) => ({
      ...versNumero(l),
      ailleurs: l.ailleurs,
      dernierCode: l.appel_id === null || l.recu_le === null ? null : {
        appelId: l.appel_id, recuLe: l.recu_le, code: l.code, transcription: l.transcription ?? '', cause: l.cause,
      },
    }));
  }

  /**
   * Écrit l'appel. `false` = cet appel était déjà lu (le script a rejoué l'envoi) : rien n'est réécrit. SAUF une ligne
   * `transcription_indisponible` : une panne passagère du service ne doit pas perdre le code, et le rejeu de
   * l'enregistrement (que le script garde, la route ayant rendu 503) la remplace.
   */
  async ecrireCode(numeroId: string, r: ResultatAppel): Promise<boolean> {
    const res = await this.pool.query(
      `insert into codes_verification as c (numero_id, appel_id, code, transcription, cause) values ($1, $2, $3, $4, $5)
         on conflict (appel_id) do update
           set code = excluded.code, transcription = excluded.transcription, cause = excluded.cause, recu_le = now()
           where c.cause = 'transcription_indisponible'`,
      [numeroId, r.appelId, r.code, r.transcription, r.code === null ? r.cause : null],
    );
    return (res.rowCount ?? 0) > 0;
  }

  /** Cet appel a-t-il déjà été LU (un code, ou aucun code certain) ? Une transcription en panne ne compte pas. */
  async appelDejaLu(appelId: string): Promise<boolean> {
    const res = await this.pool.query(
      `select 1 from codes_verification where appel_id = $1 and cause is distinct from 'transcription_indisponible'`,
      [appelId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  /** Les appels reçus sur ce numéro depuis `minutes` minutes : le plafond de la transcription, qui part sur notre clé. */
  async appelsRecents(numeroId: string, minutes: number): Promise<number> {
    const res = await this.pool.query<{ n: number }>(
      `select count(*)::int as n from codes_verification where numero_id = $1 and recu_le > now() - make_interval(mins => $2::int)`,
      [numeroId, Math.max(1, Math.floor(minutes))],
    );
    return res.rows[0]?.n ?? 0;
  }

  /**
   * Les appels de plus de `jours` jours : ils ne servent plus qu'au dépannage, et un code n'est valable que dix minutes.
   * 🔴 SAUF ceux d'un numéro encore ATTRIBUÉ : un code capté prouve que Meta a vu ce numéro, et la libération (lot 4,
   * livraison B), qui arrive au plus tôt 7 jours après la fin de l'abonnement, s'en sert pour le résilier plutôt que le
   * remettre en réserve (rouge 2 de la relecture de B). Ils partent à la purge suivant la sortie du numéro.
   */
  async purgerAvant(jours: number): Promise<number> {
    const res = await this.pool.query(
      `delete from codes_verification
        where recu_le < now() - make_interval(days => $1::int)
          and numero_id not in (select id from numeros_fournis where statut = 'attribue')`,
      [Math.max(1, Math.floor(jours))],
    );
    return res.rowCount ?? 0;
  }

  // ----- Le numéro fourni côté client (lot 3b, migration 0212) : TOUT est filtré sur l'espace -----

  /** Le numéro attribué à cet espace, `null` s'il n'en a pas. */
  async numeroDeLEspace(tenantId: string): Promise<NumeroFourni | null> {
    return lireAttribue(this.pool, tenantId);
  }

  /**
   * Donne un numéro libre à l'espace, ou rend celui qu'il a déjà ; `null` = la réserve est vide. Une seule instruction
   * pose ensemble le statut, l'espace et l'heure (sans quoi `numeros_fournis_espace_chk` refuse), sur une ligne prise
   * en `for update skip locked` : deux espaces qui se disputent le dernier numéro n'en reçoivent pas deux. Deux
   * demandes du MÊME espace : l'index `numeros_fournis_un_par_espace` fait échouer la seconde (23505), qui relit la
   * première.
   */
  async attribuer(tenantId: string): Promise<NumeroFourni | null> {
    try {
      return await attribuerAvec(this.pool, tenantId);
    } catch (err) {
      if ((err as { code?: unknown }).code !== '23505') throw err;
      return lireAttribue(this.pool, tenantId);
    }
  }

  /**
   * Le dernier code CERTAIN capté sur le numéro de cet espace, reçu après l'attribution et dans les
   * `VALIDITE_CODE_ESPACE_MINUTES` dernières minutes. Jamais la transcription, jamais le code d'un autre espace, jamais
   * celui de l'application WhatsApp hors de sa voie (`CODE_A_MONTRER_SQL` : la voie de MAINTENANT).
   */
  async codeDeLEspace(tenantId: string): Promise<{ code: string; recuLe: Date } | null> {
    const res = await this.pool.query<{ code: string; recu_le: Date }>(
      `select c.code, c.recu_le
         from codes_verification c join numeros_fournis n on n.id = c.numero_id join tenants t on t.id = n.tenant_id
        where n.tenant_id = $1 and n.statut = 'attribue' and c.code is not null and ${CODE_A_MONTRER_SQL}
          and c.recu_le >= n.attribue_le and c.recu_le > now() - make_interval(mins => $2::int)
        order by c.recu_le desc limit 1`,
      [tenantId, VALIDITE_CODE_ESPACE_MINUTES],
    );
    const l = res.rows[0];
    return l ? { code: l.code, recuLe: l.recu_le } : null;
  }

  /**
   * Un code a-t-il été capté pour le numéro de l'espace depuis son attribution, SANS borne de temps (2026-10-31) ? C'est ce
   * que lit « Abandonner » : un numéro vérifié une fois porte peut-être un compte WhatsApp Business (le numéro fourni mis
   * dans l'application, ou la fenêtre de Meta) et ne retourne jamais à la réserve, comme à la libération (`vuDeMeta`).
   * `codeDeLEspace`, borné à 15 minutes, ne suffit pas : on abandonne parfois des jours après. `depuis` (la reprise,
   * migration 0280) : seulement un code arrivé depuis cette heure, celle où la destination a été retenue.
   */
  async codeCapteDepuisLAttribution(tenantId: string, depuis: Date | null = null): Promise<boolean> {
    // Seul un code de l'application SÛREMENT jamais montré (`APPEL_APPLICATION_CACHE_SQL`, la voie à l'heure de l'appel)
    // ne compte pas : il n'a pu créer aucun compte. Dans le doute, il compte, et le numéro est gardé.
    const res = await this.pool.query(
      `select 1 from codes_verification c join numeros_fournis n on n.id = c.numero_id join tenants t on t.id = n.tenant_id
        where n.tenant_id = $1 and n.statut = 'attribue' and c.code is not null and c.recu_le >= n.attribue_le
          and not ${APPEL_APPLICATION_CACHE_SQL}
          and ($2::timestamptz is null or c.recu_le >= $2::timestamptz)
        limit 1`,
      [tenantId, depuis],
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * L'application WhatsApp a appelé le numéro de cet espace dans les `VALIDITE_CODE_ESPACE_MINUTES` dernières minutes,
   * alors que l'espace n'était pas sur la voie de l'application et ne l'est toujours pas (`APPEL_APPLICATION_CACHE_SQL`) :
   * quelqu'un a tapé le numéro dans une application WhatsApp au lieu de la fenêtre de Meta. La page et Claude le lui
   * disent, avec ou sans code lu.
   */
  async appelDeLApplicationRecent(tenantId: string): Promise<boolean> {
    const res = await this.pool.query(
      `select 1 from codes_verification c join numeros_fournis n on n.id = c.numero_id join tenants t on t.id = n.tenant_id
        where n.tenant_id = $1 and n.statut = 'attribue' and c.recu_le >= n.attribue_le
          and c.recu_le > now() - make_interval(mins => $2::int)
          and ${APPEL_APPLICATION_CACHE_SQL}
        limit 1`,
      [tenantId, VALIDITE_CODE_ESPACE_MINUTES],
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Où va le numéro fourni de l'espace (migration 0280) : par la fenêtre de Meta (`api`), ou DANS l'application WhatsApp
   * Business (`application`), et depuis quand. `null` = inconnue (jamais retenue). C'est elle qui dit comment reprendre une
   * connexion une fois le lien d'une heure ou le code de 15 minutes passés (`modeDeReprise`).
   */
  async destinationDeLEspace(tenantId: string): Promise<DestinationRetenue | null> {
    const res = await this.pool.query<{ d: DestinationNumeroFourni | null; le: Date | null }>(
      'select numero_fourni_destination as d, numero_fourni_destination_le as le from tenants where id = $1',
      [tenantId],
    );
    const l = res.rows[0];
    return l?.d ? { destination: l.d, depuis: l.le } : null;
  }

  /**
   * Retient la destination du numéro fourni de l'espace, et son heure (`start_whatsapp_connection`). 🔴 L'appelant ne
   * l'appelle que quand elle CHANGE : l'heure dit depuis quand un code prouve le compte de l'application, et la reposer
   * à chaque lien ferait oublier un compte déjà créé (le cas même de Johan).
   */
  async retenirDestination(tenantId: string, destination: DestinationNumeroFourni): Promise<void> {
    await this.pool.query(
      'update tenants set numero_fourni_destination = $2, numero_fourni_destination_le = now() where id = $1',
      [tenantId, destination],
    );
  }

  /**
   * Meta refuse le numéro de cet espace (déjà actif sur WhatsApp ailleurs) : il passe en `bloque`, sans espace, et un
   * autre est attribué, dans la même transaction. `bloque` = le numéro sorti (`null` si l'espace n'en avait pas),
   * `nouveau` = le suivant (`null` si la réserve est vide). `rendu` : le numéro sorti est retourné à la réserve, parce
   * que seule l'application WhatsApp l'a appelé hors de sa voie (lot 1 du 2026-11-17) ; `bloque` vaut alors `null`.
   */
  async remplacerNumero(tenantId: string): Promise<{ bloque: string | null; nouveau: NumeroFourni | null; rendu?: string }> {
    try {
      return await this.remplacerDansUneTransaction(tenantId);
    } catch (err) {
      // Une attribution concurrente du même espace (« Obtenir » et « Remplacer » en même temps) : la transaction est
      // annulée, rien n'a été bloqué, et l'attribution qui a gagné est relue.
      if ((err as { code?: unknown }).code !== '23505') throw err;
      return { bloque: null, nouveau: await lireAttribue(this.pool, tenantId) };
    }
  }

  private async remplacerDansUneTransaction(tenantId: string): Promise<{ bloque: string | null; nouveau: NumeroFourni | null; rendu?: string }> {
    return enTransaction(this.pool, async (client) => {
      // 🔴 Seule l'application WhatsApp a appelé, et aucun de ses codes n'a pu se montrer (lot 1 du 2026-11-17) : aucun
      // compte n'existe, et ce n'est pas Meta qui refuse ce numéro. Il retourne à la réserve au lieu d'être perdu. Lu AVANT
      // de sortir le numéro (la sortie efface l'espace dont dépend `APPEL_APPLICATION_CACHE_SQL`), sous le VERROU de sa
      // ligne : l'enregistrement d'un appel pose un FOR KEY SHARE sur elle (clé étrangère), donc un appel de Meta qui
      // arrive pendant le remplacement attend sa fin au lieu de passer inaperçu (jaune 2 de la relecture du lot).
      // ⚠️ Deux requêtes, pas une : le verrou d'abord, la lecture ensuite. Dans la même requête, les sous-requêtes liraient
      // l'instantané d'AVANT l'attente du verrou, et un appel validé pendant cette attente resterait invisible.
      await client.query(`select 1 from numeros_fournis where tenant_id = $1 and statut = 'attribue' for update`, [tenantId]);
      const seulementLApplication = (await client.query<{ oui: boolean }>(
        `select exists (select 1 from codes_verification c where c.numero_id = n.id and c.recu_le >= n.attribue_le
                           and ${APPEL_APPLICATION_CACHE_SQL})
            and not exists (select 1 from codes_verification c where c.numero_id = n.id and c.recu_le >= n.attribue_le
                           and not ${APPEL_APPLICATION_CACHE_SQL}) as oui
           from numeros_fournis n join tenants t on t.id = n.tenant_id
          where n.tenant_id = $1 and n.statut = 'attribue'`,
        [tenantId],
      )).rows[0]?.oui === true;
      const b = await client.query<{ id: string; numero: string }>(
        `update numeros_fournis set statut = 'bloque', tenant_id = null
          where tenant_id = $1 and statut = 'attribue' returning id, numero`,
        [tenantId],
      );
      const sorti = b.rows[0];
      // Le nouveau numéro est pris PENDANT que l'ancien est encore bloqué : l'attribution ne peut pas le redonner.
      const nouveau = await attribuerAvec(client, tenantId);
      if (sorti && seulementLApplication && nouveau === null) {
        // Réserve vide : l'espace garde son numéro, qui marche (la fenêtre de Meta l'attend), plutôt que de rester sans.
        // `nouveau: null` : la route répond « réserve vide » au lieu d'un 200 qui rendrait le même numéro sans le dire
        // (lot 3, jaune de la relecture du lot 1).
        await client.query(`update numeros_fournis set statut = 'attribue', tenant_id = $2 where id = $1`, [sorti.id, tenantId]);
        return { bloque: null, nouveau: null };
      }
      if (sorti && seulementLApplication) {
        await client.query(`update numeros_fournis set statut = 'libre', attribue_le = null where id = $1`, [sorti.id]);
        return { bloque: null, nouveau, rendu: sorti.numero };
      }
      return { bloque: sorti?.numero ?? null, nouveau };
    });
  }

  /** Rend le numéro de cet espace à la réserve ; rend le numéro rendu, `null` s'il n'y en avait pas. */
  async rendre(tenantId: string): Promise<string | null> {
    const res = await this.pool.query<{ numero: string }>(
      `update numeros_fournis set statut = 'libre', tenant_id = null, attribue_le = null
        where tenant_id = $1 and statut = 'attribue' returning numero`,
      [tenantId],
    );
    return res.rows[0]?.numero ?? null;
  }

  /**
   * Sort le numéro de cet espace SANS le rendre à la réserve (`bloque`, comme « Remplacer ») : un numéro qui porte un
   * compte WhatsApp Business (filière application, relecture du lot) ne doit servir à personne d'autre. Rend le numéro.
   */
  async bloquer(tenantId: string): Promise<string | null> {
    const res = await this.pool.query<{ numero: string }>(
      `update numeros_fournis set statut = 'bloque', tenant_id = null
        where tenant_id = $1 and statut = 'attribue' returning numero`,
      [tenantId],
    );
    return res.rows[0]?.numero ?? null;
  }

  /**
   * Les numéros que l'attribution peut encore donner : l'alerte de réserve basse et le parcours du Pro. Le même
   * prédicat que `attribuerAvec`, sans quoi on promettrait un numéro qu'elle refuse.
   */
  async compterLibres(): Promise<number> {
    const res = await this.pool.query<{ libres: number }>(
      `select count(*)::int as libres from numeros_fournis n where n.statut = 'libre' and not ${UTILISE_AILLEURS_SQL}`,
    );
    return res.rows[0]?.libres ?? 0;
  }

  /**
   * Sort de la réserve un numéro `libre` et sans espace (/ops) : il passe en `bloque`, exclu de l'attribution, ses codes
   * toujours captés. Rend le numéro, `null` s'il n'était pas libre (attribué, déjà sorti) ou n'existe pas : rien n'est
   * écrit.
   */
  async sortirDeLaReserve(id: string): Promise<string | null> {
    const res = await this.pool.query<{ numero: string }>(
      `update numeros_fournis set statut = 'bloque' where id = $1 and statut = 'libre' and tenant_id is null returning numero`,
      [id],
    );
    return res.rows[0]?.numero ?? null;
  }
}

async function lireAttribue(db: Pool | PoolClient, tenantId: string): Promise<NumeroFourni | null> {
  const res = await db.query<LigneNumero>(
    `select ${COLONNES_NUMERO} from numeros_fournis n where n.tenant_id = $1 and n.statut = 'attribue'`,
    [tenantId],
  );
  return res.rows[0] ? versNumero(res.rows[0]) : null;
}

/** L'attribution en une instruction : l'existant de l'espace, sinon le plus ancien numéro libre, pris sans attendre. */
/**
 * L'attribution, sur une connexion donnée : `attribuer` la prend sur le pool, l'abonnement du numéro (lot 3c,
 * `src/stripe/abonnements.pg.ts`) DANS la transaction qui enregistre le paiement, pour qu'un abonnement payé ait
 * son numéro ou qu'aucun des deux ne soit écrit. Un numéro utilisé ailleurs (`UTILISE_AILLEURS_SQL`) n'est jamais pris.
 */
export async function attribuerAvec(db: Pool | PoolClient, tenantId: string): Promise<NumeroFourni | null> {
  const existant = await lireAttribue(db, tenantId);
  if (existant) return existant;
  const res = await db.query<LigneNumero>(
    `update numeros_fournis n set statut = 'attribue', tenant_id = $1, attribue_le = now()
      where n.id = (select n.id from numeros_fournis n where n.statut = 'libre' and not ${UTILISE_AILLEURS_SQL}
                     order by n.cree_le, n.id limit 1 for update skip locked)
     returning ${COLONNES_NUMERO}`,
    [tenantId],
  );
  return res.rows[0] ? versNumero(res.rows[0]) : null;
}
