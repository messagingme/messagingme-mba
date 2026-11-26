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
import { apercuReprise, etatReprise, lancerReprise } from '../shopify/reprise';
import { reglerEtiquettes, suivreSegmentsShopify, synchroniserEtiquettes } from '../shopify/etiquettes';
import { BORNES_SEGMENTS, MOTIF_ID_COLLECTION } from '../../web/lib/partage/segments';

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
export const corpsBranchement = z.object({ boutique: z.string().max(200), clientId: z.string().max(300), secret: z.string().max(300) }).strict();
const corpsReglage = z.object({ delaiMinutes: z.number().int().optional(), ...consentementIgnore }).strict();
export const corpsImport = z.object({ maximum: z.number().int() }).strict();
const corpsPause = z.object({ pause: z.boolean() }).strict();
// `agentId` : la relance de panier avec agent IA seulement (2026-11-20), l'agent qui répond au bouton « Vous avez une question ? ».
const corpsLigne = z.object({ actif: z.boolean(), delaiMinutes: z.number().int().optional(), agentId: z.string().uuid().optional() }).strict();
// La langue choisit la phrase attestée côté serveur (`TEXTE_ATTESTATION_SHOPIFY`) : jamais un texte reçu.
const corpsAttestation = z.object({ coche: z.boolean(), langue: z.enum(['fr', 'en']).optional() }).strict();
// Le rattrapage des commandes (lot 5) : aucun réglage, la fenêtre se décide côté serveur (60 jours, 24 mois en Pro, lot 7a).
export const corpsRattrapage = z.object({}).strict();
// Les étiquettes des clients (segments Shopify enrichis, lot 6b) : le réglage du marchand ; « maintenant » ne prend rien.
export const corpsEtiquettes = z.object({ allumee: z.boolean() }).strict();
export const corpsSynchroEtiquettes = z.object({}).strict();
/** Lot 6c : exactement ces segments suivis ; la liste vide arrête de les suivre tous. */
export const corpsSegments = z.object({
  segments: z.array(z.string().regex(new RegExp(MOTIF_ID_COLLECTION))).max(BORNES_SEGMENTS.segmentsShopifyMax),
}).strict();

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

  // LE RATTRAPAGE DES COMMANDES DES 60 DERNIERS JOURS (segments Shopify enrichis, lot 5) : l'aperçu lit chez Shopify sans
  // rien écrire, le lancement inscrit la reprise et enfile son job (202, le worker la fait), l'état se relit.
  app.get('/tenants/:tenantId/integrations/shopify/commandes/apercu', optsLourds, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const r = await apercuReprise(deps.gestion.reprise, tenant);
    if (!r.ok) return reply.code(r.statut).send({ error: r.message });
    return reply.code(200).send(r.valeur);
  });

  app.post('/tenants/:tenantId/integrations/shopify/commandes/rattrapage', optsLourds, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const corps = corpsRattrapage.safeParse(req.body ?? {});
    if (!corps.success) return reply.code(400).send({ error: raisonCorps(corps.error) });
    const r = await lancerReprise(deps.gestion.reprise, tenant, req.auth?.userId ?? null);
    if (!r.ok) return reply.code(r.statut).send({ error: r.message });
    await journal(tenant, req, 'shopify.rattrapage', CIBLE, { reprise: r.valeur.id, depuis: r.valeur.fenetreDebut });
    return reply.code(202).send({ reprise: r.valeur });
  });

  app.get('/tenants/:tenantId/integrations/shopify/commandes/rattrapage', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    return reply.code(200).send({ reprise: await etatReprise(deps.gestion.reprise, tenant) });
  });

  // LES ÉTIQUETTES DES CLIENTS SHOPIFY (segments Shopify enrichis, lot 6b) : le réglage « Synchroniser les étiquettes »
  // (allumer lance aussitôt une synchronisation, éteindre arrête la relecture quotidienne) et le bouton « maintenant ». La
  // synchronisation tourne dans le worker (202 quand elle part) ; l'état et les étiquettes lues se relisent par
  // `GET .../contacts/segments/etiquettes-shopify`. Les MÊMES fonctions que `sync_shopify_customer_tags`.
  app.put('/tenants/:tenantId/integrations/shopify/etiquettes', optsLourds, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const corps = corpsEtiquettes.safeParse(req.body ?? {});
    if (!corps.success) return reply.code(400).send({ error: raisonCorps(corps.error) });
    const r = await reglerEtiquettes(deps.gestion.etiquettes, tenant, corps.data.allumee);
    if (!r.ok) return reply.code(r.statut).send({ error: r.message, ...(r.reessayerDansS ? { reessayerDansS: r.reessayerDansS } : {}) });
    await journal(tenant, req, 'shopify.etiquettes', CIBLE, { allumee: corps.data.allumee });
    return reply.code(r.valeur.lancee ? 202 : 200).send({ synchro: r.valeur });
  });

  // LES SEGMENTS SUIVIS (lot 6c) : exactement ces segments, parmi ceux que la synchronisation a listés ; le choix lance une
  // synchronisation qui les lit (202). La MÊME fonction que le paramètre `segments` de `sync_shopify_customer_tags`.
  app.put('/tenants/:tenantId/integrations/shopify/segments', optsLourds, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const corps = corpsSegments.safeParse(req.body ?? {});
    if (!corps.success) return reply.code(400).send({ error: raisonCorps(corps.error) });
    const r = await suivreSegmentsShopify(deps.gestion.etiquettes, tenant, corps.data.segments);
    if (!r.ok) return reply.code(r.statut).send({ error: r.message, ...(r.reessayerDansS ? { reessayerDansS: r.reessayerDansS } : {}) });
    await journal(tenant, req, 'shopify.segments', CIBLE, { segments: [...new Set(corps.data.segments)] });
    return reply.code(r.valeur.lancee ? 202 : 200).send({ synchro: r.valeur });
  });

  app.post('/tenants/:tenantId/integrations/shopify/etiquettes/synchro', optsLourds, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const corps = corpsSynchroEtiquettes.safeParse(req.body ?? {});
    if (!corps.success) return reply.code(400).send({ error: raisonCorps(corps.error) });
    const r = await synchroniserEtiquettes(deps.gestion.etiquettes, tenant);
    if (!r.ok) return reply.code(r.statut).send({ error: r.message, ...(r.reessayerDansS ? { reessayerDansS: r.reessayerDansS } : {}) });
    if (r.valeur.lancee) await journal(tenant, req, 'shopify.etiquettes_synchro', CIBLE);
    return reply.code(r.valeur.lancee ? 202 : 200).send({ synchro: r.valeur });
  });
}
