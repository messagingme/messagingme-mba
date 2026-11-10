import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auteurOps, type PreHandler } from '../auth/middleware';
import { journaliser } from '../lib/journal';
import { lireGrilleCsv } from '../credit-whatsapp/grille-csv';
import type { ChargementGrille, ResumeGrille } from '../credit-whatsapp/reglages.pg';
import { prixClient, type GrilleMeta } from '../credit-whatsapp/grille';
import { MARCHES_META } from '../credit-whatsapp/marches-meta';
import type { LigneCredit, NumeroDeLEspace, NumeroEnAttente, NumeroPourLaLigne } from '../credit-whatsapp/lignes.pg';
import type { ProvisionVue } from '../credit-whatsapp/credit';
import { makeTraceOps, type AuditSink } from '../audit/journal';
import { estUuid } from './scope';
// Le même seuil et la même signature que les autres écritures de `/ops` : importés, pas recopiés.
import { MIN_NOTE, noteSignee } from './ops';

/**
 * LES RÉGLAGES DU CRÉDIT WHATSAPP DANS `/ops` (plan du Crédit WhatsApp, tâche 2) : la grille de Meta, chargée depuis le
 * fichier en euros que Meta publie, et la commission des messages. Même autorité que la grille de prix (la session
 * d'exploitation), même note obligatoire, même ligne de journal signée de son auteur. Montées avec `/ops`
 * (`src/server.ts`), sous la même garde. Depuis la tâche 8, un numéro d'un espace s'y pose sur la ligne ou s'en retire à
 * la main (un numéro d'essai avant l'option du lot 2), tracé dans le journal de l'espace.
 */
export interface OpsCreditWhatsappDeps {
  reglages: {
    resumeGrille(): Promise<ResumeGrille | null>;
    /** La grille que la garde lit : sans elle, tout envoi d'un numéro de la ligne est refusé. */
    grilleEnVigueur(): Promise<GrilleMeta | null>;
    chargerGrille(c: ChargementGrille): Promise<string>;
    commission(): Promise<number>;
    reglerCommission(pct: number, par: string): Promise<void>;
  };
  lignes: {
    numeroDeLEspace(tenantId: string, phoneNumberId: string): Promise<NumeroPourLaLigne | null>;
    /** Les numéros de l'espace, proposés dans la fenêtre de l'offre (plus d'identifiant Meta à taper). */
    numerosDeLEspace(tenantId: string): Promise<NumeroDeLEspace[]>;
    lignesDeLEspace(tenantId: string): Promise<LigneCredit[]>;
    /**
     * La ligne qui couvre le numéro, telle que la garde la lit (la sienne ou celle de son compte, de cet espace ou d'un
     * autre, arrêtée comprise) : l'écran et la pose disent ce que la garde fera de ses envois.
     */
    ligneDuNumero(phoneNumberId: string): Promise<LigneCredit | null>;
    poser(tenantId: string, phoneNumberId: string, wabaId: string | null, origine: 'ops' | 'option', note: string): Promise<boolean>;
    retirer(tenantId: string, phoneNumberId: string): Promise<boolean>;
    /** Les numéros couverts par les lignes `'option'`, rangés : ceux que comptent les places (`numerosCouvertsParOption`). */
    numerosCouvertsParOption(tenantId: string): Promise<string[]>;
    /**
     * Les numéros arrivés par la fenêtre du partenaire qui attendent leur ligne, tous espaces (relecture du lot E5,
     * jaune 3) : le geste à faire ne dépend plus d'une alerte Telegram.
     */
    numerosEnAttenteDeLigne(): Promise<NumeroEnAttente[]>;
    /**
     * « Ne pas poser » (relecture du lot E6, jaune 5) : efface l'attente d'un numéro de CET espace qui attend vraiment ;
     * `false` sinon (`abandonnerAttente`).
     */
    abandonnerAttente(tenantId: string, phoneNumberId: string): Promise<boolean>;
  };
  /**
   * L'option du Crédit WhatsApp (lot 4a, décision de Julien du 2026-11-03) : une pose pour un Pro ou un Business consomme
   * des places payées, sauf geste forcé (un essai) ; une Entreprise, illimitée, n'en compte pas.
   */
  option: {
    entreprise(tenantId: string): Promise<boolean>;
    placesPayees(tenantId: string): Promise<number>;
    /** `PgNumeroDelieStore.leverPausesLigneCredit` : une ligne posée fait repartir les campagnes en pause faute de ligne. */
    reprendreCampagnes(tenantId: string): Promise<number>;
  };
  /** Le journal des actions de l'espace : le numéro posé ou retiré, l'exploitant pour acteur. */
  audit: AuditSink;
  /** Le solde et les dernières provisions de l'espace, montrés avec ses lignes (l'essai réel du lot 1). */
  credit: {
    solde(tenantId: string): Promise<number>;
    /** Ce qu'une Entreprise a envoyé ce mois, au prix client : son solde ne bouge pas, ce montant est à facturer. */
    consommationDuMois(tenantId: string): Promise<number>;
    dernieresProvisions(tenantId: string, n?: number): Promise<ProvisionVue[]>;
  };
}

/** Pourquoi un numéro ne peut pas être posé sur la ligne : les mêmes refus que la pose, dits avant le clic. */
export type RefusDePose = '360dialog' | 'coexistence' | 'delie' | null;

function refusDePose(n: NumeroPourLaLigne): RefusDePose {
  if (n.fournisseur !== 'meta') return '360dialog';
  if (n.coexistence) return 'coexistence';
  return n.delie ? 'delie' : null;
}

/**
 * Comment la ligne couvre un numéro, lue comme la garde la lit (`ligneDuNumero`) : la sienne (`ligne`), celle d'un autre
 * numéro du même compte WhatsApp (`compte`, Meta attache la ligne au compte), celle d'un AUTRE espace sur ce compte
 * (`autre_espace` : la garde refuse alors ses envois, relecture du lot D), ou aucune.
 */
export type Couverture = 'ligne' | 'compte' | 'autre_espace' | null;

function couverture(tenantId: string, n: NumeroDeLEspace, l: LigneCredit | null): Couverture {
  if (l === null) return null;
  if (l.tenantId !== tenantId) return 'autre_espace';
  return l.phoneNumberId === n.phoneNumberId ? 'ligne' : 'compte';
}

const CORPS_GRILLE = z.object({
  csv: z.string().min(1).max(500_000),
  enVigueurLe: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string(),
}).strict();

const CORPS_COMMISSION = z.object({
  commissionPct: z.number().int().min(0).max(100),
  note: z.string(),
}).strict();

/** Un identifiant de numéro de Meta : des chiffres. */
const CORPS_LIGNE = z.object({
  phoneNumberId: z.string().regex(/^[0-9]{5,32}$/),
  poser: z.boolean(),
  note: z.string(),
  /** Poser sans place payée (un essai, décision de Julien du 2026-11-03) : la ligne est `'ops'`, signée, hors des places. */
  forcer: z.boolean().optional(),
}).strict();

/** « Ne pas poser » un numéro qui attend sa ligne : son identifiant de Meta, et pourquoi. */
const CORPS_ABANDON = z.object({
  phoneNumberId: z.string().regex(/^[0-9]{5,32}$/),
  note: z.string(),
}).strict();

/**
 * Les places qu'une pose sur ce numéro demanderait : les numéros déjà couverts par l'option, plus ceux que la nouvelle ligne
 * couvrirait (le numéro et les autres de son compte WhatsApp, déliés exclus). Une ligne couvre tout son compte.
 */
export function placesApresPose(
  couverts: readonly string[], numeros: readonly NumeroDeLEspace[], numero: { phoneNumberId: string; wabaId: string | null },
): number {
  const apres = new Set(couverts);
  for (const n of numeros) {
    if (n.delie) continue;
    if (n.phoneNumberId === numero.phoneNumberId || (numero.wabaId !== null && n.wabaId === numero.wabaId)) apres.add(n.phoneNumberId);
  }
  apres.add(numero.phoneNumberId);
  return apres.size;
}

/** Une date du calendrier, vraie : '2026-02-30' a la bonne forme et n'existe pas. */
function dateValide(jour: string): boolean {
  const d = new Date(`${jour}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === jour;
}

export function registerOpsCreditWhatsapp(app: FastifyInstance, deps: OpsCreditWhatsappDeps, garde: PreHandler): void {
  const opts = { preHandler: garde };
  const tracer = makeTraceOps(deps.audit);
  /**
   * Ce que la fenêtre de l'offre montre d'un espace : ses numéros (couverts ou non par la ligne, et pourquoi l'un ne peut
   * pas l'être), ses lignes, son solde, ce qu'il a consommé ce mois en illimité, ses dernières provisions.
   */
  const vue = async (tenantId: string) => {
    const [lignes, numeros, soldeMicroEur, consommationDuMoisMicroEur, provisions, placesPayees, couverts] = await Promise.all([
      deps.lignes.lignesDeLEspace(tenantId), deps.lignes.numerosDeLEspace(tenantId), deps.credit.solde(tenantId),
      deps.credit.consommationDuMois(tenantId), deps.credit.dernieresProvisions(tenantId, 50),
      deps.option.placesPayees(tenantId), deps.lignes.numerosCouvertsParOption(tenantId),
    ]);
    const couvrantes = await Promise.all(numeros.map((n) => deps.lignes.ligneDuNumero(n.phoneNumberId)));
    return {
      tenantId,
      lignes,
      numeros: numeros.map((n, i) => {
        const l = couvrantes[i] ?? null;
        // `arretee` : la ligne qui le couvre a ses envois arrêtés, la garde les refuse (« couvert » le cachait).
        return {
          phoneNumberId: n.phoneNumberId, numero: n.numero, nom: n.nom, couverture: couverture(tenantId, n, l),
          arretee: l !== null && l.arreteeLe !== null, refus: refusDePose(n),
        };
      }),
      soldeMicroEur,
      consommationDuMoisMicroEur,
      provisions,
      // Les places de l'option (lot 4a) : payées, et les numéros que ses lignes couvrent (au-delà, refusés par la garde).
      places: { payees: placesPayees, couverts: couverts.length },
    };
  };

  app.get('/ops/credit-whatsapp/reglages', opts, async (_req, reply) => {
    const [grille, commissionPct] = await Promise.all([deps.reglages.resumeGrille(), deps.reglages.commission()]);
    return reply.code(200).send({ grille, commissionPct });
  });

  /**
   * La grille de Meta EN VIGUEUR, prix par prix : chaque marché (ses pays), chaque catégorie, le tarif de Meta et le prix
   * client à la commission globale, calculé par la formule de la garde (`prixClient`). Une Entreprise à commission
   * négociée paie la sienne : le tableau le dit, il ne la recalcule pas.
   */
  app.get('/ops/credit-whatsapp/grille', opts, async (_req, reply) => {
    const [grille, commissionPct] = await Promise.all([deps.reglages.grilleEnVigueur(), deps.reglages.commission()]);
    if (grille === null) return reply.code(200).send({ grille: null, commissionPct, marches: [], tarifs: [] });
    return reply.code(200).send({
      grille: { id: grille.id, enVigueurLe: grille.enVigueurLe },
      commissionPct,
      marches: MARCHES_META.map((m) => ({ cle: m.cle, nom: m.nom, pays: [...m.pays, ...(m.memeIndicatif ?? [])] })),
      tarifs: grille.tarifs.map((t) => ({
        marche: t.marche, categorie: t.categorie, palier: t.palier,
        metaMicroEur: t.prixMicroEur, clientMicroEur: prixClient(t.prixMicroEur, commissionPct),
      })),
    });
  });

  /**
   * Charger la grille de Meta. Le fichier est lu ICI, une seule lecture pour toutes les copies : il refuse au lieu de
   * deviner, et la réponse nomme la ligne fautive. 🔴 Note obligatoire : d'où vient ce fichier, et pourquoi maintenant.
   */
  app.put('/ops/credit-whatsapp/grille', opts, async (req, reply) => {
    const c = CORPS_GRILLE.safeParse(req.body);
    if (!c.success) return reply.code(400).send({ error: 'corps invalide : le fichier (csv), la date d’entrée en vigueur (AAAA-MM-JJ) et une note sont attendus' });
    const note = c.data.note.trim().slice(0, 500);
    if (note.length < MIN_NOTE) return reply.code(400).send({ error: 'note requise : d’où vient cette grille' });
    if (!dateValide(c.data.enVigueurLe)) return reply.code(400).send({ error: 'date d’entrée en vigueur invalide' });
    const lue = lireGrilleCsv(c.data.csv);
    if (!lue.ok) return reply.code(400).send({ error: lue.erreur });
    const par = auteurOps(req);
    const id = await deps.reglages.chargerGrille({ enVigueurLe: c.data.enVigueurLe, tarifs: lue.tarifs, auteur: par, note });
    journaliser('warn', 'ops_grille_meta', { id, enVigueurLe: c.data.enVigueurLe, tarifs: lue.tarifs.length, par, note });
    return reply.code(200).send({ grille: await deps.reglages.resumeGrille() });
  });

  /** La commission des messages, une pour tous les espaces (l'Entreprise négocie la sienne avec son offre). */
  app.put('/ops/credit-whatsapp/commission', opts, async (req, reply) => {
    const c = CORPS_COMMISSION.safeParse(req.body);
    if (!c.success) return reply.code(400).send({ error: 'commission invalide : un entier de 0 à 100, et une note' });
    const note = c.data.note.trim().slice(0, 500);
    if (note.length < MIN_NOTE) return reply.code(400).send({ error: 'note requise : pourquoi ce changement de commission' });
    const par = auteurOps(req);
    await deps.reglages.reglerCommission(c.data.commissionPct, noteSignee(par, note));
    journaliser('warn', 'ops_commission_messages', { commissionPct: c.data.commissionPct, par, note });
    return reply.code(200).send({ commissionPct: c.data.commissionPct });
  });

  /**
   * Les numéros arrivés par la fenêtre du partenaire qui attendent leur ligne, TOUS ESPACES (relecture du lot E5, jaune 3 ;
   * décision de Julien du 2026-11-09) : l'alerte de l'essai 236 s'est perdue, la liste reste. Délibérément transverse,
   * comme toute `/ops`.
   */
  app.get('/ops/credit-whatsapp/en-attente', opts, async (_req, reply) => (
    reply.code(200).send({ numeros: await deps.lignes.numerosEnAttenteDeLigne() })
  ));

  /**
   * « Ne pas poser » (relecture du lot E6, jaune 5) : le partenaire n'attache pas, ou le client renonce, ou l'attache est
   * vérifiée sur un compte déjà couvert. L'attente d'un numéro de l'espace qui attend vraiment s'efface : il sort de la
   * liste, et l'espace relit l'état de ses lignes (une Entreprise sans ligne, « sur demande » et le conseil de sa carte
   * chez Meta ; une option payée sans ligne reste en attente). 🔴 Refusé tant qu'une ligne bloque encore les envois du
   * compte, celle d'un AUTRE espace ou une ligne ARRÊTÉE de l'espace : l'attente effacée, plus rien ne rappellerait ce
   * numéro (relecture du lot E7, jaunes 1 et 2). 🔴 La note reste au journal du serveur : le journal de l'espace, que son
   * administrateur lit, ne porte que l'identifiant du numéro (une note peut nommer le partenaire).
   */
  app.post('/ops/credit-whatsapp/en-attente/:tenantId', opts, async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    if (!estUuid(tenantId)) return reply.code(404).send({ error: 'espace inconnu' });
    const c = CORPS_ABANDON.safeParse(req.body);
    if (!c.success) return reply.code(400).send({ error: 'corps invalide : phoneNumberId (l’identifiant Meta du numéro) et une note sont attendus' });
    const note = c.data.note.trim().slice(0, 500);
    if (note.length < MIN_NOTE) return reply.code(400).send({ error: 'note requise : pourquoi ce numéro n’aura pas sa ligne' });
    const { phoneNumberId } = c.data;
    const couvrante = await deps.lignes.ligneDuNumero(phoneNumberId);
    if (couvrante !== null && couvrante.tenantId !== tenantId) {
      return reply.code(409).send({
        error: 'le compte WhatsApp de ce numéro est encore sur la ligne d’un autre espace, et la garde refuse ses envois : retirez cette ligne d’abord, sinon plus rien ne rappellera ce numéro',
        code: 'couvert_autre_espace',
      });
    }
    if (couvrante !== null && couvrante.arreteeLe !== null) {
      return reply.code(409).send({
        error: 'le compte WhatsApp de ce numéro est sur une ligne arrêtée de cet espace, et la garde refuse ses envois : retirez-la d’abord, sinon plus rien ne rappellera ce numéro',
        code: 'couvert_arrete',
      });
    }
    if (!(await deps.lignes.abandonnerAttente(tenantId, phoneNumberId))) {
      return reply.code(404).send({ error: 'ce numéro n’attend aucune ligne dans cet espace' });
    }
    const par = auteurOps(req);
    journaliser('warn', 'ops_attente_ligne_abandonnee', { tenantId, phoneNumberId, par, note });
    await tracer(tenantId, par, 'ops.attente_ligne_abandonnee', { phoneNumberId });
    return reply.code(200).send({ numeros: await deps.lignes.numerosEnAttenteDeLigne() });
  });

  app.get('/ops/credit-whatsapp/ligne/:tenantId', opts, async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    if (!estUuid(tenantId)) return reply.code(404).send({ error: 'espace inconnu' });
    return reply.code(200).send(await vue(tenantId));
  });

  /**
   * Poser un numéro de l'espace sur la ligne, ou l'en retirer. 🔴 Le numéro à poser est lu DANS l'espace
   * (`numeroDeLEspace`) : celui d'un autre espace rend 404, comme un inconnu. Ne passent pas sur la ligne : un numéro
   * 360dialog (facturé chez 360dialog, la garde ne le voit pas), un numéro en coexistence (l'application WhatsApp Business
   * envoie sans nous, donc sans provision), un numéro délié (il n'envoie plus rien), un numéro dont le compte WhatsApp est
   * déjà couvert (une ligne par compte, de cet espace ou d'un autre), et aucun numéro tant qu'aucune grille de Meta n'est
   * en vigueur (la garde refuserait tous ses envois). Retirer ne lit que la ligne en cours de l'espace : un
   * numéro déconnecté depuis, ou relié à un autre espace, se retire encore.
   */
  app.post('/ops/credit-whatsapp/ligne/:tenantId', opts, async (req, reply) => {
    const { tenantId } = req.params as { tenantId: string };
    if (!estUuid(tenantId)) return reply.code(404).send({ error: 'espace inconnu' });
    const c = CORPS_LIGNE.safeParse(req.body);
    if (!c.success) return reply.code(400).send({ error: 'corps invalide : phoneNumberId (l’identifiant Meta du numéro), poser (booléen) et une note sont attendus' });
    const note = c.data.note.trim().slice(0, 500);
    if (note.length < MIN_NOTE) return reply.code(400).send({ error: 'note requise : pourquoi ce numéro' });
    const { phoneNumberId, poser } = c.data;
    const forcer = c.data.forcer === true;
    const par = auteurOps(req);
    let origine: 'ops' | 'option' = 'ops';
    if (poser) {
      const numero = await deps.lignes.numeroDeLEspace(tenantId, phoneNumberId);
      if (numero === null) return reply.code(404).send({ error: 'numéro inconnu dans cet espace' });
      if (numero.fournisseur !== 'meta') return reply.code(409).send({ error: 'un numéro 360dialog ne passe pas sur la ligne : ses messages sont facturés chez 360dialog' });
      if (numero.coexistence) return reply.code(409).send({ error: 'un numéro en coexistence ne passe pas sur la ligne : l’application WhatsApp Business envoie sans passer par nous' });
      if (numero.delie) return reply.code(409).send({ error: 'numéro délié : il n’envoie plus rien, rien à mettre sur la ligne' });
      if ((await deps.reglages.grilleEnVigueur()) === null) {
        return reply.code(409).send({ error: 'aucune grille de Meta en vigueur : chargez-la avant de poser un numéro sur la ligne' });
      }
      // 🔴 Une ligne par compte WhatsApp (Meta attache la ligne au compte) : un numéro que la ligne d'un autre espace
      // couvre, ou qu'un autre numéro de son compte couvre déjà, ne pose pas une seconde ligne (relecture du lot D).
      const couvrante = await deps.lignes.ligneDuNumero(phoneNumberId);
      if (couvrante !== null && couvrante.tenantId !== tenantId) {
        return reply.code(409).send({ error: 'le compte WhatsApp de ce numéro est sur la ligne d’un autre espace : retirez-la d’abord' });
      }
      if (couvrante !== null && couvrante.phoneNumberId !== phoneNumberId) {
        return reply.code(409).send({ error: 'déjà couvert : un autre numéro de son compte WhatsApp est sur la ligne, qui couvre tout le compte' });
      }
      // Les places (décision de Julien du 2026-11-03) : hors Entreprise, la pose consomme des places payées, le compte entier
      // devant y tenir ; un essai se FORCE, signé, et sa ligne `'ops'` reste hors des places. Une Entreprise n'en compte pas.
      if (!forcer && !(await deps.option.entreprise(tenantId))) {
        const [places, couverts, numeros] = await Promise.all([
          deps.option.placesPayees(tenantId), deps.lignes.numerosCouvertsParOption(tenantId), deps.lignes.numerosDeLEspace(tenantId),
        ]);
        const requises = placesApresPose(couverts, numeros, { phoneNumberId, wabaId: numero.wabaId });
        if (requises > places) {
          return reply.code(409).send({
            error: `il faut ${requises} place${requises > 1 ? 's' : ''} payée${requises > 1 ? 's' : ''} pour couvrir ce compte, l’espace en a ${places} : prendre l’option, ou forcer la pose pour un essai`,
            code: 'places_manquantes',
          });
        }
        origine = 'option';
      }
      const signee = noteSignee(par, forcer ? `${note} (pose forcée, sans place)` : note);
      if (!(await deps.lignes.poser(tenantId, phoneNumberId, numero.wabaId, origine, signee))) {
        return reply.code(409).send({ error: 'numéro déjà sur la ligne' });
      }
      // La ligne posée : les campagnes de l'espace en pause faute de ligne active repartent (relecture du lot 4a, jaune 6).
      // Non bloquant : la pose est faite, une panne ici ne doit pas la faire passer pour un échec (une seconde pose rendrait
      // « déjà sur la ligne ») ; les pauses se lèveront au prochain geste qui les lève.
      try {
        await deps.option.reprendreCampagnes(tenantId);
      } catch (err) {
        journaliser('error', 'ops_ligne_credit_reprise_impossible', { tenantId, phoneNumberId, err: err instanceof Error ? err.message : String(err) });
      }
    } else if (!(await deps.lignes.retirer(tenantId, phoneNumberId))) {
      return reply.code(404).send({ error: 'numéro pas sur la ligne de cet espace' });
    }
    journaliser('warn', 'ops_ligne_credit_whatsapp', { tenantId, phoneNumberId, poser, origine, forcer, par, note });
    await tracer(tenantId, par, poser ? 'ops.ligne_credit_posee' : 'ops.ligne_credit_retiree', poser ? { phoneNumberId, origine, forcer } : { phoneNumberId });
    return reply.code(200).send(await vue(tenantId));
  });
}
