import { describe, it, expect } from 'vitest';
import {
  lireChampsHubspot, poserChampsHubspot, ConnecteurEnReveil, ConnecteurPasAJour, HubspotServiceError, ProprietesInconnues,
  type ConnectorDeps,
} from '../src/crm/hubspot-service';
import type { HttpResponse } from '../src/meta/http';

/**
 * LES CHAMPS HUBSPOT LUS ET POSÉS CHEZ LE CONNECTEUR (lot 2 du 2026-11-02, `/service/champs` et `/service/champs/poser`).
 * 🔴 Ce que l'écran ne doit jamais dire à tort : « aucun champ ». Un connecteur pas encore à jour (route absente), qui se
 * réveille, ou qui répond hors contrat est une ERREUR distincte, jamais une liste vide.
 */
function connecteur(reponses: HttpResponse[]) {
  const appels: Array<{ url: string; body: unknown; signature: string | undefined; echeance: AbortSignal | undefined }> = [];
  const deps: ConnectorDeps = {
    baseUrl: 'http://mm-hubspot-api:8096',
    secret: 'secret-du-canal',
    transport: {
      post: async (url, body, headers, opts) => {
        appels.push({ url, body, signature: headers['x-mm-service-signature'], echeance: opts?.signal });
        return reponses.shift() ?? { status: 500, json: null };
      },
    },
  };
  return { deps, appels };
}

const CHAMPS = {
  proprietes: {
    contact: [{ nom: 'firstname', libelle: 'Prénom', type: 'string' }],
    deal: [{ nom: 'montant_devis', libelle: 'Montant du devis', type: 'number' }],
  },
  calcules: [
    { cle: 'conseiller', libelle: 'Conseiller (propriétaire de la transaction)', disponible: true },
    { cle: 'lien_agenda', libelle: 'Lien de réservation du conseiller', disponible: false },
    { cle: 'lien_devis', libelle: 'Lien du devis', disponible: false },
    { cle: 'pdf_devis', libelle: 'PDF du devis', disponible: false },
  ],
  choisis: [{ objet: 'contact', propriete: 'firstname', libelle: 'Prénom' }],
};

describe('lireChampsHubspot', () => {
  it('🔴 un appel SIGNÉ à POST /service/champs, en un essai sous échéance, et la réponse validée', async () => {
    const { deps, appels } = connecteur([{ status: 200, json: CHAMPS }]);
    expect(await lireChampsHubspot(deps, 't1')).toEqual(CHAMPS);
    expect(appels).toHaveLength(1);
    expect(appels[0]!.url).toBe('http://mm-hubspot-api:8096/service/champs');
    expect(appels[0]!.body).toEqual({ tenantId: 't1' });
    expect(appels[0]!.signature).toMatch(/^v1=/);
    expect(appels[0]!.echeance).toBeInstanceOf(AbortSignal);
  });

  it('🔴 les débuts du document (lot B3) reviennent jusqu’à l’écran, jamais effacés par la validation', async () => {
    const avecDebuts = { ...CHAMPS, choisis: [...CHAMPS.choisis, { objet: 'calcule', propriete: 'document', libelle: 'PDF joint', debuts: ['Madame'] }] };
    const { deps } = connecteur([{ status: 200, json: avecDebuts }]);
    expect((await lireChampsHubspot(deps, 't1')).choisis[1]).toEqual({ objet: 'calcule', propriete: 'document', libelle: 'PDF joint', debuts: ['Madame'] });
  });

  it('🔴 un 404 sans `tenant_not_connected` (route absente, connecteur pas encore à jour) : `ConnecteurPasAJour`, jamais « aucun champ »', async () => {
    const { deps } = connecteur([{ status: 404, json: { message: 'Route POST:/service/champs not found', error: 'Not Found', statusCode: 404 } }]);
    await expect(lireChampsHubspot(deps, 't1')).rejects.toBeInstanceOf(ConnecteurPasAJour);
  });

  it('un espace sans portail : l’erreur du connecteur telle quelle (404 `tenant_not_connected`, 409 `portal_disconnected`)', async () => {
    const { deps } = connecteur([{ status: 404, json: { error: 'tenant_not_connected' } }, { status: 409, json: { error: 'portal_disconnected' } }]);
    await expect(lireChampsHubspot(deps, 't1')).rejects.toMatchObject({ status: 404, code: 'tenant_not_connected' });
    await expect(lireChampsHubspot(deps, 't1')).rejects.toMatchObject({ status: 409, code: 'portal_disconnected' });
  });

  it('🔴 une échéance dépassée est un RÉVEIL', async () => {
    const deps: ConnectorDeps = {
      baseUrl: 'http://mm-hubspot-api:8096',
      secret: 'secret-du-canal',
      transport: { post: async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); } },
    };
    await expect(lireChampsHubspot(deps, 't1')).rejects.toBeInstanceOf(ConnecteurEnReveil);
  });

  it('🔴 une réponse d’une autre forme est une ERREUR (un nom trop long, un calculé inconnu, une liste absente)', async () => {
    for (const json of [
      { ...CHAMPS, proprietes: { ...CHAMPS.proprietes, contact: [{ nom: 'a'.repeat(54), libelle: 'x', type: 'string' }] } },
      { ...CHAMPS, calcules: [{ cle: 'email', libelle: 'x', disponible: true }] },
      { proprietes: CHAMPS.proprietes, calcules: CHAMPS.calcules },
      null,
    ]) {
      const { deps } = connecteur([{ status: 200, json }]);
      await expect(lireChampsHubspot(deps, 't1'), JSON.stringify(json)?.slice(0, 80)).rejects.toMatchObject({ code: 'reponse_invalide' });
    }
  });
});

describe('poserChampsHubspot', () => {
  const LISTE = [{ objet: 'contact' as const, propriete: 'firstname' }];

  it('un appel signé à POST /service/champs/poser, la liste enregistrée rendue avec ses libellés', async () => {
    const { deps, appels } = connecteur([{ status: 200, json: { choisis: [{ objet: 'contact', propriete: 'firstname', libelle: 'Prénom' }] } }]);
    expect(await poserChampsHubspot(deps, 't1', LISTE)).toEqual([{ objet: 'contact', propriete: 'firstname', libelle: 'Prénom' }]);
    expect(appels[0]!.url).toBe('http://mm-hubspot-api:8096/service/champs/poser');
    expect(appels[0]!.body).toEqual({ tenantId: 't1', champs: LISTE });
  });

  it('🔴 le refus `propriete_inconnue` nomme les champs en cause ; un 400 d’une autre cause reste une erreur du service', async () => {
    const enCause = [{ objet: 'deal', propriete: 'supprimee' }];
    const { deps } = connecteur([
      { status: 400, json: { code: 'propriete_inconnue', champs: enCause } },
      { status: 400, json: { error: 'propriete_inconnue' } },
      { status: 400, json: { error: 'corps invalide' } },
    ]);
    const err = await poserChampsHubspot(deps, 't1', LISTE).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProprietesInconnues);
    expect((err as ProprietesInconnues).champs).toEqual(enCause);
    await expect(poserChampsHubspot(deps, 't1', LISTE)).rejects.toMatchObject({ champs: [] });
    const autre = await poserChampsHubspot(deps, 't1', LISTE).catch((e: unknown) => e);
    expect(autre).toBeInstanceOf(HubspotServiceError);
    expect(autre).not.toBeInstanceOf(ProprietesInconnues);
  });

  it('🔴 une route absente : `ConnecteurPasAJour` ; une réponse hors contrat : une erreur', async () => {
    const { deps } = connecteur([{ status: 404, json: { error: 'Not Found' } }, { status: 200, json: { choisis: [{ objet: 'company', propriete: 'x', libelle: 'x' }] } }]);
    await expect(poserChampsHubspot(deps, 't1', LISTE)).rejects.toBeInstanceOf(ConnecteurPasAJour);
    await expect(poserChampsHubspot(deps, 't1', LISTE)).rejects.toMatchObject({ code: 'reponse_invalide' });
  });
});
