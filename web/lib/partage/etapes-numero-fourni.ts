/**
 * LES ÉTAPES DU NUMÉRO FOURNI, UNE FOIS PAYÉ, ÉCRITES UNE SEULE FOIS (essai réel 99, 2026-10-13). La page du parcours
 * (`web/components/ParcoursNumero.tsx`) les affiche ; les outils MCP de la connexion (`src/mcp/outils-numero.ts`) les
 * font redire par Claude, qui y ajoute le lien et le paiement avant, et « revenir le voir » après. Écrites à part, elles
 * disaient deux choses (la page demandait l'appel). L'ordre est celui de Julien, qui a fait l'essai.
 * 🔴 L'APPEL, PAS LE SMS (aide à la connexion, lot 2c, décision de Julien du 2026-11-09 : « il faut lourdement
 * insister ») : l'essai 99 avait retenu « Text message » ; c'est désormais « Phone call », et au bout de 45 secondes sans
 * code on le redemande par « Phone call » encore, jamais par l'autre méthode. « Text message » ne se prend que si la
 * fenêtre ne propose rien d'autre (`SI_SEUL_TEXT_MESSAGE`). Les libellés sont ceux de la fenêtre de Meta en anglais.
 */

/**
 * CE QU'EST LE CODE DE VÉRIFICATION, et pourquoi il arrive chez nous (aide à la connexion, lot 1, 2026-11-09) : Julien
 * tient cette étape pour « ultra touchy ». Dit par Claude avant le lien d'un numéro fourni.
 */
export const CODE_VERIFICATION_FOURNI: { readonly fr: string; readonly en: string } = {
  fr: 'Le code de vérification : six chiffres que Meta, ou WhatsApp, envoie par SMS ou par appel au numéro, pour prouver '
    + 'qu’il est à vous. Le numéro fourni est chez nous : nous recevons ce SMS ou cet appel, et vous transmettons le code '
    + 'sur la page de connexion et dans la conversation avec votre assistant.',
  en: 'The verification code: six digits that Meta, or WhatsApp, sends by text message or phone call to the number, to '
    + 'prove it is yours. The provided number is with us: we receive that text or call, and pass the code on to you on the '
    + 'connection page and in the conversation with your assistant.',
};

/** Sans code au bout de ce délai, on redemande le code, toujours par « Phone call ». */
export const SECONDES_SANS_CODE = 45;

/**
 * La seule exception à l'appel, dite à part et discrètement (décision de Julien du 2026-11-09). Une ligne fixe
 * britannique ne reçoit pas de SMS : l'opérateur le lui lit à voix haute par un appel, le code dit par centaines
 * (`src/otp/extraire-code.ts`), un chemin plus fragile que l'appel direct, d'où « en général ».
 */
export const SI_SEUL_TEXT_MESSAGE: { readonly fr: string; readonly en: string } = {
  fr: 'Si la fenêtre de Meta ne propose que « Text message », prenez-le : le SMS nous parvient lu à voix haute par un '
    + 'appel, et le code s’affiche en général de la même façon.',
  en: 'If Meta’s window only offers “Text message”, take it: the text reaches us read aloud by a call, and the code '
    + 'usually shows the same way.',
};

/** `insiste` : l'étape que la page met en gras et sur laquelle Claude insiste, celle de l'appel. */
export const ETAPES_NUMERO_FOURNI: ReadonlyArray<{ fr: string; en: string; insiste?: true }> = [
  {
    fr: 'Cliquez sur « Ouvrir la fenêtre de Meta » et allez jusqu’au bout de la fenêtre.',
    en: 'Click “Open the Meta window” and go all the way through it.',
  },
  {
    fr: 'À l’écran du numéro, choisissez « Enter a new phone number » : le pays GB (+44), puis les chiffres qui suivent +44.',
    en: 'On the phone number screen, choose “Enter a new phone number”: the country GB (+44), then the digits that follow +44.',
  },
  {
    fr: 'Pour recevoir le code, choisissez « Phone call » (l’appel), surtout pas « Text message ».',
    en: 'To get the code, choose “Phone call”, NOT “Text message”.',
    insiste: true,
  },
  {
    fr: 'Le code s’affiche sur la page en quelques secondes : saisissez-le dans la fenêtre de Meta.',
    en: 'The code shows on the page within seconds: enter it in the Meta window.',
  },
  {
    fr: `Pas de code au bout de ${SECONDES_SANS_CODE} secondes : attendez que Meta propose de renvoyer le code, et `
      + 'redemandez-le, toujours par « Phone call ».',
    en: `No code after ${SECONDES_SANS_CODE} seconds: wait until Meta offers to send the code again, and ask for it again, `
      + 'still by “Phone call”.',
  },
  {
    fr: 'Allez jusqu’au dernier écran de Meta, « Finish » : c’est lui qui termine la connexion.',
    en: 'Go to Meta’s last screen, “Finish”: that is what completes the connection.',
  },
];
