import { describe, it, expect } from 'vitest';
import { cleIdempotence } from '../src/api/idempotence';
import { lireCible, schemaCorps, schemaDestinataire, type RapportEnvoi, type ReponseEnvoi } from '../src/api/envoi-public';
import type { CampaignCategory } from '../src/campaign/types';
import type { ContactRow } from '../src/crm/contact-store.pg';
import { validateParamMapping } from '../src/crm/template';
import { accepter, proposer, reprendre, type DemandeAction } from '../src/mise-en-ligne/mise-en-ligne';
import { DELAI_DE_REPRISE_INDIVIDUELLE_MS, RECAPITULATIF_EFFACE, type DepsEnvoisAuOui } from '../src/mise-en-ligne/envois';
import type { Offre } from '../src/offres/offres';
import { ADMIN, CSM, T, monter } from './mise-en-ligne-fixtures';
import { envoisAuOuiInertes } from './routes-inertes';

/**
 * LES ENVOIS À UNE PERSONNE AU OUI (lot 1 du CSM virtuel, B8, livraison 2, plan
 * `docs/superpowers/plans/2026-11-26-csm-lot1-h-envois-au-oui.md`) : `send_template_to_contact` et
 * `send_scenario_to_contact` préparent un bouton ; le clic d'un admin envoie par le cycle de `POST /v1/sends`, sous une
 * clé tirée du oui. Le cycle est ici un faux qui reproduit sa règle d'idempotence (une clé, un corps, un envoi ; la même
 * clé rend le même rapport ; une clé encore en cours rend 409), et valide chaque corps avec les règles de la route.
 */
const NUMERO = '+33612345678';
const FICHE = '77777777-7777-4777-8777-777777777771';
const SCENARIO = '88888888-8888-4888-8888-888888888881';

const contact = (over: Partial<ContactRow> = {}): ContactRow => ({
  id: FICHE, phoneE164: '+33698765432', bsuid: null, externalId: null, profileName: 'Claire', optInStatus: 'unknown', fields: {},
  tags: [], createdAt: '2026-01-01T00:00:00.000Z', blockedAt: null, whatsappJoignable: null, whatsappJoignableLe: null, risque: null, ...over,
});

function monterIndividuels(o: { offre?: Offre } = {}) {
  const fiches = new Map<string, ContactRow>();
  const categorie: { valeur: CampaignCategory } = { valeur: 'utility' };
  const refusCible: { valeur: ReponseEnvoi | null } = { valeur: null };
  const jugements: Array<Record<string, unknown>> = [];
  /** Le registre des clés du faux cycle : la clé, l'empreinte du corps, le rapport scellé. */
  const cles = new Map<string, { corps: string; rapport: RapportEnvoi }>();
  /** Les envois qui sont VRAIMENT partis (une clé neuve). */
  const partis: Array<Record<string, unknown>> = [];
  const cycle = {
    /** Une clé encore « en cours » : posée par une exécution coupée il y a moins de cinq minutes. */
    enCours: new Set<string>(),
    /** Coupé juste APRÈS l'envoi scellé (l'exécution meurt avant d'écrire son résultat). */
    panneApres: false,
    /** Coupé AVANT tout envoi. */
    panneAvant: false,
    /** La personne écartée par le tri de l'envoi. */
    ecarte: null as string | null,
    /** Un refus de l'envoi au clic. */
    refus: null as ReponseEnvoi | null,
  };
  const individuels: DepsEnvoisAuOui['individuels'] = {
    jugerCible: async (_t, corps) => {
      jugements.push(corps as Record<string, unknown>);
      if (refusCible.valeur) return { ok: false, reponse: refusCible.valeur };
      const cible = (corps as { target: { scenario?: string; template?: { name: string } } }).target;
      if (cible.scenario !== undefined) {
        if (cible.scenario !== 'scn_relance' && cible.scenario !== 'Relance') {
          return { ok: false, reponse: { statut: 404, corps: { error: 'scénario introuvable', code: 'scenario_not_found' } } };
        }
        return { ok: true, categorie: categorie.valeur, label: 'Relance', workflowId: SCENARIO };
      }
      return { ok: true, categorie: categorie.valeur, label: cible.template!.name, workflowId: null };
    },
    envoyer: async (_t, corps) => {
      if (cycle.panneAvant) { cycle.panneAvant = false; throw new Error('coupure avant l’envoi'); }
      const lu = schemaCorps.safeParse(corps);
      if (!lu.success) return { statut: 400, corps: { error: 'corps invalide', code: 'invalid_body' } };
      const cle = cleIdempotence(undefined, lu.data);
      if (!cle.ok) return { statut: 400, corps: { error: cle.message, code: cle.code } };
      if (cycle.enCours.has(cle.cle)) return { statut: 409, corps: { error: 'en cours', code: 'idempotency_in_progress' } };
      const empreinte = JSON.stringify(corps);
      const deja = cles.get(cle.cle);
      if (deja) {
        return deja.corps === empreinte
          ? { statut: 201, corps: deja.rapport }
          : { statut: 422, corps: { error: 'clé déjà servie pour un autre corps', code: 'idempotency_key_reused' } };
      }
      if (cycle.refus) return cycle.refus;
      const rapport: RapportEnvoi = cycle.ecarte
        ? { sendId: `send-${cles.size + 1}`, opening: 'whatsapp_template', recipientCount: 0, created: 0, matched: 1, skipped: [{ index: 0, reason: cycle.ecarte } as never], skippedTotal: 1 }
        : { sendId: `send-${cles.size + 1}`, opening: 'whatsapp_template', recipientCount: 1, created: 0, matched: 1, skipped: [], skippedTotal: 0 };
      cles.set(cle.cle, { corps: empreinte, rapport });
      if (rapport.recipientCount > 0) partis.push(corps as Record<string, unknown>);
      if (cycle.panneApres) { cycle.panneApres = false; throw new Error('coupure après l’envoi'); }
      return { statut: 201, corps: rapport };
    },
    contacts: {
      getById: async (t, id) => (t === T ? fiches.get(id) ?? null : null),
      findByPhone: async (t, tel) => (t === T ? [...fiches.values()].find((f) => f.phoneE164 === tel) ?? null : null),
    },
    scenarios: {
      lireParApi: async (t, ref) => (t === T && (ref === SCENARIO || ref === 'scn_relance')
        ? { id: SCENARIO, code: 'scn_relance', name: 'Relance' } as never
        : null),
    },
  };
  const m = monter({ envois: { ...envoisAuOuiInertes, individuels }, ...(o.offre ? { offre: o.offre } : {}) });
  return { ...m, fiches, categorie, refusCible, jugements, partis, cycle, cles };
}

const MODELE: DemandeAction = { type: 'modele', modele: 'commande_prete', langue: 'fr', valeurs: ['Claire', '8412'], declarePar: CSM.userId, telephone: NUMERO };

async function propose(m: ReturnType<typeof monterIndividuels>, d: DemandeAction = MODELE): Promise<string> {
  const r = await proposer(m.deps, T, CSM, [d]);
  if (!r.ok) throw new Error(`refusée : ${r.erreur}`);
  return r.valeur.id;
}

describe('le oui d’un modèle envoyé à une personne (CSM, B8, livraison 2)', () => {
  it('le bouton dit l’effet ; le récapitulatif dit le modèle, sa catégorie de Meta, le numéro masqué, les valeurs et l’accord déclaré', async () => {
    const m = monterIndividuels();
    const r = await proposer(m.deps, T, CSM, [MODELE]);
    expect(r.ok && r.valeur.libelle).toBe('Envoyer à 1 contact');
    const recap = r.ok ? r.valeur.recapitulatif.join(' ') : '';
    expect(recap).toContain('Le modèle « commande_prete » (fr, utility) part vers le +33 •• •• •• 78, avec : « Claire », « 8412 »');
    // L'accord est déclaré au nom de la personne qui a préparé (la fiche le trace ainsi), et le clic le confirme.
    expect(recap).toContain('Ce clic confirme l’accord de cette personne pour recevoir vos messages, déclaré dans Claude par celle ou celui qui a préparé cet envoi');
    // 🔴 Jamais le numéro entier sur la page.
    expect(recap).not.toContain(NUMERO);
    // La cible est jugée par les pièces de l'envoi, sur le corps qui partira, sans clé : rien n'est réservé.
    expect(m.jugements).toHaveLength(1);
    expect(m.jugements[0]).not.toHaveProperty('idempotencyKey');
    expect(m.partis).toEqual([]);
  });

  it('🔴 rien ne part avant le clic ; le clic envoie UNE fois, un corps de POST /v1/sends, sous la clé du oui', async () => {
    const m = monterIndividuels();
    const id = await propose(m);
    expect(m.partis).toEqual([]);
    const v = await accepter(m.deps, T, id, ADMIN);
    expect(v.ok && v.valeur).toMatchObject({ etat: 'faite', actions: [{ type: 'modele', resultat: { ok: true, etat: 'envoye', envoi: 'send-1' } }] });
    expect(m.partis).toHaveLength(1);
    const lu = schemaCorps.safeParse(m.partis[0]);
    expect(lu.success).toBe(true);
    if (!lu.success) return;
    expect(cleIdempotence(undefined, lu.data)).toEqual({ ok: true, cle: `oui:${id}:1` });
    const params = validateParamMapping(lu.data.params ?? [], { accepterVariables: true });
    expect(params).toEqual([{ position: 1, source: { type: 'literal', value: 'Claire' } }, { position: 2, source: { type: 'literal', value: '8412' } }]);
    expect(lireCible(lu.data, params!)).toEqual({ kind: 'template', name: 'commande_prete', language: 'fr' });
    // L'accord de la personne, déclaré au nom de celle qui a préparé (décision de Julien du 2026-10-25).
    expect(lu.data.recipients).toEqual([{ phone: NUMERO, consent: 'opted_in', consentSource: `déclaré dans Claude par ${CSM.userId}` }]);
    expect(schemaDestinataire.safeParse(lu.data.recipients[0]).success).toBe(true);
    // Un second clic rend le résultat, sans rien renvoyer.
    await accepter(m.deps, T, id, ADMIN);
    expect(m.partis).toHaveLength(1);
  });

  it('🔴 le oui fermé ne garde plus ni le numéro, ni les valeurs, ni le numéro masqué montré ; fait comme refusé', async () => {
    const m = monterIndividuels();
    const id = await propose(m);
    await accepter(m.deps, T, id, ADMIN);
    const l = await m.store.lire(T, id);
    expect(l).toMatchObject({ etat: 'faite', recapitulatif: [RECAPITULATIF_EFFACE], empreinte: 'expurgee' });
    expect(l!.actions[0]).not.toHaveProperty('telephone');
    expect(l!.actions[0]).not.toHaveProperty('valeurs');
    expect(l!.actions[0]).not.toHaveProperty('destinataire');
    expect(JSON.stringify(l)).not.toContain('Claire');
    // Refusé au clic : effacé de même.
    const m2 = monterIndividuels();
    m2.cycle.refus = { statut: 402, corps: { error: 'limite de 1000 envois de modèles par mois atteinte', code: 'plan_limit_reached' } };
    const id2 = await propose(m2);
    const v2 = await accepter(m2.deps, T, id2, ADMIN);
    expect(v2.ok && v2.valeur).toMatchObject({ etat: 'echouee', actions: [{ resultat: { ok: false, code: 'plan_limit_reached' } }] });
    expect(JSON.stringify(await m2.store.lire(T, id2))).not.toContain(NUMERO);
  });

  it('🔴 une personne qui a dit STOP, ou bloquée, est refusée dès la préparation ; une fiche inconnue aussi', async () => {
    const m = monterIndividuels();
    m.fiches.set(FICHE, contact({ phoneE164: NUMERO, optInStatus: 'opted_out' }));
    const stop = await proposer(m.deps, T, CSM, [MODELE]);
    expect(stop).toMatchObject({ ok: false, statut: 409, details: { code: 'opted_out' } });
    m.fiches.set(FICHE, contact({ phoneE164: NUMERO, blockedAt: '2026-11-01T00:00:00.000Z' }));
    expect(await proposer(m.deps, T, CSM, [MODELE])).toMatchObject({ ok: false, statut: 409, details: { code: 'blocked_contact' } });
    const { telephone: _t, ...sansNumero } = MODELE as DemandeAction & { telephone: string };
    const inconnue = await proposer(m.deps, T, CSM, [{ ...sansNumero, contact: '99999999-9999-4999-8999-999999999999' } as DemandeAction]);
    expect(inconnue).toMatchObject({ ok: false, statut: 404, details: { code: 'contact_not_found' } });
    expect(m.jugements).toEqual([]);
  });

  it('par sa fiche : le récapitulatif montre son numéro masqué, et l’envoi vise la fiche', async () => {
    const m = monterIndividuels();
    m.fiches.set(FICHE, contact());
    const { telephone: _t, ...sansNumero } = MODELE as DemandeAction & { telephone: string };
    const id = await propose(m, { ...sansNumero, contact: FICHE } as DemandeAction);
    expect((await m.store.lire(T, id))!.recapitulatif.join(' ')).toContain('+33 •• •• •• 32');
    await accepter(m.deps, T, id, ADMIN);
    expect((m.partis[0] as { recipients: unknown[] }).recipients).toEqual([{ contactId: FICHE, consent: 'opted_in', consentSource: `déclaré dans Claude par ${CSM.userId}` }]);
  });

  it('🔴 ce que l’envoi refuserait (un modèle non approuvé, une variable qui manque) est refusé dès la préparation, avec sa phrase et son code', async () => {
    const m = monterIndividuels();
    m.refusCible.valeur = { statut: 404, corps: { error: 'template introuvable, non approuvé ou d’une autre langue : commande_prete (fr)', code: 'template_not_found' } };
    expect(await proposer(m.deps, T, CSM, [MODELE])).toMatchObject({ ok: false, statut: 404, erreur: expect.stringMatching(/non approuvé/), details: { code: 'template_not_found' } });
    expect(m.partis).toEqual([]);
  });

  it('🔴 la catégorie de Meta a changé depuis le bouton : le clic est refusé, rien ne part', async () => {
    const m = monterIndividuels();
    const id = await propose(m);
    m.categorie.valeur = 'marketing';
    expect(await accepter(m.deps, T, id, ADMIN)).toMatchObject({ ok: false, statut: 409, details: { code: 'modifiee' } });
    expect(m.partis).toEqual([]);
  });

  it('🔴 préparé deux fois (un appel rejoué) : le MÊME bouton, jamais un second ; une autre valeur, ou après le clic, un nouveau', async () => {
    const m = monterIndividuels();
    const id = await propose(m);
    expect(await propose(m)).toBe(id);
    const autre = await propose(m, { ...MODELE, valeurs: ['Claire', '8413'] } as DemandeAction);
    expect(autre).not.toBe(id);
    await accepter(m.deps, T, id, ADMIN);
    const apres = await propose(m);
    expect([apres === id, apres === autre]).toEqual([false, false]);
    expect(m.partis).toHaveLength(1);
  });

  it('🔴 une action que cette version ne connaît pas (écrite par une image plus récente) échoue fermée : rien n’est publié', async () => {
    const m = monterIndividuels();
    const { id } = await m.store.inserer(T, {
      proposeePar: CSM.userId, autorisationId: null, libelle: 'Envoyer à 1 contact', recapitulatif: [],
      actions: [{ type: 'envoi_futur', scenario: '33333333-3333-4333-8333-333333333333', nom: 'x' } as never], empreinte: 'e',
      expireLe: new Date(m.horloge.now + 3_600_000),
    });
    expect(await m.store.accepter(T, id, ADMIN.userId, 'e')).toBe('ok');
    const v = await reprendre(m.deps, T, id);
    expect(v.ok && v.valeur).toMatchObject({ etat: 'echouee', actions: [{ resultat: { ok: false, code: 'action_inconnue' } }] });
    expect(m.publies).toEqual([]);
  });

  it('🔴 coupée APRÈS l’envoi : la reprise rend le MÊME envoi, rien ne repart', async () => {
    const m = monterIndividuels();
    const id = await propose(m);
    m.cycle.panneApres = true;
    const coupee = await accepter(m.deps, T, id, ADMIN);
    expect(coupee.ok && coupee.valeur.etat).toBe('interrompue');
    expect(m.partis).toHaveLength(1);
    const v = await reprendre(m.deps, T, id);
    expect(v.ok && v.valeur).toMatchObject({ etat: 'faite', actions: [{ resultat: { ok: true, etat: 'envoye', envoi: 'send-1' } }] });
    expect(m.partis).toHaveLength(1);
  });

  it('🔴 une clé encore en cours est une panne, pas un refus : le oui reste à reprendre, et la reprise envoie', async () => {
    const m = monterIndividuels();
    const id = await propose(m);
    m.cycle.enCours.add(`oui:${id}:1`);
    const v = await accepter(m.deps, T, id, ADMIN);
    expect(v.ok && v.valeur.etat).toBe('interrompue');
    m.cycle.enCours.clear();
    expect((await reprendre(m.deps, T, id))).toMatchObject({ ok: true, valeur: { etat: 'faite' } });
    expect(m.partis).toHaveLength(1);
  });

  it('🔴 plus de 23 heures après le clic, une reprise n’envoie plus rien : la clé du premier passage a pu expirer', async () => {
    const m = monterIndividuels();
    const id = await propose(m);
    m.cycle.panneAvant = true;
    expect((await accepter(m.deps, T, id, ADMIN)).ok).toBe(true);
    m.horloge.now += DELAI_DE_REPRISE_INDIVIDUELLE_MS + 60_000;
    const v = await reprendre(m.deps, T, id);
    expect(v.ok && v.valeur).toMatchObject({ etat: 'echouee', actions: [{ resultat: { ok: false, code: 'trop_tard' } }] });
    // Le refus dit où chercher l'envoi, s'il était parti : son nom dans Campagnes.
    expect(v.ok && JSON.stringify(v.valeur.actions[0]!.resultat)).toContain('« [API] commande_prete »');
    expect(m.partis).toEqual([]);
    expect(JSON.stringify(await m.store.lire(T, id))).not.toContain(NUMERO);
  });

  it('la personne écartée par l’envoi au clic : le refus est noté, rien n’est parti', async () => {
    const m = monterIndividuels();
    m.cycle.ecarte = 'window_closed';
    const id = await propose(m);
    const v = await accepter(m.deps, T, id, ADMIN);
    expect(v.ok && v.valeur).toMatchObject({ etat: 'echouee', actions: [{ resultat: { ok: false, code: 'window_closed', message: expect.stringMatching(/rien n’est parti/) } }] });
    expect(m.partis).toEqual([]);
  });

  it('un modèle part dans toutes les offres, la Free comprise', async () => {
    const m = monterIndividuels({ offre: 'base' });
    const id = await propose(m);
    expect(await accepter(m.deps, T, id, ADMIN)).toMatchObject({ ok: true, valeur: { etat: 'faite' } });
  });
});

describe('le oui d’un scénario envoyé à une personne (CSM, B8, livraison 2)', () => {
  const SCN: DemandeAction = { type: 'envoi_scenario', scenario: SCENARIO, valeurs: [], declarePar: CSM.userId, telephone: NUMERO };

  it('🔴 par son identifiant, son code ou son nom : le oui garde le scénario et vise son CODE', async () => {
    for (const ref of [SCENARIO, 'scn_relance', 'Relance']) {
      const m = monterIndividuels();
      const r = await proposer(m.deps, T, CSM, [{ ...SCN, scenario: ref }]);
      expect(r.ok && r.valeur.libelle, ref).toBe('Lancer le scénario pour 1 contact');
      expect(r.ok && r.valeur.actions, ref).toMatchObject([{ type: 'envoi_scenario', scenario: SCENARIO, nom: 'le scénario « Relance »' }]);
      expect(r.ok && r.valeur.recapitulatif.join(' '), ref).toContain('Le scénario « Relance » démarre pour le +33 •• •• •• 78');
      await accepter(m.deps, T, r.ok ? r.valeur.id : '', ADMIN);
      expect(m.partis, ref).toHaveLength(1);
      expect(m.partis[0], ref).toMatchObject({ target: { scenario: 'scn_relance' }, category: 'utility' });
    }
  });

  it('🔴 l’offre est relue à la reprise : un espace redescendu en Free après le clic ne fait pas partir le scénario', async () => {
    const m = monterIndividuels();
    const id = await propose(m, SCN);
    m.cycle.panneAvant = true;
    expect(await accepter(m.deps, T, id, ADMIN)).toMatchObject({ ok: true, valeur: { etat: 'interrompue' } });
    m.offre.valeur = 'base';
    const v = await reprendre(m.deps, T, id);
    expect(v.ok && v.valeur).toMatchObject({ etat: 'echouee', actions: [{ resultat: { ok: false, code: 'plan_feature_unavailable' } }] });
    expect(m.partis).toEqual([]);
  });

  it('un scénario inconnu : refusé dès la préparation', async () => {
    const m = monterIndividuels();
    expect(await proposer(m.deps, T, CSM, [{ ...SCN, scenario: '99999999-9999-4999-8999-999999999999' }])).toMatchObject({ ok: false, statut: 404 });
    expect(await proposer(m.deps, T, CSM, [{ ...SCN, scenario: 'Inconnu' }])).toMatchObject({ ok: false, statut: 404, details: { code: 'scenario_not_found' } });
  });

  it('🔴 sans la fonction des scénarios : refusé à la préparation, et au clic d’un espace redescendu depuis', async () => {
    const free = monterIndividuels({ offre: 'base' });
    expect(await proposer(free.deps, T, CSM, [SCN])).toMatchObject({ ok: false, details: { code: 'plan_feature_unavailable' } });
    const m = monterIndividuels();
    const id = await propose(m, SCN);
    m.offre.valeur = 'base';
    expect(await accepter(m.deps, T, id, ADMIN)).toMatchObject({ ok: false, statut: 409, details: { code: 'impossible' } });
    expect(m.partis).toEqual([]);
  });
});
