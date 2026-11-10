import { describe, it, expect } from 'vitest';
import { COMMANDE_DEMARRAGE, COMMANDES_PLUGIN, SERVEUR_PLUGIN_MCP, enSuiteDeDemarrage, suiteApresPro } from './demarrer';

/**
 * LA PAGE FINALE DU TUNNEL DE LA BASE (lot 19, plan `docs/superpowers/plans/2026-10-08-tunnel-de-la-base.md`) : ce qu'on
 * donne à copier à un espace qui vient de naître pour vivre dans Claude Code.
 */
describe('le plugin Claude Code (lot 10, livraison B)', () => {
  it('🔴 deux commandes, sans clé : le catalogue du dépôt public, puis le plugin', () => {
    expect(COMMANDES_PLUGIN).toEqual([
      '/plugin marketplace add messagingme/messagingme-plugin',
      '/plugin install messagingme@messagingme',
    ]);
    for (const c of COMMANDES_PLUGIN) expect(c).not.toMatch(/Authorization|Bearer|mba_|VOTRE_CLE/);
  });

  it('la mise en service se lance par la skill du plugin, et son serveur porte le nom que /mcp affiche', () => {
    expect(COMMANDE_DEMARRAGE).toBe('/messagingme:demarrer');
    expect(SERVEUR_PLUGIN_MCP).toBe('plugin:messagingme:messagingme');
  });
});

describe('la page du numéro sait qu’elle est une étape du tunnel', () => {
  it('par l’adresse, ou par la mémoire de l’onglet quand Stripe a renvoyé sans elle', () => {
    expect(enSuiteDeDemarrage('?suite=demarrer', null)).toBe(true);
    // Le retour de paiement d'un numéro fourni arrive sur `/connecter-whatsapp?abonnement=recu` : la suite y est perdue.
    expect(enSuiteDeDemarrage('?abonnement=recu', 'demarrer')).toBe(true);
    expect(enSuiteDeDemarrage('', null)).toBe(false);
    expect(enSuiteDeDemarrage('?suite=autre', null)).toBe(false);
  });

  it('🟡 la mémoire ne sert qu’au retour de Stripe : un onglet quitté en route ne garde pas le tunnel', () => {
    // Quitté par le menu sans passer par la page finale, puis la page du numéro rouverte depuis l'Accueil.
    expect(enSuiteDeDemarrage('', 'demarrer')).toBe(false);
    expect(enSuiteDeDemarrage('?portail=ouvert', 'demarrer')).toBe(false);
  });
});

describe('le retour de Stripe d’un Pro pris dans le tunnel (lot 3b)', () => {
  it('🔴 un onglet dans le tunnel repart vers la connexion de son numéro, l’essai commencé ou le paiement abandonné dit', () => {
    expect(suiteApresPro('?pro=recu', 'demarrer')).toBe('/connecter-whatsapp?suite=demarrer&pro=recu');
    expect(suiteApresPro('?pro=abandon', 'demarrer')).toBe('/connecter-whatsapp?suite=demarrer&pro=abandon');
    expect(suiteApresPro('?tab=offre&pro=recu', 'demarrer')).toBe('/connecter-whatsapp?suite=demarrer&pro=recu');
  });

  it('🔴 hors du tunnel, ou sans retour de Stripe, la page de l’offre reste la page de l’offre', () => {
    expect(suiteApresPro('?pro=recu', null)).toBeNull();
    expect(suiteApresPro('?pro=recu', 'autre')).toBeNull();
    expect(suiteApresPro('', 'demarrer')).toBeNull();
    expect(suiteApresPro('?fonction=console&suite=demarrer', 'demarrer')).toBeNull();
    expect(suiteApresPro('?pro=autre', 'demarrer')).toBeNull();
  });
});
