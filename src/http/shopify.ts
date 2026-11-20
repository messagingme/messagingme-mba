import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { gardeEtendue, type Guard, type PreHandler } from '../auth/middleware';
import { makeJournal, type AuditSink } from '../audit/journal';
import { espaceVerifie } from './scope';
import {
  apercuImportClients, connecterShopify, couperShopify, etatShopify, importerClients, type DepsGestionShopify,
} from '../shopify/gestion';
import { AUTOMATIONS_DISPONIBLES, estAutomationShopify } from '../shopify/donnees';
import { reglerAttestation, reglerLigne, reglerPause } from '../shopify/lignes-gestion';
import { reglerMessage } from '../shopify/preparation';

/**
 * PARAMÈTRES > INTÉGRATIONS > SHOPIFY : la carte de la console (plan 2026-10-21, lot 1 ; conception 2026-10-22). Une
 * boutique s'y branche (l'app créée à la main sur le tableau de bord de Shopify, ses deux clés collées), ses clients
 * abonnés s'y importent. Depuis le menu « Scénario » (lot 5), ses automations s'y allument ou s'éteignent, ligne par
 * ligne, et la boutique se met en pause. La MÊME gestion que les outils MCP.
 *
 * 🔴 RÉSERVÉ AUX ADMINS, LECTURE COMPRISE (monté sous `g.admin`), comme Salesforce : brancher une boutique fait entrer
 * des données de clients dans l'espace. Le secret ne revient jamais : `lire` ne le sélectionne pas. Ce qui appelle
 * Shopify ou Meta passe sous le plafond des opérations coûteuses.
 *
 * ⚠️ La Base (Free) n'a pas de console : elle pilote le connecteur par les outils MCP.
 */
export interface ShopifyRouteDeps {
  gestion: DepsGestionShopify;
  audit: AuditSink;
}

const CIBLE = { kind: 'integration', id: 'shopify' };

/**
 * L'ancien assistant (préparer un message, son modèle créé chez Meta) est retiré par le lot 5 : un onglet resté sur
 * l'ancienne console l'appelle encore, sa route refuse avec la phrase qui dit où les messages se règlent désormais.
 */
export const PHRASE_ASSISTANT_RETIRE = 'Les messages Shopify sont devenus des scénarios : ils se règlent désormais dans '
  + 'Automation, section Shopify. Rechargez la page.';

// Les corps se lisent par safeParse ; les bornes métier (domaine, clés, repères, délai) sont celles de la gestion.
// ⚠️ `consentementAffirme` est encore ACCEPTÉ, et ignoré : la console ne pose plus la question depuis le 2026-10-26, mais
// un onglet ouvert avec l'ancien bundle l'envoie encore, et un corps strict lui rendrait 400.
const consentementIgnore = { consentementAffirme: z.boolean().optional() };
const corpsBranchement = z.object({ boutique: z.string().max(200), clientId: z.string().max(300), secret: z.string().max(300) }).strict();
const corpsReglage = z.object({ delaiMinutes: z.number().int().optional(), ...consentementIgnore }).strict();
const corpsImport = z.object({ maximum: z.number().int() }).strict();
const corpsPause = z.object({ pause: z.boolean() }).strict();
// `agentId` : la relance de panier avec agent IA seulement (2026-11-20), l'agent qui répond au bouton « Vous avez une question ? ».
const corpsLigne = z.object({ actif: z.boolean(), delaiMinutes: z.number().int().optional(), agentId: z.string().uuid().optional() }).strict();
// La langue choisit la phrase attestée côté serveur (`TEXTE_ATTESTATION_SHOPIFY`) : jamais un texte reçu.
const corpsAttestation = z.object({ coche: z.boolean(), langue: z.enum(['fr', 'en']).optional() }).strict();

const raisonCorps = (e: z.ZodError): string => {
  const i = e.issues[0];
  return `${i && i.path.length > 0 ? i.path.join('.') : 'corps'} : ${i?.message ?? 'invalide'}`;
};

export function registerShopify(app: FastifyInstance, deps: ShopifyRouteDeps, garde: Guard, limiteCouteuse?: PreHandler): void {
  const opts = { preHandler: garde };
  const optsLourds = gardeEtendue(garde, limiteCouteuse);
  const journal = makeJournal(deps.audit);

  app.get('/tenants/:tenantId/integrations/shopify', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    return reply.code(200).send(await etatShopify(deps.gestion, tenant));
  });

  app.delete('/tenants/:tenantId/integrations/shopify', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const r = await couperShopify(deps.gestion, tenant);
    if (!r.ok) return reply.code(r.statut).send({ error: r.message });
    if (!r.valeur.dejaCoupee) await journal(tenant, req, 'shopify.coupee', CIBLE);
    return reply.code(200).send(r.valeur);
  });

  // Le branchement par la console : l'origine `console` fait abonner les webhooks par l'API.
  app.post('/tenants/:tenantId/integrations/shopify', optsLourds, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const corps = corpsBranchement.safeParse(req.body ?? {});
    if (!corps.success) return reply.code(400).send({ error: raisonCorps(corps.error) });
    const r = await connecterShopify(deps.gestion, tenant, corps.data, req.auth?.userId ?? null, 'console');
    if (!r.ok) return reply.code(r.statut).send({ error: r.message });
    await journal(tenant, req, 'shopify.branchee', CIBLE, { boutique: r.valeur.domaine, origine: 'console' });
    return reply.code(200).send(r.valeur);
  });

  // La pause de la boutique (décision 15) : ses parcours s'arrêtent, rien ne part plus ; la reprise reprend les paniers
  // notés APRÈS elle. Journalisée seulement quand elle change quelque chose.
  app.patch('/tenants/:tenantId/integrations/shopify', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const corps = corpsPause.safeParse(req.body ?? {});
    if (!corps.success) return reply.code(400).send({ error: raisonCorps(corps.error) });
    const r = await reglerPause(deps.gestion.lignes, tenant, corps.data.pause);
    if (!r.ok) return reply.code(r.statut).send({ error: r.message });
    if (r.valeur.changee) await journal(tenant, req, corps.data.pause ? 'shopify.pause' : 'shopify.reprise', CIBLE);
    return reply.code(200).send(r.valeur);
  });

  // L'attestation du consentement des clients (Julien, 2026-11-20) : chaque geste s'ajoute à l'historique, avec la phrase,
  // la boutique et la personne de la session ; décocher éteint les automations allumées.
  app.post('/tenants/:tenantId/integrations/shopify/attestation', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const corps = corpsAttestation.safeParse(req.body ?? {});
    if (!corps.success) return reply.code(400).send({ error: raisonCorps(corps.error) });
    const r = await reglerAttestation(deps.gestion.lignes, tenant, { coche: corps.data.coche, langue: corps.data.langue ?? 'fr', origine: 'console' }, req.auth?.userId ?? null);
    if (!r.ok) return reply.code(r.statut).send({ error: r.message });
    await journal(tenant, req, 'shopify.attestation', CIBLE, { coche: corps.data.coche });
    return reply.code(200).send({ attestation: r.valeur });
  });

  // L'interrupteur d'une automation : le premier allumage crée son scénario (un bloc template verrouillé, sans template
  // chez Meta) ; éteindre arrête ses parcours. Le délai du panier se règle avec sa ligne.
  app.put('/tenants/:tenantId/integrations/shopify/lignes/:evenement', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const { evenement } = req.params as { evenement: string };
    if (!estAutomationShopify(evenement) || !AUTOMATIONS_DISPONIBLES.includes(evenement)) {
      return reply.code(400).send({ error: `evenement : un de ${AUTOMATIONS_DISPONIBLES.join(', ')}.` });
    }
    const corps = corpsLigne.safeParse(req.body ?? {});
    if (!corps.success) return reply.code(400).send({ error: raisonCorps(corps.error) });
    const r = await reglerLigne(deps.gestion.lignes, tenant, evenement, corps.data, req.auth?.userId ?? null);
    if (!r.ok) return reply.code(r.statut).send({ error: r.message });
    await journal(tenant, req, 'shopify.ligne', CIBLE, { evenement, ...corps.data });
    return reply.code(200).send({ ligne: r.valeur });
  });

  app.post('/tenants/:tenantId/integrations/shopify/messages', opts, async (req, reply) => {
    espaceVerifie(req);
    return reply.code(410).send({ error: PHRASE_ASSISTANT_RETIRE });
  });

  // Le délai de la relance, réglé par l'écran d'avant : il vaut pour la ligne du panier, qui lit le même délai.
  app.patch('/tenants/:tenantId/integrations/shopify/messages/:evenement', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const corps = corpsReglage.safeParse(req.body ?? {});
    if (!corps.success) return reply.code(400).send({ error: raisonCorps(corps.error) });
    const { evenement } = req.params as { evenement: string };
    const { consentementAffirme: _ignore, ...reglage } = corps.data;
    const r = await reglerMessage(deps.gestion.lignes, tenant, { evenement, ...reglage });
    if (!r.ok) return reply.code(r.statut).send({ error: r.message });
    await journal(tenant, req, 'shopify.reglage', CIBLE, { evenement, ...reglage });
    return reply.code(200).send(r.valeur);
  });

  app.get('/tenants/:tenantId/integrations/shopify/clients/apercu', optsLourds, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const r = await apercuImportClients(deps.gestion, tenant);
    if (!r.ok) return reply.code(r.statut).send({ error: r.message });
    return reply.code(200).send(r.valeur);
  });

  app.post('/tenants/:tenantId/integrations/shopify/clients/import', optsLourds, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const corps = corpsImport.safeParse(req.body ?? {});
    if (!corps.success) return reply.code(400).send({ error: raisonCorps(corps.error) });
    const r = await importerClients(deps.gestion, tenant, corps.data.maximum, null);
    if (!r.ok) return reply.code(r.statut).send({ error: r.message });
    await journal(tenant, req, 'shopify.import', CIBLE, { importes: r.valeur.importes, retablis: r.valeur.retablis });
    return reply.code(200).send(r.valeur);
  });
}
