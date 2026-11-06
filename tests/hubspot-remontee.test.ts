import { describe, it, expect } from 'vitest';
import { avecRemonteeHubspot, proprieteContactDe, type EcrituresDeFiche } from '../src/hubspot-workflow/remontee';
import { ecrireChampContactHubspot, type IssueEcritureChamp } from '../src/crm/hubspot-service';
import type { HttpTransport, HttpResponse } from '../src/meta/http';
import { buildWorkflowRuntime } from '../src/workflow/wiring';
import type { WorkflowExecutorDeps } from '../src/workflow/executor';
import { offresToutOuvert, filiereApiSeule } from './gardes';

/**
 * UN SCÉNARIO ÉCRIT UN CHAMP HUBSPOT DU CONTACT (cadrage `~/mm-hubspot/docs/2026-11-06-remontee-champs-cadrage.md`).
 * 🔴 L'invariant gardé ici : le miroir de la fiche n'est écrit qu'APRÈS HubSpot, et jamais sur un refus.
 */

function fiche() {
  const ecrits: string[] = [];
  const f: EcrituresDeFiche = {
    setField: async (_t, _w, key, value) => { ecrits.push(`set:${key}=${value}`); },
    clearField: async (_t, _w, key) => { ecrits.push(`clear:${key}`); },
  };
  return { f, ecrits };
}

function remontee(issue: IssueEcritureChamp | Error) {
  const { f, ecrits } = fiche();
  const envoyes: Array<{ tenantId: string; e164: string; propriete: string; valeur: string }> = [];
  const journal: string[] = [];
  /** Ce que la fiche portait AU MOMENT de l'appel à HubSpot : relevé ici, asserté après (un `expect` levé dans ce faux
   *  serait avalé par le `try` de la remontée et changé en échec). */
  const ficheAuMomentDeHubspot: string[][] = [];
  const champs = avecRemonteeHubspot(f, {
    ecrire: async (corps) => {
      envoyes.push(corps);
      ficheAuMomentDeHubspot.push([...ecrits]);
      if (issue instanceof Error) throw issue;
      return issue;
    },
    journaliser: async (e) => { journal.push(e.erreur); },
  });
  return { champs, ecrits, envoyes, journal, ficheAuMomentDeHubspot };
}

describe('proprieteContactDe', () => {
  it('seules les clés `hs_contact_<p>` reflètent une propriété du contact', () => {
    expect(proprieteContactDe('hs_contact_firstname')).toBe('firstname');
    for (const cle of ['hs_deal_amount', 'hs_calc_conseiller', 'firstname', 'hs_contact_', 'hs_contact_First', `hs_contact_${'x'.repeat(54)}`]) {
      expect(proprieteContactDe(cle), cle).toBeNull();
    }
  });
});

describe('avecRemonteeHubspot', () => {
  it('🔴 HubSpot écrit : la propriété part avec le numéro E.164 du contact, PUIS la fiche', async () => {
    const r = remontee({ issue: 'ecrit' });
    await r.champs.setField('t1', '33612345678', 'hs_contact_firstname', 'Julien');
    expect(r.envoyes).toEqual([{ tenantId: 't1', e164: '+33612345678', propriete: 'firstname', valeur: 'Julien' }]);
    expect(r.ficheAuMomentDeHubspot, 'la fiche n’est jamais écrite AVANT HubSpot').toEqual([[]]);
    expect(r.ecrits).toEqual(['set:hs_contact_firstname=Julien']);
    expect(r.journal).toEqual([]);
  });

  it('🔴 HubSpot refuse, ou panne : la fiche n’est PAS écrite, le motif va au journal, rien ne lève', async () => {
    for (const issue of [{ issue: 'echec', motif: 'HubSpot refuse la valeur : pas une option' } as const, new Error('câblage')]) {
      const r = remontee(issue);
      await r.champs.setField('t1', '33612345678', 'hs_contact_firstname', 'Julien');
      await r.champs.clearField('t1', '33612345678', 'hs_contact_firstname');
      expect(r.ecrits).toEqual([]);
      expect(r.journal).toHaveLength(2);
      expect(r.journal[0]).toContain('« hs_contact_firstname » non écrit');
    }
  });

  it('plus de miroir à tenir (`fiche_seule`) : la fiche s’écrit seule, comme avant', async () => {
    const r = remontee({ issue: 'fiche_seule' });
    await r.champs.setField('t1', '33612345678', 'hs_contact_firstname', 'Julien');
    expect(r.ecrits).toEqual(['set:hs_contact_firstname=Julien']);
    expect(r.journal).toEqual([]);
  });

  it('🔴 « vider un champ » vide la propriété dans HubSpot (valeur vide), puis la fiche', async () => {
    const r = remontee({ issue: 'ecrit' });
    await r.champs.clearField('t1', '33612345678', 'hs_contact_firstname');
    expect(r.envoyes.map((e) => e.valeur)).toEqual(['']);
    expect(r.ecrits).toEqual(['clear:hs_contact_firstname']);
  });

  it('🔴 une valeur VIDE écrite (échec d’un Appel API, d’une Fonction JS) n’efface jamais HubSpot : la fiche seule', async () => {
    const r = remontee({ issue: 'ecrit' });
    await r.champs.setField('t1', '33612345678', 'hs_contact_email', '');
    await r.champs.setField('t1', '33612345678', 'hs_contact_email', '   ');
    expect(r.envoyes).toEqual([]);
    expect(r.ecrits).toEqual(['set:hs_contact_email=', 'set:hs_contact_email=   ']);
  });

  it('🔴 transaction, calculé, champ ordinaire : jamais envoyés à HubSpot', async () => {
    const r = remontee({ issue: 'ecrit' });
    await r.champs.setField('t1', '33612345678', 'hs_deal_amount', '1200');
    await r.champs.setField('t1', '33612345678', 'hs_calc_conseiller', 'Paul');
    await r.champs.setField('t1', '33612345678', 'ville', 'Lyon');
    await r.champs.clearField('t1', '33612345678', 'hs_deal_amount');
    expect(r.envoyes).toEqual([]);
    expect(r.ecrits).toEqual(['set:hs_deal_amount=1200', 'set:hs_calc_conseiller=Paul', 'set:ville=Lyon', 'clear:hs_deal_amount']);
  });

  it('🔴 un contact sans numéro (identifiant opaque) : HubSpot n’est pas appelé, la fiche s’écrit seule, sans journal', async () => {
    const r = remontee({ issue: 'ecrit' });
    await r.champs.setField('t1', 'US.abc123', 'hs_contact_firstname', 'Julien');
    expect([r.envoyes, r.ecrits, r.journal]).toEqual([[], ['set:hs_contact_firstname=Julien'], []]);
  });

  it('sans connecteur configuré : les écritures d’origine, telles quelles', async () => {
    const { f } = fiche();
    expect(avecRemonteeHubspot(f, null)).toBe(f);
  });
});

/** Le connecteur vu par le transport : une réponse par appel, le corps envoyé retenu. */
function connecteur(reponse: HttpResponse | Error) {
  const appels: Array<{ url: string; body: unknown }> = [];
  const transport: HttpTransport = {
    post: async (url, body) => {
      appels.push({ url, body });
      if (reponse instanceof Error) throw reponse;
      return reponse;
    },
  };
  return { deps: { baseUrl: 'https://mm-hubspot.test', secret: 's', transport }, appels };
}
const CORPS = { tenantId: 't1', e164: '+33612345678', propriete: 'firstname', valeur: 'Julien' };

describe('ecrireChampContactHubspot', () => {
  it('appelle `/service/champs/ecrire` une seule fois, avec le corps du contrat', async () => {
    const c = connecteur({ status: 200, json: { issue: 'ecrit' } });
    expect(await ecrireChampContactHubspot(c.deps, CORPS)).toEqual({ issue: 'ecrit' });
    expect(c.appels).toEqual([{ url: 'https://mm-hubspot.test/service/champs/ecrire', body: CORPS }]);
  });

  it('🔴 les issues du connecteur, dans les mots du parcours', async () => {
    const cas: Array<[HttpResponse, IssueEcritureChamp['issue']]> = [
      [{ status: 200, json: { issue: 'non_choisi' } }, 'fiche_seule'],
      [{ status: 404, json: { error: 'tenant_not_connected' } }, 'fiche_seule'],
      // Le 404 de Fastify pour une route inconnue, tel que le connecteur le rend (mesuré le 2026-11-06).
      [{ status: 404, json: { message: 'Route POST:/service/champs/ecrire not found', error: 'Not Found', statusCode: 404 } }, 'fiche_seule'],
      // Tout autre 404 (une adresse fausse, un frontal) : un échec visible, jamais une écriture locale silencieuse.
      [{ status: 404, json: undefined }, 'echec'],
      [{ status: 404, json: { error: 'list_not_found' } }, 'echec'],
      // Le portail relié dont le jeton manque : HubSpot n'a pas la valeur.
      [{ status: 409, json: { error: 'portal_disconnected' } }, 'echec'],
      [{ status: 200, json: { issue: 'contact_inconnu' } }, 'fiche_seule'],
      [{ status: 200, json: { issue: 'refuse', message: 'pas une option' } }, 'echec'],
      [{ status: 409, json: { error: 'reconsent_required', reconsentUrl: 'https://x' } }, 'echec'],
      [{ status: 500, json: {} }, 'echec'],
      [{ status: 400, json: { error: 'corps invalide' } }, 'echec'],
      [{ status: 200, json: { issue: 'peut-etre' } }, 'echec'],
    ];
    for (const [rep, attendu] of cas) {
      const c = connecteur(rep);
      expect((await ecrireChampContactHubspot(c.deps, CORPS)).issue, JSON.stringify(rep)).toBe(attendu);
      expect(c.appels, 'un seul essai, jamais de relance').toHaveLength(1);
    }
  });

  it('le refus de HubSpot porte son message ; une panne réseau ou un délai dépassé est un échec, jamais une exception', async () => {
    const refus = await ecrireChampContactHubspot(connecteur({ status: 200, json: { issue: 'refuse', message: 'pas une option' } }).deps, CORPS);
    expect(refus).toEqual({ issue: 'echec', motif: 'HubSpot refuse la valeur : pas une option' });
    const delai = Object.assign(new Error('délai'), { name: 'TimeoutError' });
    expect(await ecrireChampContactHubspot(connecteur(delai).deps, CORPS)).toEqual({ issue: 'echec', motif: 'HubSpot n’a pas répondu à temps' });
    expect((await ecrireChampContactHubspot(connecteur(new Error('ECONNRESET')).deps, CORPS)).issue).toBe('echec');
  });
});

/**
 * LE CÂBLAGE DU SOCLE : l'exécuteur reçoit les écritures AVEC la remontée. Monté sans base, comme
 * `tests/crm-poser-etiquette.test.ts` : le faux pool retient le journal des échecs, le faux store la fiche.
 */
function socle(reponse: HttpResponse) {
  const requetes: string[] = [];
  const fusions: string[] = [];
  const vides: string[] = [];
  const c = connecteur(reponse);
  const inerte = {} as never;
  const runtime = buildWorkflowRuntime({
    pool: { query: async (sql: string) => { requetes.push(sql); return { rows: [], rowCount: 1 }; } } as never,
    queue: { enqueue: async () => {} },
    dryRun: true, repo: inerte,
    contactStore: {
      mergeFieldsByPhone: async (_t: string, _w: string, champs: Record<string, string>) => { fusions.push(JSON.stringify(champs)); },
      clearFieldsByPhone: async (_t: string, _w: string, cles: string[]) => { vides.push(...cles); },
    } as never,
    inboxStore: inerte, settingsStore: inerte, workflowStore: inerte, metaCredentials: inerte, metaFactory: inerte,
    rcsProvider: 'fake', emailTemplates: inerte, emailResolver: inerte, numeroDeLEspace: async () => null, runStore: inerte,
    fil: inerte, offres: offresToutOuvert, prevenirEquipe: async () => {}, application: filiereApiSeule,
    magasinObjets: null, connecteurHubspot: c.deps,
  });
  const { setField, clearField } = Reflect.get(runtime.executor, 'deps') as WorkflowExecutorDeps;
  return {
    setField, clearField, appels: c.appels, fusions,
    journal: () => requetes.filter((q) => /workflow_advance_failures/.test(q)).length,
    retraits: () => vides.length,
  };
}

describe('le câblage du socle : `setField` de l’exécuteur passe par la remontée', () => {
  it('🔴 HubSpot écrit : le connecteur, puis la fiche', async () => {
    const s = socle({ status: 200, json: { issue: 'ecrit' } });
    await s.setField('t1', '33612345678', 'hs_contact_firstname', 'Julien');
    expect(s.appels).toHaveLength(1);
    expect(s.fusions).toEqual(['{"hs_contact_firstname":"Julien"}']);
  });

  it('🔴 HubSpot refuse : la fiche n’est pas touchée, une ligne au journal des échecs de scénario', async () => {
    const s = socle({ status: 200, json: { issue: 'refuse', message: 'non' } });
    await s.setField('t1', '33612345678', 'hs_contact_firstname', 'Julien');
    expect(s.fusions).toEqual([]);
    expect(s.journal()).toBe(1);
  });

  it('🔴 `clearField` aussi : HubSpot refuse, la fiche n’est pas vidée ; HubSpot accepte, elle l’est', async () => {
    const refus = socle({ status: 200, json: { issue: 'refuse', message: 'non' } });
    await refus.clearField('t1', '33612345678', 'hs_contact_firstname');
    expect([refus.appels.length, refus.retraits(), refus.journal()]).toEqual([1, 0, 1]);
    const ok = socle({ status: 200, json: { issue: 'ecrit' } });
    await ok.clearField('t1', '33612345678', 'hs_contact_firstname');
    expect((ok.appels[0]?.body as { valeur: string }).valeur).toBe('');
    expect(ok.retraits()).toBe(1);
  });

  it('un champ ordinaire ne touche pas le connecteur', async () => {
    const s = socle({ status: 200, json: { issue: 'ecrit' } });
    await s.setField('t1', '33612345678', 'ville', 'Lyon');
    expect([s.appels, s.fusions]).toEqual([[], ['{"ville":"Lyon"}']]);
  });
});
