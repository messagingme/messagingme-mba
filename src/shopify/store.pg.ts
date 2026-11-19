import type { Pool, PoolClient } from 'pg';
import { decryptSecret, encryptSecret } from '../crypto/secretbox';
import { enTransaction } from '../db/transaction';
import { estDonneeShopify, type DonneeShopify, type EvenementShopify } from './donnees';
import type { LigneShopify } from './lignes';

/**
 * LE STORE DU CONNECTEUR SHOPIFY (plan 2026-10-21, lot 1), seul à écrire les tables `shopify_*` (migration 0246) ;
 * `purgeMany` y efface aussi les lignes d'une fiche purgée.
 *
 * 🔴 `tenant_id = $1` SUR CHAQUE REQUÊTE, sauf SIX lectures transverses nommées ici : `boutiqueParDomaine` et
 * `couperParDomaine` (ce sont elles qui DONNENT l'espace, à partir du domaine qui signe un webhook), et quatre balayages
 * de toutes les boutiques : `purgerEvenements`, `reclamerPaniersDus` (qui joint chaque panier à SA boutique et à SA
 * ligne par `tenant_id`), `purgerPaniers` et `attentesAnciennes` (le filet de l'activation, console).
 *
 * 🔴 LE SECRET NE SORT JAMAIS VERS UN ÉCRAN : `lire` ne le sélectionne pas, et seule `boutiqueParDomaine` le rend
 * déchiffré, pour vérifier une signature.
 */

export type EtatBoutique = 'connectee' | 'coupee';
/**
 * Par où la boutique a été branchée (migration 0249) : `claude_code`, l'app de la CLI, dont les webhooks sont déclarés
 * dans l'app ; `console`, l'app créée à la main sur le tableau de bord de Shopify, dont NOTRE serveur abonne les
 * webhooks par l'API. Les confondre ferait tout recevoir en double.
 */
export type OrigineBoutique = 'console' | 'claude_code';

/** Un message préparé par l'assistant de la console, dont le modèle attend l'approbation de Meta (migration 0249). */
export interface AttenteMessage {
  evenement: EvenementShopify;
  modele: string;
  langue: string;
  variables: DonneeShopify[];
  /** La relance seulement : le délai à poser à l'activation. */
  delaiMinutes: number | null;
  creeLe: string;
}

export interface VueBoutique {
  domaine: string;
  nom: string | null;
  pays: string | null;
  devise: string | null;
  etat: EtatBoutique;
  motifCoupure: string | null;
  coupeeLe: string | null;
  connecteeLe: string;
  dernierEvenementLe: string | null;
  delaiPanierMinutes: number;
  origine: OrigineBoutique;
  /** La pause (lot 5, décision 15) : rien ne part, aucun panier n'est noté ; `null` = active. */
  pauseLe: string | null;
}

/**
 * Un message se règle par un modèle approuvé chez Meta (filière API) OU par un texte simple (numéro relié par QR code,
 * plan 2026-10-23), jamais les deux : la contrainte `shopify_messages_modele_ou_texte` (migration 0252) le tient.
 */
export interface MessageBranche {
  evenement: EvenementShopify;
  modele: string | null;
  /** Le texte, ses données entre doubles accolades ({{first_name}}). */
  texte: string | null;
  langue: string;
  /** Modèle : les données de {{1}}, {{2}}... dans l'ordre. Texte : les données que ses repères citent. */
  variables: DonneeShopify[];
  actif: boolean;
  modifieLe: string;
}

export interface BoutiqueSignee {
  tenantId: string;
  etat: EtatBoutique;
  secret: string;
  pays: string | null;
  devise: string | null;
  origine: OrigineBoutique;
  /** En pause, un webhook est rendu 200 sans rien réserver ni envoyer (perdu, jamais rejoué). */
  pause: boolean;
}

/** De quoi demander un jeton à Shopify pour l'espace : l'import des clients (lot 3). */
export interface AccesBoutique {
  domaine: string;
  clientId: string;
  secret: string;
  pays: string | null;
  etat: EtatBoutique;
  origine: OrigineBoutique;
}

export interface Connexion {
  domaine: string;
  clientId: string;
  secretClair: string;
  nom: string | null;
  pays: string | null;
  devise: string | null;
  par: string | null;
  origine: OrigineBoutique;
}

/** `boutique_ailleurs` : un autre espace tient cette boutique, connectée. */
export type IssueConnexionBoutique = 'ok' | 'boutique_ailleurs';

/** Ce que le paiement dit d'une commande (`orders/paid`) : le montant reste un texte décimal, comme Shopify le donne. */
export interface DetailsCommande {
  payeeLe: Date;
  /** Nul quand le montant ne se lit pas : la commande compte, sa dépense non. */
  montant: string | null;
  devise: string | null;
  test: boolean;
}

/** Un panier réclamé pour sa relance : le scénario de la ligne du panier dit ce qui part (`./premier-bloc.ts`). */
export interface PanierDu {
  tenantId: string;
  jeton: string;
  telephone: string;
  nom: string | null;
  lien: string;
  domaine: string;
  workflowId: string;
}

/** Une issue nulle depuis plus longtemps que ce bail = un traitement mort en route : il se reprend. */
export const BAIL_EVENEMENT_S = 120;

/**
 * Ce qui rend un panier DÛ : ouvert, jamais relancé, avec un téléphone et un lien, dont la dernière modification a dépassé
 * le délai de SA boutique, connectée et hors pause, et dont la ligne `checkout_abandoned` est allumée (lot 5, migration
 * 0299). 🔴 Et modifié depuis la dernière reprise de la boutique ou le dernier rallumage de la ligne (`paniers_depuis`,
 * décision 15) : un panier noté avant ne part jamais après coup. Aucune affirmation du marchand n'est exigée (décision de
 * Julien du 2026-10-26 : le consentement de ses clients est sa responsabilité).
 */
const PANIERS_DUS = `from shopify_paniers p
           join shopify_boutiques b on b.tenant_id = p.tenant_id
           join shopify_lignes l on l.tenant_id = p.tenant_id and l.evenement = 'checkout_abandoned'
          where p.ferme_le is null and p.relance_le is null and p.telephone is not null and p.lien is not null
            and b.etat = 'connectee' and b.pause_le is null and l.actif
            and (b.paniers_depuis is null or p.maj_le >= b.paniers_depuis)
            and p.maj_le < now() - make_interval(mins => b.delai_panier_minutes)`;

export type Reservation = 'nouveau' | 'en_cours' | 'servi';

interface LigneBoutique {
  domaine: string; nom: string | null; pays: string | null; devise: string | null; etat: EtatBoutique;
  motif_coupure: string | null; coupee_le: Date | null; connectee_le: Date; dernier_evenement_le: Date | null;
  delai_panier_minutes: number; origine: OrigineBoutique; pause_le: Date | null;
}

interface LigneLue { evenement: EvenementShopify; workflow_id: string; actif: boolean; modifie_le: Date }

const versLigne = (r: LigneLue): LigneShopify => ({
  evenement: r.evenement, workflowId: r.workflow_id, actif: r.actif, modifieLe: r.modifie_le.toISOString(),
});

export class PgShopifyStore {
  constructor(private readonly pool: Pool, private readonly cle: string) {}

  async lire(tenantId: string): Promise<VueBoutique | null> {
    const res = await this.pool.query<LigneBoutique>(
      `select domaine, nom, pays, devise, etat, motif_coupure, coupee_le, connectee_le, dernier_evenement_le,
              delai_panier_minutes, origine, pause_le
         from shopify_boutiques where tenant_id = $1`,
      [tenantId],
    );
    const r = res.rows[0];
    if (!r) return null;
    return {
      domaine: r.domaine, nom: r.nom, pays: r.pays, devise: r.devise, etat: r.etat, motifCoupure: r.motif_coupure,
      coupeeLe: r.coupee_le?.toISOString() ?? null, connecteeLe: r.connectee_le.toISOString(),
      dernierEvenementLe: r.dernier_evenement_le?.toISOString() ?? null,
      delaiPanierMinutes: r.delai_panier_minutes, origine: r.origine, pauseLe: r.pause_le?.toISOString() ?? null,
    };
  }

  /**
   * La boutique de l'espace avec son secret déchiffré, pour demander un jeton (import des clients, lot 3), et à
   * personne d'autre : rien de ce qui est rendu ici ne sort de l'API.
   */
  async acces(tenantId: string): Promise<AccesBoutique | null> {
    const res = await this.pool.query<{ domaine: string; client_id: string; secret_chiffre: string; pays: string | null; etat: EtatBoutique; origine: OrigineBoutique }>(
      `select domaine, client_id, secret_chiffre, pays, etat, origine from shopify_boutiques where tenant_id = $1`,
      [tenantId],
    );
    const r = res.rows[0];
    if (!r) return null;
    return { domaine: r.domaine, clientId: r.client_id, secret: decryptSecret(r.secret_chiffre, this.cle), pays: r.pays, etat: r.etat, origine: r.origine };
  }

  /**
   * EXCEPTION TRANSVERSE 1 : la boutique d'un domaine, qui DONNE l'espace d'un webhook. Le secret est rendu déchiffré,
   * pour vérifier la signature, et à personne d'autre.
   */
  async boutiqueParDomaine(domaine: string): Promise<BoutiqueSignee | null> {
    const res = await this.pool.query<{
      tenant_id: string; etat: EtatBoutique; secret_chiffre: string; pays: string | null; devise: string | null; origine: OrigineBoutique;
      en_pause: boolean;
    }>(
      `select tenant_id, etat, secret_chiffre, pays, devise, origine, pause_le is not null as en_pause
         from shopify_boutiques where domaine = $1`,
      [domaine],
    );
    const r = res.rows[0];
    if (!r) return null;
    return {
      tenantId: r.tenant_id, etat: r.etat, secret: decryptSecret(r.secret_chiffre, this.cle), pays: r.pays, devise: r.devise, origine: r.origine,
      pause: r.en_pause,
    };
  }

  /**
   * Relie la boutique à l'espace, ou la reprend. Un espace qui se reconnecte remplace son secret et repasse `connectee`.
   * Une boutique tenue par un AUTRE espace : refusée si elle y est connectée ; reprise si elle y est coupée (l'identifiant
   * et le secret valides prouvent qu'on la tient), et l'autre espace perd son branchement, pas ses fiches.
   * ⚠️ `consentement_par` et `consentement_le` ne sont plus lus depuis le 2026-10-26 (plus aucune affirmation n'est
   * demandée au marchand), et la connexion les efface encore : l'image d'avant, qui les lit, reste un retour arrière sûr
   * (une affirmation gardée d'une boutique d'essai y ferait écrire consentants les clients d'une autre boutique).
   */
  async connecter(tenantId: string, c: Connexion): Promise<IssueConnexionBoutique> {
    const secret = encryptSecret(c.secretClair, this.cle);
    // Deux espaces qui branchent la même boutique neuve en même temps : aucune ligne à verrouiller, l'unicité du domaine
    // départage, et le perdant est dit « ailleurs » plutôt qu'en panne (relecture du lot 1).
    try {
      return await this.connecterDansUneTransaction(tenantId, c, secret);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') return 'boutique_ailleurs';
      throw err;
    }
  }

  private connecterDansUneTransaction(tenantId: string, c: Connexion, secret: string): Promise<IssueConnexionBoutique> {
    return enTransaction(this.pool, async (client): Promise<IssueConnexionBoutique> => {
      const tenue = (await client.query<{ tenant_id: string; etat: EtatBoutique }>(
        `select tenant_id, etat from shopify_boutiques where domaine = $1 for update`, [c.domaine],
      )).rows[0];
      if (tenue && tenue.tenant_id !== tenantId) {
        if (tenue.etat === 'connectee') return 'boutique_ailleurs';
        await effacerBranchement(client, tenue.tenant_id);
      }
      await client.query(
        `insert into shopify_boutiques (tenant_id, domaine, client_id, secret_chiffre, nom, pays, devise, etat, connectee_par, connectee_le, maj_le, origine)
         values ($1, $2, $3, $4, $5, $6, $7, 'connectee', $8, now(), now(), $9)
         on conflict (tenant_id) do update set
           domaine = excluded.domaine, client_id = excluded.client_id, secret_chiffre = excluded.secret_chiffre,
           nom = excluded.nom, pays = excluded.pays, devise = excluded.devise, etat = 'connectee', origine = excluded.origine,
           motif_coupure = null, coupee_le = null, connectee_par = excluded.connectee_par, connectee_le = now(), maj_le = now(),
           consentement_par = null, consentement_le = null,
           -- Le suivi complet des commandes repart d ici apres une coupure (un trou, que l outil dit au lieu de le cacher)
           -- ou sur une autre boutique ; un nouveau secret sur la meme boutique branchee ne le remet pas a zero.
           commandes_depuis = case when shopify_boutiques.etat = 'coupee' or shopify_boutiques.domaine <> excluded.domaine
                                   then now() else shopify_boutiques.commandes_depuis end`,
        [tenantId, c.domaine, c.clientId, secret, c.nom, c.pays, c.devise, c.par, c.origine],
      );
      // 🔴 Les paniers notés sous l'ancienne connexion partent avec elle : les commandes d'une boutique coupée ne les ont
      // pas fermés, et ceux d'une autre boutique porteraient son lien (relecture du lot 2).
      await client.query(`delete from shopify_paniers where tenant_id = $1`, [tenantId]);
      return 'ok';
    });
  }

  /** Plus aucun message ; le secret reste, pour les sujets RGPD. Idempotent. */
  async couper(tenantId: string, motif: string): Promise<boolean> {
    const res = await this.pool.query(
      `update shopify_boutiques set etat = 'coupee', motif_coupure = $2, coupee_le = now(), maj_le = now()
        where tenant_id = $1 and etat <> 'coupee'`,
      [tenantId, motif],
    );
    return (res.rowCount ?? 0) > 0;
  }

  /** EXCEPTION TRANSVERSE 2 : `app/uninstalled`, qui ne connaît que le domaine. */
  async couperParDomaine(domaine: string, motif: string): Promise<void> {
    await this.pool.query(
      `update shopify_boutiques set etat = 'coupee', motif_coupure = $2, coupee_le = now(), maj_le = now()
        where domaine = $1 and etat <> 'coupee'`,
      [domaine, motif],
    );
  }

  /** `shop/redact` : le branchement part entier (secret, messages, paniers, événements, commandes), les fiches restent. */
  async effacerBoutique(tenantId: string): Promise<void> {
    await enTransaction(this.pool, (client) => effacerBranchement(client, tenantId));
  }

  async messages(tenantId: string): Promise<MessageBranche[]> {
    const res = await this.pool.query<{ evenement: EvenementShopify; modele: string | null; texte: string | null; langue: string; variables: unknown; actif: boolean; modifie_le: Date }>(
      `select evenement, modele, texte, langue, variables, actif, modifie_le from shopify_messages where tenant_id = $1 order by evenement`,
      [tenantId],
    );
    return res.rows.map((r) => ({
      evenement: r.evenement, modele: r.modele, texte: r.texte, langue: r.langue, actif: r.actif, modifieLe: r.modifie_le.toISOString(),
      // jsonb écrit par ce store seul ; une valeur illisible (version future) est retirée plutôt que de casser l'envoi.
      variables: Array.isArray(r.variables) ? r.variables.filter(estDonneeShopify) : [],
    }));
  }

  /**
   * Les attentes de l'ancien assistant (lot 5) : la bascule 0302 les a vidées, et plus rien ne les écrit. La lecture reste
   * pour le ménage de ses modèles (`traiterOubli`), qui garde un modèle encore attendu.
   */
  async attentes(tenantId: string): Promise<AttenteMessage[]> {
    const res = await this.pool.query<LigneAttente>(
      `select evenement, modele, langue, variables, delai_panier_minutes, cree_le from shopify_messages_attente where tenant_id = $1 order by evenement`,
      [tenantId],
    );
    return res.rows.map(versAttente);
  }

  async reglerDelaiPanier(tenantId: string, minutes: number): Promise<void> {
    await this.pool.query(`update shopify_boutiques set delai_panier_minutes = $2, maj_le = now() where tenant_id = $1`, [tenantId, minutes]);
  }

  /** Les lignes de l'espace (lot 5, migration 0299), une par événement au plus. */
  async lignes(tenantId: string): Promise<LigneShopify[]> {
    const res = await this.pool.query<LigneLue>(
      `select evenement, workflow_id, actif, modifie_le from shopify_lignes where tenant_id = $1 order by evenement`,
      [tenantId],
    );
    return res.rows.map(versLigne);
  }

  async ligne(tenantId: string, evenement: EvenementShopify): Promise<LigneShopify | null> {
    const r = (await this.pool.query<LigneLue>(
      `select evenement, workflow_id, actif, modifie_le from shopify_lignes where tenant_id = $1 and evenement = $2`,
      [tenantId, evenement],
    )).rows[0];
    return r ? versLigne(r) : null;
  }

  /**
   * Pose la ligne d'un événement, ÉTEINTE, sur son scénario. Une ligne existe déjà : elle est rendue telle quelle, son
   * scénario n'est jamais remplacé (deux créations simultanées gardent la première).
   */
  async poserLigne(tenantId: string, l: { evenement: EvenementShopify; workflowId: string; par: string | null }): Promise<LigneShopify> {
    await this.pool.query(
      `insert into shopify_lignes (tenant_id, evenement, workflow_id, actif, modifie_par, modifie_le)
       values ($1, $2, $3, false, $4, now())
       on conflict (tenant_id, evenement) do nothing`,
      [tenantId, l.evenement, l.workflowId, l.par],
    );
    const ligne = await this.ligne(tenantId, l.evenement);
    if (ligne === null) throw new Error(`ligne Shopify ${l.evenement} introuvable après sa pose`);
    return ligne;
  }

  /**
   * Allume la ligne ; `false` si elle l'était déjà ou n'existe pas. 🔴 Rallumer la ligne du panier pose `paniers_depuis`
   * dans la même transaction : un panier noté avant ne part jamais après coup (appel A2 du plan du lot 5).
   */
  async allumerLigne(tenantId: string, evenement: EvenementShopify, par: string | null): Promise<boolean> {
    return enTransaction(this.pool, async (client) => {
      const res = await client.query(
        `update shopify_lignes set actif = true, modifie_par = $3, modifie_le = now()
          where tenant_id = $1 and evenement = $2 and not actif`,
        [tenantId, evenement, par],
      );
      const allumee = (res.rowCount ?? 0) > 0;
      if (allumee && evenement === 'checkout_abandoned') {
        await client.query(`update shopify_boutiques set paniers_depuis = now(), maj_le = now() where tenant_id = $1`, [tenantId]);
      }
      return allumee;
    });
  }

  /** Éteint la ligne ; `false` si elle l'était déjà ou n'existe pas. L'arrêt de ses parcours revient à l'appelant. */
  async eteindreLigne(tenantId: string, evenement: EvenementShopify, par: string | null): Promise<boolean> {
    const res = await this.pool.query(
      `update shopify_lignes set actif = false, modifie_par = $3, modifie_le = now()
        where tenant_id = $1 and evenement = $2 and actif`,
      [tenantId, evenement, par],
    );
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * La pause de la boutique (décision 15) : rien ne part, aucun panier ne se note ; l'attribution, la fermeture des
   * paniers et le RGPD continuent. `false` si elle l'était déjà. L'arrêt des parcours revient à l'appelant.
   */
  async mettreEnPause(tenantId: string): Promise<boolean> {
    const res = await this.pool.query(
      `update shopify_boutiques set pause_le = now(), maj_le = now() where tenant_id = $1 and pause_le is null`,
      [tenantId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  /** La reprise : 🔴 pose `paniers_depuis`, pour qu'aucun panier noté avant ne parte après coup. */
  async reprendre(tenantId: string): Promise<boolean> {
    const res = await this.pool.query(
      `update shopify_boutiques set pause_le = null, paniers_depuis = now(), maj_le = now()
        where tenant_id = $1 and pause_le is not null`,
      [tenantId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async noterDernierEvenement(tenantId: string): Promise<void> {
    await this.pool.query(`update shopify_boutiques set dernier_evenement_le = now() where tenant_id = $1`, [tenantId]);
  }

  /**
   * Réserve un événement métier. `nouveau` : à traiter ; `servi` : déjà traité, rien à faire ; `en_cours` : un autre
   * traitement le tient (Shopify réessaiera). Une réservation sans issue depuis plus de `BAIL_EVENEMENT_S` se reprend :
   * le traitement est mort en route, et l'envoi qu'il a pu lancer est protégé par sa clé d'idempotence.
   */
  async reserverEvenement(tenantId: string, cle: string, sujet: string): Promise<Reservation> {
    const pose = await this.pool.query(
      `insert into shopify_evenements (tenant_id, cle, sujet) values ($1, $2, $3) on conflict (tenant_id, cle) do nothing`,
      [tenantId, cle, sujet],
    );
    if ((pose.rowCount ?? 0) > 0) return 'nouveau';
    const repris = await this.pool.query(
      `update shopify_evenements set maj_le = now()
        where tenant_id = $1 and cle = $2 and issue is null and maj_le < now() - make_interval(secs => $3)`,
      [tenantId, cle, BAIL_EVENEMENT_S],
    );
    if ((repris.rowCount ?? 0) > 0) return 'nouveau';
    const r = (await this.pool.query<{ issue: string | null }>(
      `select issue from shopify_evenements where tenant_id = $1 and cle = $2`, [tenantId, cle],
    )).rows[0];
    return r?.issue === null ? 'en_cours' : 'servi';
  }

  async noterIssue(tenantId: string, cle: string, issue: string): Promise<void> {
    await this.pool.query(`update shopify_evenements set issue = $3, maj_le = now() where tenant_id = $1 and cle = $2`, [tenantId, cle, issue]);
  }

  /** Une réservation abandonnée sans effet (panne avant l'envoi) : Shopify réessaiera, la clé doit repartir à zéro. */
  async libererEvenement(tenantId: string, cle: string): Promise<void> {
    await this.pool.query(`delete from shopify_evenements where tenant_id = $1 and cle = $2 and issue is null`, [tenantId, cle]);
  }

  /** Les issues des `jours` derniers jours, par issue : les chiffres de la carte et de `get_shopify_state`. */
  async compteurs(tenantId: string, jours: number): Promise<Record<string, number>> {
    const res = await this.pool.query<{ issue: string; n: string }>(
      `select issue, count(*)::text as n from shopify_evenements
        where tenant_id = $1 and issue is not null and recu_le > now() - make_interval(days => $2)
        group by issue`,
      [tenantId, jours],
    );
    return Object.fromEntries(res.rows.map((r) => [r.issue, Number(r.n)]));
  }

  /** EXCEPTION TRANSVERSE 3 : le balayage, toutes boutiques confondues. */
  async purgerEvenements(jours: number): Promise<number> {
    const res = await this.pool.query(`delete from shopify_evenements where recu_le < now() - make_interval(days => $1)`, [jours]);
    return res.rowCount ?? 0;
  }

  /**
   * Un checkout reçu (lot 2) : le panier se crée ou se complète. 🔴 Un panier FERMÉ ne se rouvre jamais (garde du
   * `where`), et une valeur absente n'efface pas celle d'avant (`coalesce`). Chaque modification repousse l'échéance :
   * un client qui remplit encore son panier ne l'a pas abandonné.
   */
  async noterPanier(tenantId: string, p: { jeton: string; telephone: string | null; nom: string | null; lien: string | null }): Promise<void> {
    await this.pool.query(
      `insert into shopify_paniers (tenant_id, jeton, telephone, nom, lien) values ($1, $2, $3, $4, $5)
       on conflict (tenant_id, jeton) do update set
         telephone = coalesce(excluded.telephone, shopify_paniers.telephone),
         nom = coalesce(excluded.nom, shopify_paniers.nom),
         lien = coalesce(excluded.lien, shopify_paniers.lien),
         maj_le = now()
       where shopify_paniers.ferme_le is null`,
      [tenantId, p.jeton, p.telephone, p.nom, p.lien],
    );
  }

  /**
   * Le panier devient une commande (`orders/create` avec son `checkout_token`, ou un checkout `completed_at`). Aucun
   * ordre entre sujets (mesuré) : la fermeture peut arriver AVANT le panier, elle écrit alors un panier déjà fermé.
   */
  async fermerPanier(tenantId: string, jeton: string): Promise<void> {
    await this.pool.query(
      `insert into shopify_paniers (tenant_id, jeton, ferme_le) values ($1, $2, now())
       on conflict (tenant_id, jeton) do update set ferme_le = coalesce(shopify_paniers.ferme_le, now())`,
      [tenantId, jeton],
    );
  }

  /**
   * 🔴 Ferme un panier DÉJÀ noté, sans en créer : c'est ce que fait une commande quand la relance est éteinte. Sans
   * elle, une relance éteinte puis rallumée relançait le client qui avait commandé pendant la pause (relecture du lot 2).
   */
  async fermerPanierExistant(tenantId: string, jeton: string): Promise<void> {
    await this.pool.query(
      `update shopify_paniers set ferme_le = coalesce(ferme_le, now()) where tenant_id = $1 and jeton = $2`,
      [tenantId, jeton],
    );
  }

  /** Une commande ferme aussi les autres paniers ouverts du même numéro : un achat express passe par un autre checkout. */
  async fermerPaniersDuTelephone(tenantId: string, telephone: string): Promise<void> {
    await this.pool.query(
      `update shopify_paniers set ferme_le = now() where tenant_id = $1 and telephone = $2 and ferme_le is null`,
      [tenantId, telephone],
    );
  }

  /** `customers/redact` d'un client qui n'a pas de fiche : ses paniers en attente partent quand même. */
  async effacerPaniersDuTelephone(tenantId: string, telephone: string): Promise<void> {
    await this.pool.query(`delete from shopify_paniers where tenant_id = $1 and telephone = $2`, [tenantId, telephone]);
  }

  /** Le panier est-il encore ouvert ? Relu juste avant l'envoi : une commande a pu arriver depuis la réclamation. */
  async panierOuvert(tenantId: string, jeton: string): Promise<boolean> {
    const r = (await this.pool.query<{ ouvert: boolean }>(
      `select ferme_le is null as ouvert from shopify_paniers where tenant_id = $1 and jeton = $2`, [tenantId, jeton],
    )).rows[0];
    return r?.ouvert === true;
  }

  /**
   * Lot 5 : ce que la règle « le parcours est-il encore voulu ? » (`./parcours-voulu.ts`) lit de la boutique et de la
   * ligne d'un événement (migration 0299) : absente (aucune boutique de ce domaine dans cet espace), coupée, en pause ou
   * active, et l'interrupteur de la ligne (éteinte ou absente : faux). Une lecture, filtrée par l'espace.
   */
  async etatPourParcours(tenantId: string, domaine: string, evenement: EvenementShopify): Promise<{
    boutique: 'absente' | 'coupee' | 'pause' | 'active';
    ligneActive: boolean;
  }> {
    const r = (await this.pool.query<{ etat: EtatBoutique; en_pause: boolean; actif: boolean | null }>(
      `select b.etat, b.pause_le is not null as en_pause, l.actif
         from shopify_boutiques b
         left join shopify_lignes l on l.tenant_id = b.tenant_id and l.evenement = $3
        where b.tenant_id = $1 and b.domaine = $2`,
      [tenantId, domaine, evenement],
    )).rows[0];
    if (r === undefined) return { boutique: 'absente', ligneActive: false };
    return { boutique: r.etat === 'coupee' ? 'coupee' : r.en_pause ? 'pause' : 'active', ligneActive: r.actif === true };
  }

  /**
   * EXCEPTION TRANSVERSE 4 : le balayage des relances, toutes boutiques confondues. Un panier DÛ : `PANIERS_DUS`.
   * 🔴 La réclamation POSE `relance_le` dans la même écriture (`for update skip locked`) : deux balayages, de deux copies
   * de l'API, ne relancent jamais le même panier. Elle rend le scénario de la ligne du panier.
   */
  async reclamerPaniersDus(limite: number): Promise<PanierDu[]> {
    const res = await this.pool.query<{
      tenant_id: string; jeton: string; telephone: string; nom: string | null; lien: string; domaine: string; workflow_id: string;
    }>(
      `with dus as (
         select p.tenant_id, p.jeton ${PANIERS_DUS}
          order by p.maj_le
          limit $1
          for update of p skip locked
       )
       update shopify_paniers p set relance_le = now()
         from dus, shopify_boutiques b, shopify_lignes l
        where p.tenant_id = dus.tenant_id and p.jeton = dus.jeton and p.relance_le is null
          and b.tenant_id = p.tenant_id and l.tenant_id = p.tenant_id and l.evenement = 'checkout_abandoned'
       returning p.tenant_id, p.jeton, p.telephone, p.nom, p.lien, b.domaine, l.workflow_id`,
      [limite],
    );
    return res.rows.map((r) => ({
      tenantId: r.tenant_id, jeton: r.jeton, telephone: r.telephone, nom: r.nom, lien: r.lien, domaine: r.domaine, workflowId: r.workflow_id,
    }));
  }

  async noterIssuePanier(tenantId: string, jeton: string, issue: string): Promise<void> {
    await this.pool.query(`update shopify_paniers set issue = $3 where tenant_id = $1 and jeton = $2`, [tenantId, jeton, issue]);
  }

  /**
   * Les paniers des `jours` derniers jours : relancés (par issue), fermés à temps, en attente. Seuls les paniers NOTÉS
   * comptent (un téléphone) : la ligne qu'écrit une commande arrivée avant son panier n'est pas un panier sauvé.
   */
  async compteursPaniers(tenantId: string, jours: number): Promise<{ relances: Record<string, number>; fermesATemps: number; enAttente: number }> {
    const res = await this.pool.query<{ issue: string | null; ferme: boolean; relance: boolean; n: string }>(
      `select issue, ferme_le is not null as ferme, relance_le is not null as relance, count(*)::text as n
         from shopify_paniers where tenant_id = $1 and telephone is not null and ouvert_le > now() - make_interval(days => $2)
        group by 1, 2, 3`,
      [tenantId, jours],
    );
    const relances: Record<string, number> = {};
    let fermesATemps = 0;
    let enAttente = 0;
    for (const r of res.rows) {
      const n = Number(r.n);
      if (r.relance) relances[r.issue ?? 'en_cours'] = (relances[r.issue ?? 'en_cours'] ?? 0) + n;
      else if (r.ferme) fermesATemps += n;
      else enAttente += n;
    }
    return { relances, fermesATemps, enAttente };
  }

  /**
   * Une relance PARTIE, comptée dans son jour de Paris (`relances_panier_jour`, migration 0261) : le panier, lui, part à
   * 7 jours avec son téléphone, et ce compte anonyme garde l'historique des relances.
   */
  async compterRelance(tenantId: string, le: Date): Promise<void> {
    await this.pool.query(
      `insert into relances_panier_jour (tenant_id, jour, n) values ($1, ($2::timestamptz at time zone 'Europe/Paris')::date, 1)
       on conflict (tenant_id, jour) do update set n = relances_panier_jour.n + 1`,
      [tenantId, le],
    );
  }

  /** EXCEPTION TRANSVERSE 5 : les paniers de plus de `jours` jours partent, relancés ou non (ils portent un téléphone). */
  async purgerPaniers(jours: number): Promise<number> {
    const res = await this.pool.query(`delete from shopify_paniers where ouvert_le < now() - make_interval(days => $1)`, [jours]);
    return res.rowCount ?? 0;
  }

  /**
   * La fiche d'une commande, pour la retrouver quand Shopify demande d'effacer son client, et depuis le 2026-11-03 pour
   * cibler par commandes (spec des segments) : `details` vient du paiement (`orders/paid`) et pose la date, le montant, la
   * devise et le drapeau test ; sans eux (une expédition), rien de connu n'est écrasé. Une première ligne sans détails
   * prend la date du jour.
   */
  async lierCommande(tenantId: string, commandeId: string, clientId: string | null, contactId: string, details?: DetailsCommande): Promise<void> {
    await this.pool.query(
      `insert into shopify_commandes (tenant_id, commande_id, client_id, contact_id, payee_le, montant, devise, test)
       values ($1, $2, $3, $4, coalesce($5::timestamptz, now()), $6::numeric, $7, coalesce($8::boolean, false))
       on conflict (tenant_id, commande_id) do update set
         client_id = coalesce(excluded.client_id, shopify_commandes.client_id), contact_id = excluded.contact_id,
         payee_le = case when $5::timestamptz is null then shopify_commandes.payee_le else excluded.payee_le end,
         montant = coalesce(excluded.montant, shopify_commandes.montant),
         devise = coalesce(excluded.devise, shopify_commandes.devise),
         test = case when $8::boolean is null then shopify_commandes.test else excluded.test end`,
      [tenantId, commandeId, clientId, contactId, details?.payeeLe ?? null, details?.montant ?? null, details?.devise ?? null, details?.test ?? null],
    );
  }

  /** Les fiches liées à ces commandes ou à ce client Shopify, dans l'espace. */
  async contactsLies(tenantId: string, commandeIds: readonly string[], clientId: string | null): Promise<string[]> {
    const res = await this.pool.query<{ contact_id: string }>(
      `select distinct contact_id from shopify_commandes
        where tenant_id = $1 and (commande_id = any($2::text[]) or ($3::text is not null and client_id = $3))`,
      [tenantId, commandeIds, clientId],
    );
    return res.rows.map((r) => r.contact_id);
  }
}

/**
 * Tout le branchement d'un espace, dans la transaction de l'appelant. 🔴 Les ventes attribuées n'en font pas partie : elles
 * perdent leur commande et leur contact, et restent anonymes (spec du 2026-10-28) ; un chiffre déjà lu ne change pas. Les
 * lignes (lot 5) restent, ÉTEINTES : une configuration sans donnée personnelle, dont le scénario (au nom unique dans son
 * rayon) resservira à la reconnexion.
 */
async function effacerBranchement(client: PoolClient, tenantId: string): Promise<void> {
  await client.query(`update ventes_attribuees set commande_id = null, contact_id = null where tenant_id = $1`, [tenantId]);
  await client.query(`update shopify_lignes set actif = false, modifie_le = now() where tenant_id = $1 and actif`, [tenantId]);
  for (const table of ['shopify_messages', 'shopify_messages_attente', 'shopify_paniers', 'shopify_evenements', 'shopify_commandes', 'shopify_boutiques']) {
    await client.query(`delete from ${table} where tenant_id = $1`, [tenantId]);
  }
}

interface LigneAttente {
  evenement: EvenementShopify; modele: string; langue: string; variables: unknown; delai_panier_minutes: number | null; cree_le: Date;
}

function versAttente(r: LigneAttente): AttenteMessage {
  return {
    evenement: r.evenement, modele: r.modele, langue: r.langue, delaiMinutes: r.delai_panier_minutes, creeLe: r.cree_le.toISOString(),
    variables: Array.isArray(r.variables) ? r.variables.filter(estDonneeShopify) : [],
  };
}
