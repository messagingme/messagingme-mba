// scripts/vitrine/depannage-textes.ts
// LE DÉPANNAGE DE LA CONNEXION DU NUMÉRO (lot 4a de l'aide à la connexion, spec `2026-11-08-aide-connexion-numero-design.md`,
// « Le dépannage ») : une source, en français et en anglais, que `aide.ts` pose sur une page du centre d'aide.
//
// 🔴 AUCUNE CAUSE NI AUCUN REMÈDE NE S'INVENTE (spec) : chaque remède est construit à partir de la constante qui fait foi,
// jamais recopié (les étapes du numéro fourni, la fenêtre bloquée, WhatsApp ordinaire, la carte chez
// Meta) ; ce qui vient d'une fiche le dit, et `tests/vitrine-depannage.test.ts` tient chaque citation égale à sa source.
import { FENETRE_BLOQUEE } from '../../web/lib/fenetre-meta';
import { ETAPES_CARTE_META, WHATSAPP_ORDINAIRE } from '../../web/lib/partage/etapes-meta';
import { ETAPES_NUMERO_FOURNI, SI_SEUL_TEXT_MESSAGE } from '../../web/lib/partage/etapes-numero-fourni';
import { PAGES_SOURCES } from './aide-sources-textes';
import { TEXTES_TUNNEL } from './tunnel-textes';

export interface Bilingue { readonly fr: string; readonly en: string }
/** Où la personne se trouve : la première question de la page. */
export type Ou = 'claude' | 'console';

/** Un symptôme, dit comme on le vit, sa cause, ce qu'il faut faire, et la page qui va plus loin. */
export interface Symptome {
  readonly id: string;
  readonly ou: readonly Ou[];
  readonly titre: Bilingue;
  readonly cause: Bilingue;
  readonly remede: readonly Bilingue[];
  readonly lien: { readonly libelle: Bilingue; readonly href: Bilingue };
}

const GUIDE: Bilingue = { fr: TEXTES_TUNNEL.fr.guide.adresse, en: TEXTES_TUNNEL.en.guide.adresse };
const NUMERO_CONSOLE: Bilingue = { fr: '/aide/connecter-mon-numero-whatsapp/', en: '/en/help/connect-my-whatsapp-number/' };
const NUMERO_CLAUDE: Bilingue = { fr: '/developpeurs/connecter-son-numero/', en: '/en/developers/connect-your-number/' };
const GARDER: Bilingue = { fr: '/aide/garder-mon-application-whatsapp-business/', en: '/en/help/keep-my-whatsapp-business-app/' };
const CONTACT: Bilingue = { fr: '/contact/', en: '/en/contact/' };
/** « Payer Meta » (lot 4a-2) : les étapes de la carte et qui paie quoi ; son titre et son adresse se lisent chez elle. */
const PAYER_META = (() => {
  const p = PAGES_SOURCES.find((x) => x.cle === 'payer-meta');
  if (!p) throw new Error('dépannage : plus de page « payer-meta » dans aide-sources-textes.ts');
  return p;
})();

/** L'étape du numéro fourni dont parle le symptôme, telle que la page de connexion et Claude la disent. */
const etapeFournie = (debut: string): Bilingue => {
  const e = ETAPES_NUMERO_FOURNI.find((x) => x.fr.startsWith(debut));
  if (!e) throw new Error(`dépannage : aucune étape du numéro fourni ne commence par « ${debut} »`);
  return { fr: e.fr, en: e.en };
};

export const DEPANNAGE = {
  adresse: { fr: '/aide/depanner-la-connexion-du-numero/', en: '/en/help/troubleshoot-the-number-connection/' },
  titre: { fr: 'Dépanner la connexion de votre numéro WhatsApp', en: 'Troubleshoot your WhatsApp number connection' },
  chapeau: {
    fr: 'Ce qui bloque le plus souvent, sa cause et ce qu’il faut faire, depuis Claude Code ou Codex comme depuis la console.',
    en: 'What most often gets stuck, why, and what to do, from Claude Code or Codex as from the console.',
  },
  description: {
    fr: 'Pas de lien, pas de code, numéro non éligible, fenêtre de Meta qui ne s’ouvre pas : les causes et les remèdes de la connexion d’un numéro WhatsApp.',
    en: 'No link, no code, number not eligible, Meta’s window that does not open: the causes and fixes when connecting a WhatsApp number.',
  },
  ou: {
    question: { fr: 'Vous êtes dans Claude Code ou Codex, ou dans la console ?', en: 'Are you in Claude Code or Codex, or in the console?' },
    claude: { fr: 'Claude Code ou Codex', en: 'Claude Code or Codex' },
    console: { fr: 'La console', en: 'The console' },
    tout: { fr: 'Tout voir', en: 'Show all' },
    /** Ce que le filtre annonce (`role="status"`), `{n}` les situations montrées sur `{total}`. */
    compte: { fr: '{n} situations sur {total}', en: '{n} of {total} situations' },
  },
  /** L'entrée large, par le numéro (l'arbre de Julien du 2026-10-30) : chacune mène au chemin qui la règle. */
  macro: {
    titre: { fr: 'Je n’arrive pas à connecter mon numéro', en: 'I can’t connect my number' },
    choix: [
      { libelle: { fr: 'J’ai un numéro que je peux utiliser', en: 'I have a number I can use' }, href: GUIDE },
      { libelle: { fr: 'Il me faut un numéro', en: 'I need a number' }, href: GUIDE },
      { libelle: { fr: 'Je vous ai acheté un numéro', en: 'I bought a number from you' }, href: NUMERO_CONSOLE },
    ],
  },
  /** Le dernier mot de chaque réponse, avant la page qui va plus loin (il entre aussi dans la réponse balisée). */
  voir: { fr: 'Pour aller plus loin :', en: 'To go further:' },
  /** Le titre de la liste des symptômes. */
  liste: { fr: 'Ce qui bloque, et quoi faire', en: 'What gets stuck, and what to do' },
  symptomes: [
    {
      id: 'pas-de-lien', ou: ['claude'],
      titre: { fr: 'Claude dit qu’il attend, mais je n’ai pas de lien', en: 'Claude says it is waiting, but I have no link' },
      cause: { fr: 'Le lien n’a pas été écrit en entier, ou l’heure pendant laquelle il vaut est passée.', en: 'The link was not written out in full, or the hour it is valid for has passed.' },
      // `src/mcp/outils-numero.ts` : le lien vaut une heure, et l'attente en rend un neuf.
      remede: [{ fr: 'Demandez-lui « donne-moi le lien de connexion ». Le lien vaut une heure ; si l’heure est passée, Claude en donne un neuf.', en: 'Ask it “give me the connection link”. The link is valid for one hour; if the hour has passed, Claude gives a new one.' }],
      lien: { libelle: { fr: 'Connecter votre numéro depuis Claude', en: 'Connect your number from Claude' }, href: NUMERO_CLAUDE },
    },
    {
      id: 'saisir-le-numero', ou: ['claude', 'console'],
      titre: { fr: 'J’ai un numéro fourni et je n’arrive pas à le saisir', en: 'I have a provided number and can’t enter it' },
      cause: { fr: 'La fenêtre de Meta demande le pays à part, puis le numéro sans son indicatif.', en: 'Meta’s window asks for the country separately, then the number without its country code.' },
      remede: [etapeFournie('À l’écran du numéro')],
      lien: { libelle: { fr: 'Connecter mon numéro WhatsApp', en: 'Connect my WhatsApp number' }, href: NUMERO_CONSOLE },
    },
    {
      id: 'pas-de-code', ou: ['claude', 'console'],
      titre: { fr: 'Le code de mon numéro fourni n’arrive pas', en: 'The code for my provided number does not arrive' },
      cause: { fr: 'Meta envoie le code au numéro par un appel, que notre ligne capte ; il arrive qu’il tarde, ou que la fenêtre propose seulement le SMS.', en: 'Meta sends the code to the number by a call, which our line picks up; it can be slow, or the window may only offer a text.' },
      remede: [
        etapeFournie('Pas de code au bout de'),
        { fr: SI_SEUL_TEXT_MESSAGE.fr, en: SI_SEUL_TEXT_MESSAGE.en },
        // La fiche « Connecter mon numéro WhatsApp », étape 3, et la décision de Julien du 2026-11-08 (48 heures).
        { fr: 'Meta ne tolère que dix demandes par numéro sur 72 heures, et bloque le numéro au-delà. Au bout de 48 heures sans code, écrivez-nous.', en: 'Meta only allows ten requests per number over 72 hours, and blocks the number beyond that. After 48 hours without a code, write to us.' },
      ],
      lien: { libelle: { fr: 'Nous écrire', en: 'Write to us' }, href: CONTACT },
    },
    {
      id: 'whatsapp-ordinaire', ou: ['claude', 'console'],
      titre: { fr: 'Mon numéro est dans WhatsApp, l’application ordinaire', en: 'My number is in WhatsApp, the regular app' },
      cause: { fr: 'WhatsApp ordinaire ne se relie pas à l’API : seule l’application WhatsApp Business le peut.', en: 'Regular WhatsApp cannot connect to the API: only the WhatsApp Business app can.' },
      remede: [{ fr: WHATSAPP_ORDINAIRE.fr, en: WHATSAPP_ORDINAIRE.en }],
      lien: { libelle: { fr: 'Garder mon application WhatsApp Business', en: 'Keep my WhatsApp Business app' }, href: GARDER },
    },
    {
      id: 'fenetre-bloquee', ou: ['claude', 'console'],
      titre: { fr: 'La fenêtre de Meta ne s’ouvre pas', en: 'Meta’s window does not open' },
      cause: { fr: 'Le plus souvent, le navigateur bloque les fenêtres surgissantes de la page.', en: 'Most often, the browser blocks the page’s pop-ups.' },
      remede: [{ fr: FENETRE_BLOQUEE.fr, en: FENETRE_BLOQUEE.en }],
      lien: { libelle: { fr: 'Connecter mon numéro WhatsApp', en: 'Connect my WhatsApp number' }, href: NUMERO_CONSOLE },
    },
    {
      id: 'a-activer', ou: ['console'],
      titre: { fr: 'Mon numéro est connecté, mais Meta ne l’a pas encore vérifié', en: 'My number is connected, but Meta has not verified it yet' },
      // La fiche « Connecter mon numéro WhatsApp », étape 3.
      cause: { fr: 'Meta a laissé terminer l’inscription sans vérifier le numéro : il est bien à vous, mais il ne peut pas encore envoyer.', en: 'Meta let the sign-up finish without verifying the number: it is yours, but it cannot send yet.' },
      remede: [{ fr: 'La carte du numéro, sur l’Accueil de la console, porte le bouton « Activer le numéro » : Meta envoie un code, vous le saisissez, et le numéro est enregistré.', en: 'The number card, on the console’s Home screen, has the “Activate the number” button: Meta sends a code, you enter it, and the number is registered.' }],
      lien: { libelle: { fr: 'Vérifier le numéro', en: 'Verify the number' }, href: { fr: `${NUMERO_CONSOLE.fr}#etape-3`, en: `${NUMERO_CONSOLE.en}#etape-3` } },
    },
    {
      id: 'modeles-bloques', ou: ['claude', 'console'],
      titre: { fr: 'Mes modèles ne partent pas', en: 'My templates do not go out' },
      cause: { fr: 'Meta facture les modèles à votre entreprise : sans moyen de paiement sur votre compte Meta Business, ils ne partent pas, sauf avec le Crédit WhatsApp, qui les paie.', en: 'Meta bills templates to your business: without a payment method on your Meta Business account, they do not go out, except with WhatsApp credit, which pays for them.' },
      remede: ETAPES_CARTE_META.map((e) => ({ fr: e.fr, en: e.en })),
      // Vers « Payer Meta », qui donne les mêmes étapes et qui paie quoi (jaune 6 de la relecture du lot 4a-2).
      lien: { libelle: PAYER_META.titre, href: PAYER_META.adresse },
    },
  ] satisfies readonly Symptome[],
} as const;
