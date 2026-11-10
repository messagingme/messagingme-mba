import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { CE_QUI_EST_FACTURE, ETAPES_CARTE_META, PREREQUIS_META, WHATSAPP_ORDINAIRE } from '../web/lib/partage/etapes-meta';
import { FAQ } from '../scripts/plugin/faq';
import { PREREQUIS_LIGNE } from '../web/lib/questions-numero';
import { blocGuideMeta } from '../scripts/vitrine/guide-meta';
import { etatMiseEnService, type LecturesMiseEnService } from '../src/mcp/mise-en-service';
import { OUTILS, type DepsMcp } from '../src/mcp/outils';
import { signLienNumero } from '../src/auth/token';
import type { EtatConnexion } from '../src/otp/etat-connexion';

/**
 * CE QU'IL FAUT CHEZ META, UNE SEULE SOURCE POUR LA CONSOLE ET POUR CLAUDE (le guide « compte Meta », 2026-10-13). La
 * page « Connecter WhatsApp » dit les prérequis avant la fenêtre de Meta, l'Accueil et `get_setup_state` disent la carte
 * dès que Meta bloque le compte pour son moyen de paiement (erreur 141006, mesurée le même jour).
 */
const SECRET = randomBytes(32).toString('hex');
const outil = (nom: string) => OUTILS.find((o) => o.nom === nom)!;
const VIDE: EtatConnexion = { fourni: null, code: null, connecte: null, abonnement: null, inclusDansLePro: false };
const CONNECTE: EtatConnexion = { ...VIDE, connecte: { chiffres: '33612345678', aActiver: false } };
const PRET: LecturesMiseEnService = {
  offre: { offre: 'free', fonctions: [] },
  soldeMicroEur: 1_000_000,
  numero: CONNECTE,
  agents: [{ id: 'a1', label: 'Accueil', status: 'active', nbManques: null }],
  reglages: { mbaEnabled: false, repondeurMode: 'agent', repondeurAgentId: 'a1', repondeurWorkflowId: null, repondeurAdresseId: null },
  widgets: [{ id: 'w1', nom: 'Site', actif: true }],
};

function deps(): DepsMcp {
  return {
    numero: {
      signerLien: (l: Parameters<typeof signLienNumero>[0]) => signLienNumero(l, SECRET),
      etat: async () => VIDE,
      urlConsole: 'https://console.exemple.test',
      attendre: async () => {},
      maintenant: () => 1_000_000,
      // La destination du numéro fourni (0280), que le lien retient : ces tests ne regardent que les consignes.
      retenirDestination: async () => {},
    },
  } as unknown as DepsMcp;
}

describe('ce qu’il faut chez Meta', () => {
  it('les prérequis nomment le compte Meta Business, le portefeuille et le numéro libre ; la carte, Visa ou Mastercard', () => {
    const avant = PREREQUIS_META.map((e) => e.fr).join(' ');
    expect(avant).toMatch(/compte Meta Business/);
    expect(avant).toMatch(/portefeuille/);
    expect(avant).toMatch(/business\.facebook\.com/);
    expect(avant).toMatch(/application WhatsApp/);
    const carte = ETAPES_CARTE_META.map((e) => e.fr).join(' ');
    expect(carte).toMatch(/Paramètres de paiement/);
    expect(carte).toMatch(/Visa ou Mastercard/);
    expect([...PREREQUIS_META, ...ETAPES_CARTE_META].every((e) => e.fr.length > 0 && e.en.length > 0)).toBe(true);
  });

  it('🔴 WhatsApp ordinaire (lot 3a) : la 3e condition fait passer le numéro dans WhatsApp Business, jamais vers un autre numéro', () => {
    const numero = PREREQUIS_META[2]!;
    expect(numero.fr).toContain(WHATSAPP_ORDINAIRE.fr);
    expect(numero.en).toContain(WHATSAPP_ORDINAIRE.en);
    // L'ancienne phrase envoyait vers un numéro fourni tout numéro qui sert dans WhatsApp : il ne vaut que SANS numéro.
    expect(numero.fr).not.toMatch(/Pas de numéro libre/);
    expect(numero.en).not.toMatch(/No spare number/);
  });

  it('🔴 le portefeuille s’explique une fois, et le téléphone ne sert qu’au numéro qui reçoit le code (lot 4a-3)', () => {
    // La spec : plus de « portefeuille » sans explication. Il se nomme dans [0], comme Meta l'appelle dans ses écrans.
    expect(PREREQUIS_META[0]!.fr).toContain('l’ancien Business Manager, que Meta appelle aujourd’hui « portefeuille business »');
    expect(PREREQUIS_META[0]!.en).toContain('formerly Business Manager, which Meta now calls a “business portfolio”');
    expect(PREREQUIS_META[1]!.fr).not.toMatch(/^Pas encore de portefeuille/);
    // Le téléphone vit dans [2], le numéro : la console et Claude ne le disent jamais au numéro fourni ([0] et [1]), dont
    // le code s'affiche sur la page.
    expect(PREREQUIS_META[2]!.fr).toContain('le téléphone qui le porte');
    expect(PREREQUIS_META[2]!.en).toContain('the phone that holds it');
    expect(PREREQUIS_META.slice(0, 2).map((e) => `${e.fr} ${e.en}`).join(' ')).not.toMatch(/téléphone|phone/);
  });

  it('🔴 qui paie Meta ne se dit nulle part sans le Crédit WhatsApp (rouge de la relecture du lot 4a-2)', () => {
    // « Meta facture directement votre entreprise », « Messaging Me ne touche pas à ces frais » : faux avec le Crédit
    // WhatsApp, qui prépaie ces frais chez Messaging Me. Ici, ce que lisent Claude (la FAQ, les prérequis, qui paie), la
    // console, la fiche et le guide « compte Meta » ; les cas d'usage et les tarifs de la vitrine, qui parlent de la carte
    // par défaut, se reprennent avec le lot 3v-2.
    const faux = /ne touche pas à ces frais|never touches these fees|facture directement votre entreprise|bills your business directly|bills the business directly|facture votre entreprise directement/;
    const plat = (t: string): string => t.replace(/\s+/g, ' ');
    const lire = (f: string): string => plat(readFileSync(f, 'utf8'));
    // Les skills du plugin comprises : `regles-whatsapp` est celle que Claude charge pour « que coûte un message »
    // (rouge de la relecture du lot 4a-3, qu'un corpus sans elles ne voyait pas).
    const skills = readdirSync('plugin/skills').map((s) => `plugin/skills/${s}/SKILL.md`);
    const textes = [
      ...FAQ.flatMap((e) => [e.reponse.fr, e.reponse.en]),
      ...[...PREREQUIS_META, ...PREREQUIS_LIGNE, ...ETAPES_CARTE_META, CE_QUI_EST_FACTURE.api, CE_QUI_EST_FACTURE.application].flatMap((e) => [e.fr, e.en]),
      ...['docs/aide/fiches/ce-qu-il-faut-chez-meta.md', 'docs/aide/fiches/en/ce-qu-il-faut-chez-meta.md', 'plugin/README.md', ...skills].map(lire),
      blocGuideMeta('fr'), blocGuideMeta('en'),
    ];
    expect(skills.length).toBeGreaterThan(3);
    for (const t of textes) expect(plat(t)).not.toMatch(faux);
    // Et chaque texte qui dit qui paie Meta nomme l'exception, dans sa langue.
    const meta = FAQ.find((e) => e.id === 'ce-que-meta-facture')!;
    const exception = { fr: 'sauf avec le Crédit WhatsApp', en: 'except with WhatsApp credit' };
    const quiPaie: Array<[string, string, 'fr' | 'en']> = [
      ['FAQ « que facture Meta »', meta.reponse.fr, 'fr'], ['FAQ « what Meta bills »', meta.reponse.en, 'en'],
      ['fiche', lire('docs/aide/fiches/ce-qu-il-faut-chez-meta.md'), 'fr'], ['fiche en', lire('docs/aide/fiches/en/ce-qu-il-faut-chez-meta.md'), 'en'],
      ['guide Meta', plat(blocGuideMeta('fr')), 'fr'], ['guide Meta en', plat(blocGuideMeta('en')), 'en'],
      ['skill regles-whatsapp', lire('plugin/skills/regles-whatsapp/SKILL.md'), 'en'], ['README du plugin', lire('plugin/README.md'), 'en'],
    ];
    for (const [nom, t, langue] of quiPaie) expect(t, nom).toContain(exception[langue]);
  });

  it('🔴 la voie du Crédit WhatsApp (« Le vôtre ») dit les mêmes conditions, sans la carte (lot 4a-3)', () => {
    // `PREREQUIS_LIGNE` est la version sans carte de [0] et [1] : même nom du compte, même question.
    const premiere = (t: string): string => t.slice(0, t.indexOf('. '));
    for (const langue of ['fr', 'en'] as const) {
      expect(premiere(PREREQUIS_LIGNE[0]![langue]), langue).toBe(premiere(PREREQUIS_META[0]![langue]));
      expect(PREREQUIS_META[1]![langue].startsWith(PREREQUIS_LIGNE[1]![langue].replace(/\.$/, '')), langue).toBe(true);
    }
  });

  it('🔴 la fiche du bot d’aide reprend ces textes mot pour mot (elle ne peut pas importer la source)', () => {
    const plat = (t: string): string => t.replace(/\s+/g, ' ');
    const fiche = plat(readFileSync('docs/aide/fiches/ce-qu-il-faut-chez-meta.md', 'utf8'));
    for (const e of [...PREREQUIS_META, ...ETAPES_CARTE_META]) expect(fiche).toContain(plat(e.fr));
  });

  it('🔴 la page « Connecter WhatsApp » et l’Accueil lisent CES textes, rien d’écrit à part', () => {
    expect(readFileSync('web/components/ParcoursNumero.tsx', 'utf8')).toContain('PREREQUIS_META');
    expect(readFileSync('web/app/accueil/page.tsx', 'utf8')).toContain('ETAPES_CARTE_META');
  });

  it('🔴 Claude les dit avant le lien ; au numéro fourni, sans lui proposer un numéro qu’il vient de choisir', async () => {
    const apporte = await outil('start_whatsapp_connection').executer(deps(), 't1', { mode: 'apporte' }, { userId: 'u', autorisationId: 'aut-1' }) as Record<string, string>;
    for (const e of PREREQUIS_META) expect(apporte.consigne).toContain(e.fr);
    const fourni = await outil('start_whatsapp_connection').executer(deps(), 't1', { mode: 'fourni' }, { userId: 'u', autorisationId: 'aut-1' }) as Record<string, string>;
    for (const e of PREREQUIS_META.slice(0, 2)) expect(fourni.consigne).toContain(e.fr);
    expect(fourni.consigne).not.toContain(PREREQUIS_META[2]!.fr);
  });

  it('🔴 dès la connexion, la suite de watch_whatsapp_connection donne le chemin de la carte (le drapeau n’est pas encore lu)', async () => {
    const d = deps();
    (d.numero as unknown as { etat: () => Promise<EtatConnexion> }).etat = async () => ({ ...VIDE, connecte: { chiffres: '336', aActiver: false } });
    const r = await outil('watch_whatsapp_connection').executer(d, 't1', {}, { userId: 'u', autorisationId: 'aut-1' }) as Record<string, string>;
    for (const e of ETAPES_CARTE_META) expect(r.suite).toContain(e.fr);
  });

  it('🔴 get_setup_state : la carte à régler chez Meta, avec ses étapes, seulement sur un numéro connecté bloqué', () => {
    const bloque = etatMiseEnService({ ...PRET, numero: { ...CONNECTE, connecte: { chiffres: '336', aActiver: false, paiementBloque: true } } });
    expect(bloque.avertissements).toContain('carte_meta_a_regler');
    expect(bloque.etapes_carte_meta).toEqual(ETAPES_CARTE_META.map((e) => e.fr));
    const sain = etatMiseEnService(PRET);
    expect(sain.avertissements).not.toContain('carte_meta_a_regler');
    expect(sain.etapes_carte_meta).toBeUndefined();
    // Sans numéro connecté, rien à dire de la carte : la connexion vient d'abord.
    expect(etatMiseEnService({ ...PRET, numero: VIDE }).avertissements).not.toContain('carte_meta_a_regler');
    // 🔴 Le Crédit WhatsApp paie Meta (lot B) : l'option payée attend sa ligne, ou la ligne est posée. Ce n'est pas à la
    // carte chez Meta de payer, Claude ne doit pas dire d'en enregistrer une.
    const numeroBloque = { ...CONNECTE, connecte: { chiffres: '336', aActiver: false, paiementBloque: true } };
    for (const etatLigne of ['en_attente', 'active'] as const) {
      expect(etatMiseEnService({ ...PRET, numero: numeroBloque, etatLigne, avecApplication: false }).avertissements, etatLigne).not.toContain('carte_meta_a_regler');
    }
    for (const etatLigne of ['a_prendre', 'essai', 'arretee'] as const) {
      expect(etatMiseEnService({ ...PRET, numero: numeroBloque, etatLigne }).avertissements, etatLigne).toContain('carte_meta_a_regler');
    }
    // 🔴 Des numéros illisibles (`avecApplication` absent) : le conseil de la carte reste dit, comme sur l'Accueil (jaune 9
    // du lot C) ; seule une lecture qui dit « sans l'application » le tait.
    for (const etatLigne of ['en_attente', 'active'] as const) {
      expect(etatMiseEnService({ ...PRET, numero: numeroBloque, etatLigne }).avertissements, etatLigne).toContain('carte_meta_a_regler');
    }
    // 🔴 Un numéro qui garde l'application reste sur sa carte chez Meta (jaune 2 du lot B) : l'option payée ne le couvre pas.
    for (const etatLigne of ['en_attente', 'active'] as const) {
      expect(etatMiseEnService({ ...PRET, numero: numeroBloque, etatLigne, avecApplication: true }).avertissements, etatLigne).toContain('carte_meta_a_regler');
    }
  });
});
