import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { ETAPES_NUMERO_FOURNI, SECONDES_SANS_CODE, SI_SEUL_TEXT_MESSAGE } from '../web/lib/partage/etapes-numero-fourni';
import { OUTILS, type DepsMcp } from '../src/mcp/outils';
import { signLienNumero } from '../src/auth/token';
import type { EtatConnexion } from '../src/otp/etat-connexion';

/**
 * LES ÉTAPES DU NUMÉRO FOURNI, UNE SEULE SOURCE POUR LA PAGE ET POUR CLAUDE (essai réel 99, 2026-10-13). Écrites deux
 * fois, elles disaient deux choses ; Julien a fixé l'ordre en faisant l'essai. Puis, le 2026-11-09 (aide à la connexion,
 * lot 2c), l'appel au lieu du SMS : « Phone call », surtout pas « Text message », et 45 secondes sans code se règlent
 * par « Phone call » encore, jamais par l'autre méthode. « Il faut lourdement insister. »
 */
const SECRET = randomBytes(32).toString('hex');
const VIDE: EtatConnexion = { fourni: null, code: null, connecte: null, abonnement: null, inclusDansLePro: false };
const outil = (nom: string) => OUTILS.find((o) => o.nom === nom)!;
const APPEL = ETAPES_NUMERO_FOURNI.filter((e) => e.insiste);

function deps(etat: EtatConnexion): DepsMcp {
  return {
    numero: {
      signerLien: (l: Parameters<typeof signLienNumero>[0]) => signLienNumero(l, SECRET),
      etat: async () => etat,
      urlConsole: 'https://console.exemple.test',
      attendre: async () => {},
      maintenant: () => 1_000_000,
      // La destination du numéro fourni (0280), que le lien retient : ces tests ne regardent que les consignes.
      retenirDestination: async () => {},
      fenetrePartenaire: async () => false,
    },
  } as unknown as DepsMcp;
}

/** Combien de fois `aiguille` figure dans `texte` (absent : zéro). */
const fois = (texte: string | undefined, aiguille: string): number => (texte ?? '').split(aiguille).length - 1;

describe('les étapes du numéro fourni', () => {
  it('🔴 l’ordre : la fenêtre de Meta, GB +44, « Phone call » surtout pas « Text message », le code, 45 s par « Phone call », « Finish »', () => {
    const fr = ETAPES_NUMERO_FOURNI.map((e) => e.fr);
    const ou = (motif: RegExp) => fr.findIndex((t) => motif.test(t));
    const ordre = [
      /Ouvrir la fenêtre de Meta/, /GB \(\+44\)/, /choisissez « Phone call » \(l’appel\), surtout pas « Text message »/,
      /saisissez-le/, /redemandez-le, toujours par « Phone call »/, /Finish/,
    ].map(ou);
    expect(ordre.every((i) => i >= 0)).toBe(true);
    expect([...ordre].sort((a, b) => a - b)).toEqual(ordre);
    expect(fr.join(' ')).toContain(`${SECONDES_SANS_CODE} secondes`);
    // La page et Claude donnent le numéro AVEC +44 : l'étape parle des chiffres qui le suivent, pas d'un « sans ».
    expect(fr.join(' ')).toMatch(/chiffres qui suivent \+44/);
    // Chaque étape existe dans les deux langues de la console.
    expect(ETAPES_NUMERO_FOURNI.every((e) => e.fr.length > 0 && e.en.length > 0)).toBe(true);
  });

  it('🔴 l’appel, jamais le SMS : une seule étape insiste, c’est elle, et « Text message » n’y figure que pour être refusé', () => {
    expect(APPEL).toHaveLength(1);
    expect(APPEL[0]!.fr).toMatch(/« Phone call ».*surtout pas « Text message »/);
    expect(APPEL[0]!.en).toMatch(/“Phone call”, NOT “Text message”/);
    // Plus aucune étape n'envoie vers « l'autre méthode », ni ne propose le SMS.
    for (const e of ETAPES_NUMERO_FOURNI) {
      expect(`${e.fr} ${e.en}`).not.toMatch(/autre méthode|other method/i);
      if (e !== APPEL[0]) expect(`${e.fr} ${e.en}`).not.toMatch(/Text message/);
    }
    expect(ETAPES_NUMERO_FOURNI.find((e) => e.fr.includes(`${SECONDES_SANS_CODE} secondes`))!.en).toMatch(/still by “Phone call”/);
    // La seule exception, à part : la fenêtre ne propose que « Text message ».
    expect(SI_SEUL_TEXT_MESSAGE.fr).toMatch(/ne propose que « Text message », prenez-le/);
    expect(SI_SEUL_TEXT_MESSAGE.en).toMatch(/only offers “Text message”, take it/);
  });

  it('🔴 la page du parcours affiche CES étapes, l’appel en gras et la ligne à part, et plus aucune consigne écrite à part', () => {
    const page = readFileSync('web/components/ParcoursNumero.tsx', 'utf8');
    expect(page).toContain('ETAPES_NUMERO_FOURNI');
    expect(page).not.toMatch(/Phone call|par appel|Text message/);
    expect(page).toMatch(/'insiste' in e && e\.insiste \? 'font-semibold/);
    expect(page).toMatch(/SI_SEUL_TEXT_MESSAGE\.fr, SI_SEUL_TEXT_MESSAGE\.en/);
  });

  it('🔴 Claude les redit toutes, encadrées : le lien, le paiement, l’appel redit à part, puis revenir seulement après « Finish »', async () => {
    for (const inclusDansLePro of [false, true]) {
      const r = await outil('start_whatsapp_connection').executer(deps({ ...VIDE, inclusDansLePro }), 't1', { mode: 'fourni' }, { userId: 'u', autorisationId: 'aut-1' }) as Record<string, string>;
      for (const e of ETAPES_NUMERO_FOURNI) expect(r.consigne).toContain(e.fr);
      expect(r.consigne).toMatch(/Cliquer sur le lien/);
      expect(r.consigne).toMatch(/Revenir te voir seulement une fois l’écran « Finish » passé/);
      expect(r.consigne).toMatch(inclusDansLePro ? /Obtenir mon numéro/ : /Payer 3,50 € HT par mois/);
      // L'étape de l'appel deux fois : dans la liste, puis redite à part ; l'exception, une fois, en passant.
      expect(r.consigne).toMatch(/Insiste lourdement/);
      expect(fois(r.consigne, APPEL[0]!.fr)).toBe(2);
      expect(fois(r.consigne, SI_SEUL_TEXT_MESSAGE.fr)).toBe(1);
      // Citées après un deux-points, sans guillemets autour des leurs (jaune 4 de la relecture).
      expect(r.consigne).not.toMatch(/« Pour recevoir le code|« Si la fenêtre de Meta/);
    }
  });

  it('🔴 numéro attribué, sans code : la suite redonne les mêmes étapes, et insiste sur l’appel', async () => {
    const r = await outil('watch_whatsapp_connection').executer(deps({ ...VIDE, fourni: '+441873901030' }), 't1', {}, { userId: 'u', autorisationId: 'aut-1' }) as Record<string, string>;
    for (const e of ETAPES_NUMERO_FOURNI) expect(r.suite).toContain(e.fr);
    expect(fois(r.suite, APPEL[0]!.fr)).toBe(2);
    expect(r.suite).toContain(SI_SEUL_TEXT_MESSAGE.fr);
    // La suite revient à chaque tour d'attente : l'insistance ne vaut que si les étapes sont redonnées (jaune 1).
    expect(r.suite).toMatch(/Si tu les redonnes, insiste lourdement/);
  });

  it('🔴 la skill du plugin dit « Phone call », NOT « Text message », et redemande par l’appel, jamais par l’autre méthode', () => {
    const skill = readFileSync('plugin/skills/mise-en-service/SKILL.md', 'utf8');
    const passage = skill.slice(skill.indexOf('For a number we provide through Meta\'s window'), skill.indexOf('Never write "I generated the link"'));
    expect(passage.length).toBeGreaterThan(0);
    expect(passage).toContain('"Phone call", NOT "Text message"');
    expect(passage).toContain('still by "Phone call"');
    expect(passage.indexOf('"Phone call"')).toBeLessThan(passage.indexOf('"Text message"'));
    expect(passage).not.toMatch(/other method|if Meta offers the choice/);
  });

  it('🔴 les fiches d’aide (FR, EN) et la capture générique de la fenêtre de Meta disent l’appel', () => {
    const fr = readFileSync('docs/aide/fiches/connecter-mon-numero-whatsapp.md', 'utf8');
    const en = readFileSync('docs/aide/fiches/en/connecter-mon-numero-whatsapp.md', 'utf8');
    expect(fr).toContain('**pour recevoir le code, choisissez « Phone call » (l\'appel), surtout pas « Text message »**');
    expect(fr).toContain('toujours par « Phone call »');
    expect(en).toContain('**to get the code, choose “Phone call”, NOT “Text message”**');
    expect(en).toContain('still by “Phone call”');
    for (const fiche of [fr, en]) expect(fiche).not.toMatch(/l'autre méthode|the other method|par SMS \(« Text message »\) si|by SMS \(“Text message”\) if/);
    // La capture coche l'appel ; la vraie viendra des rushes de Julien.
    const capture = readFileSync('web/e2e/captures/fenetre-meta.ts', 'utf8');
    expect(capture).toContain('<span>○ ${echapper(t.sms)}</span><b>● ${echapper(t.appel)}</b>');
  });
});
