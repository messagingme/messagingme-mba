/**
 * LES ERREURS DE LA FENÊTRE DE META QUE NOUS SAVONS EXPLIQUER (essai 263, 2026-11-16), écrites une fois : la page de
 * connexion les affiche quand la fenêtre se ferme sur elles (`lireErreurEs`, `web/lib/message-es.ts`), et le dépannage de
 * la vitrine (`scripts/vitrine/depannage-textes.ts`) les reprend telles quelles.
 *
 * #2388386 : « Pour utiliser ce numéro de téléphone, vous devrez supprimer un numéro existant dans Meta Business Suite ou
 * demander des numéros supplémentaires sur votre compte. » Un portefeuille Meta Business commence à DEUX numéros
 * enregistrés ; la limite monte (jusqu'à 20) après la vérification de l'entreprise, au jugement de Meta. Vécu par Julien
 * à l'essai 263 sur un portefeuille récent qui avait déjà ses deux numéros. Documentation de Meta : « Business phone
 * numbers », limite des numéros enregistrés.
 */
export const LIMITE_NUMEROS = {
  code: '2388386',
  titre: {
    fr: 'Meta dit de supprimer un numéro existant ou de demander des numéros supplémentaires (#2388386)',
    en: 'Meta says to remove an existing number or request more numbers (#2388386)',
  },
  cause: {
    fr: 'Votre compte Meta Business a déjà ses deux numéros : c’est la limite de Meta tant que l’entreprise n’est pas vérifiée.',
    en: 'Your Meta Business account already has its two numbers: that is Meta’s limit until the business is verified.',
  },
  sorties: [
    {
      fr: 'Le plus simple : rouvrez la fenêtre de Meta et, à l’écran du compte, choisissez « Créez un portefeuille business » : un nouveau compte, avec sa propre limite.',
      en: 'The simplest: reopen Meta’s window and, on the account screen, choose “Create a business portfolio”: a new account, with its own limit.',
    },
    {
      fr: 'Ou libérez une place : dans le Gestionnaire WhatsApp de Meta (business.facebook.com), Numéros de téléphone, supprimez un numéro que vous n’utilisez plus, puis rouvrez la fenêtre.',
      en: 'Or free a slot: in Meta’s WhatsApp Manager (business.facebook.com), Phone numbers, delete a number you no longer use, then reopen the window.',
    },
    {
      fr: 'Ou faites vérifier votre entreprise dans le Centre de sécurité de Meta : une fois vérifiée, Meta peut monter la limite jusqu’à 20 numéros.',
      en: 'Or have your business verified in Meta’s Security Center: once verified, Meta can raise the limit up to 20 numbers.',
    },
  ],
} as const;

/** Le texte d'aide d'une erreur rendue par la fenêtre ; `null` : une erreur que nous ne savons pas expliquer. */
export function aideErreurMeta(code: string | null | undefined): typeof LIMITE_NUMEROS | null {
  return code === LIMITE_NUMEROS.code ? LIMITE_NUMEROS : null;
}
