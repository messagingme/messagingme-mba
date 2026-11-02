import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Guard } from '../auth/middleware';
import { journaliser } from '../lib/journal';
import { espaceVerifie } from './scope';
import {
  ConnecteurEnReveil, ConnecteurPasAJour, HubspotServiceError, ProprietesInconnues, ReconsentRequiredError, type ChampsDuPortail,
} from '../crm/hubspot-service';
import { CHAMPS_HUBSPOT_MAX, schemaListeChoisie, type ChampChoisi, type ChampLibelle } from '../hubspot-workflow/champs';

/**
 * LES CHAMPS HUBSPOT À IMPORTER (lot 2 du plan `~/mm-hubspot/docs/2026-11-02-champs-hubspot-et-accord-plan.md`,
 * décisions 1 et 4 du cadrage du même jour) : le client choisit, dans Tools > Intégrations > HubSpot, les propriétés du
 * contact et de la transaction (et deux calculés) que les workflows HubSpot écrivent sur ses fiches. La liste vit chez le
 * connecteur, que ces routes lisent et écrivent par le canal service signé.
 */
export interface HubspotChampsRouteDeps {
  /** Les propriétés importables du portail, les calculés et la liste choisie (`lireChampsHubspot`). Une panne LÈVE. */
  lire(tenantId: string): Promise<ChampsDuPortail>;
  /** Déclare les champs de fiche (`declarerChampsHubspot`, idempotent). */
  declarer(tenantId: string, champs: readonly ChampLibelle[]): Promise<void>;
  /** Pose la liste chez le connecteur (`poserChampsHubspot`), qui rend la liste enregistrée. Une panne LÈVE. */
  poser(tenantId: string, champs: readonly ChampChoisi[]): Promise<ChampLibelle[]>;
}

const corpsChamps = z.object({ champs: schemaListeChoisie }).strict();

const PROPRIETES_INCONNUES = 'Ces propriétés n’existent plus dans HubSpot ou ne peuvent pas être importées : retirez-les de la liste.';

/** Les pannes du connecteur, dans les mots de l'écran. `false` : ce n'en est pas une, l'appelant relance. */
function repondrePanne(reply: FastifyReply, err: unknown, tenantId: string): FastifyReply | false {
  if (err instanceof ConnecteurEnReveil) {
    return reply.code(503).send({ error: 'HubSpot se réveille : réessayez dans quelques secondes.', code: 'connecteur_en_reveil' });
  }
  // 🔴 Jamais « aucun champ » : le connecteur n'a pas encore la route (mba part avant lui).
  if (err instanceof ConnecteurPasAJour) {
    return reply.code(503).send({ error: 'La mise à jour de l’intégration HubSpot est en cours : réessayez dans quelques minutes.', code: 'mise_a_jour_en_cours' });
  }
  // HubSpot refuse la lecture des propriétés au jeton du portail : le lien de re-consentement, jamais un 500.
  if (err instanceof ReconsentRequiredError) {
    return reply.code(409).send({ error: 'HubSpot demande de ré-autoriser l’application Messaging Me sur ce portail.', code: 'reconsent_required', reconsentUrl: err.reconsentUrl });
  }
  if (err instanceof HubspotServiceError && ((err.status === 404 && err.code === 'tenant_not_connected') || (err.status === 409 && err.code === 'portal_disconnected'))) {
    return reply.code(409).send({ error: 'Aucun portail HubSpot n’est relié à cet espace.', code: 'hubspot_non_relie' });
  }
  if (err instanceof HubspotServiceError) {
    journaliser('error', 'hubspot_champs_connecteur', { err, tenantId });
    return reply.code(502).send({ error: 'HubSpot n’a pas répondu : réessayez dans un instant.', code: 'hubspot_indisponible' });
  }
  return false;
}

/**
 * `GET /tenants/:tenantId/hubspot/champs` et `PUT` (admin, offre `crm` posée au montage). Le PUT, dans cet ordre :
 *   1. le corps validé (au plus `CHAMPS_HUBSPOT_MAX`, sans doublon, des noms qui tiennent dans une clé de fiche) ;
 *   2. les libellés relus CHEZ LE CONNECTEUR, jamais pris dans le corps : une propriété absente ou filtrée est refusée ;
 *   3. 🔴 les champs de fiche DÉCLARÉS AVANT de poser la liste : une déclaration en trop est inoffensive, une liste posée
 *      sans déclaration ferait envoyer des valeurs que mba ignore (il n'écrit qu'une clé déclarée) et que les sources
 *      d'un modèle ne peuvent pas viser ;
 *   4. la liste posée chez le connecteur.
 * Un champ décoché n'est jamais supprimé de la fiche ni des champs de l'espace : un modèle peut encore le viser.
 */
export function registerHubspotChamps(app: FastifyInstance, deps: HubspotChampsRouteDeps, garde: Guard): void {
  const opts = { preHandler: garde };

  app.get('/tenants/:tenantId/hubspot/champs', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    try {
      return reply.code(200).send(await deps.lire(tenant));
    } catch (err) {
      const r = repondrePanne(reply, err, tenant);
      if (r === false) throw err;
      return r;
    }
  });

  app.put('/tenants/:tenantId/hubspot/champs', opts, async (req, reply) => {
    const tenant = espaceVerifie(req);
    const parsed = corpsChamps.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: `corps invalide : champs, au plus ${CHAMPS_HUBSPOT_MAX} propriétés (contact, transaction ou calculé), sans doublon, au nom de 53 caractères au plus (minuscules, chiffres, « _ »)` });
    }
    const choisis = parsed.data.champs;

    try {
      const portail = await deps.lire(tenant);
      const libelleDe = (c: ChampChoisi): string | undefined => (c.objet === 'calcule'
        ? portail.calcules.find((k) => k.cle === c.propriete)?.libelle
        : portail.proprietes[c.objet].find((p) => p.nom === c.propriete)?.libelle);
      const declares = choisis.flatMap((c): ChampLibelle[] => {
        const libelle = libelleDe(c);
        return libelle === undefined ? [] : [{ ...c, libelle }];
      });
      if (declares.length < choisis.length) {
        return reply.code(400).send({
          error: PROPRIETES_INCONNUES,
          code: 'propriete_inconnue', champs: choisis.filter((c) => libelleDe(c) === undefined),
        });
      }
      await deps.declarer(tenant, declares);
      return reply.code(200).send({ choisis: await deps.poser(tenant, choisis) });
    } catch (err) {
      if (err instanceof ProprietesInconnues) {
        return reply.code(400).send({
          error: PROPRIETES_INCONNUES,
          code: 'propriete_inconnue', champs: err.champs,
        });
      }
      const r = repondrePanne(reply, err, tenant);
      if (r === false) throw err;
      return r;
    }
  });
}
