/**
 * LES ÉTAPES DE LA FILIÈRE APPLICATION WHATSAPP BUSINESS, ÉCRITES UNE SEULE FOIS (2026-10-22). La page du lien
 * (`/brancher`) les affiche à côté du QR code ; les outils MCP de la connexion (`src/mcp/outils-numero.ts`) les font
 * redire par Claude. Le chemin des menus est celui de l'essai du 2026-10-21 (Android, WhatsApp Business).
 */

/** Avant le QR code, pour un numéro fourni : créer le compte de l'application avec ce numéro. */
export const ETAPES_COMPTE_FOURNI: ReadonlyArray<{ fr: string; en: string }> = [
  {
    fr: 'Sur un téléphone, installez l’application WhatsApp Business et créez le compte avec ce numéro.',
    en: 'On a phone, install the WhatsApp Business app and create the account with this number.',
  },
  {
    fr: 'Pour la vérification, choisissez l’appel : le code s’affiche sur la page en quelques secondes, saisissez-le dans l’application.',
    en: 'For the verification, choose the phone call: the code shows on the page within seconds, enter it in the app.',
  },
];

/**
 * CE QUI VA SE PASSER DANS LA FENÊTRE DE META quand on garde l'application (aide à la connexion, lot 1, 2026-11-09) :
 * dit par Claude AVANT le lien, pour que la personne sache qu'il lui faut Facebook, que le compte Meta Business se crée
 * en chemin, et qu'un QR code l'attend. Tiré des neuf écrans de la fiche `garder-mon-application-whatsapp-business`
 * (essai 161, 2026-10-25) ; les libellés entre guillemets sont ceux de Meta.
 */
export const ETAPES_FENETRE_GARDER: ReadonlyArray<{ fr: string; en: string }> = [
  {
    fr: 'La fenêtre de Meta s’ouvre : connectez-vous avec votre profil Facebook.',
    en: 'Meta’s window opens: sign in with your Facebook profile.',
  },
  {
    fr: 'Saisissez le numéro de votre application WhatsApp Business, avec son pays, puis choisissez comment Meta le vérifie '
      + '(par message ou par appel).',
    en: 'Enter the number of your WhatsApp Business app, with its country, then choose how Meta verifies it (by text '
      + 'message or by phone call).',
  },
  {
    fr: 'Choisissez votre compte Meta Business ; s’il n’existe pas, « Créez un portefeuille business » (le nom que Meta lui '
      + 'donne) : Meta demande le nom de votre entreprise, une adresse e-mail, le pays et votre site.',
    en: 'Choose your Meta Business account; if you have none, “Create a business portfolio” (the name Meta gives it): Meta '
      + 'asks for your business name, an email address, the country and your website.',
  },
  {
    fr: 'Dans l’application WhatsApp Business de votre téléphone, scannez le code QR que montre la fenêtre (ou saisissez le '
      + 'code d’accès qu’elle propose, après avoir appuyé sur « Connect » dans le message reçu dans l’application).',
    en: 'In the WhatsApp Business app on your phone, scan the QR code the window shows (or enter the access code it '
      + 'offers, after tapping “Connect” in the message received in the app).',
  },
  {
    fr: 'Confirmez le partage avec Messaging Me, puis « Terminer ».',
    en: 'Accept sharing with Messaging Me, then “Finish”.',
  },
];

/** Relier le compte : le QR code de la page, scanné depuis le téléphone. */
export const ETAPES_RELIER_APPLICATION: ReadonlyArray<{ fr: string; en: string }> = [
  {
    fr: 'Sur le téléphone, dans WhatsApp Business : Paramètres, puis Appareils connectés, puis Connecter un appareil.',
    en: 'On the phone, in WhatsApp Business: Settings, then Linked devices, then Link a device.',
  },
  {
    fr: 'Scannez le QR code de la page. Il se renouvelle tout seul ; s’il a expiré, cliquez sur « Nouveau QR code ».',
    en: 'Scan the QR code on the page. It renews by itself; if it has expired, click “New QR code”.',
  },
  {
    fr: 'Le téléphone reste le vôtre : vous pouvez toujours y répondre, et une réponse tapée sur le téléphone fait se retirer l’agent IA de la conversation.',
    en: 'The phone stays yours: you can still reply on it, and a reply typed on the phone makes the AI agent step out of the conversation.',
  },
];
