import type { DepsPubInscription } from '../src/pub/inscription';

/**
 * Un faux de l'accord publicitaire (pixel, lot 2) : il note, dans l'ordre, ce que la route lui demande. `leve` : chaque
 * appel lève, pour prouver qu'une panne ici ne fait pas échouer l'entrée.
 */
export function fauxPub(o: { leve?: boolean } = {}): { notes: string[]; deps: DepsPubInscription } {
  const notes: string[] = [];
  const noter = async (n: string): Promise<void> => {
    if (o.leve) throw new Error('base indisponible');
    notes.push(n);
  };
  return {
    notes,
    deps: {
      enregistrerConsentement: (adresse, pub) => noter(`accord ${adresse} fbc=${pub.fbc ?? '-'} fbp=${pub.fbp ?? '-'}`),
      marquerAdresseProuvee: (adresse) => noter(`prouvee ${adresse}`),
      signaler: (f) => noter(f.evenement === 'CompleteRegistration'
        ? `inscription ${f.adresse} ip=${f.ip ?? '-'} navigateur=${f.navigateur ?? '-'}`
        : `${f.evenement} ${f.tenantId}`),
    },
  };
}
