/**
 * LE BOUTON « E-MAIL » D'UN ESPACE DANS `/ops` : la fenêtre de rédaction de Gmail, ouverte sur le compte de
 * l'exploitant (`authuser`), destinataires remplis. Le message part de SA boîte (le domaine est chez Google), reste
 * dans ses envoyés et les réponses lui reviennent ; rien ne transite par l'API, qui n'a aucun accès à cette boîte.
 * `null` quand l'espace n'a aucun membre actif, ou quand l'API, plus ancienne, n'envoie pas encore les adresses.
 */
export function lienGmail(expediteur: string, destinataires: readonly string[] | undefined): string | null {
  if (!destinataires?.length) return null;
  const q = new URLSearchParams({ authuser: expediteur, view: 'cm', fs: '1', to: destinataires.join(',') });
  return `https://mail.google.com/mail/?${q.toString()}`;
}
