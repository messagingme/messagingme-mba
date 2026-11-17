import { describe, it, expect } from 'vitest';
import { lienGmail } from './ops-email';

describe('lienGmail', () => {
  it('ouvre la rédaction de Gmail sur le compte de l’exploitant, tous les membres en destinataires', () => {
    const lien = new URL(lienGmail('exploitant@exemple.fr', ['admin@client.fr', 'agent@client.fr'])!);
    expect(lien.origin + lien.pathname).toBe('https://mail.google.com/mail/');
    expect(lien.searchParams.get('authuser')).toBe('exploitant@exemple.fr');
    expect(lien.searchParams.get('view')).toBe('cm');
    expect(lien.searchParams.get('to')).toBe('admin@client.fr,agent@client.fr');
  });

  it('une adresse ne peut pas ajouter de paramètre à la fenêtre (cc, objet)', () => {
    const lien = new URL(lienGmail('exploitant@exemple.fr', ['a@client.fr&cc=intrus@x.fr'])!);
    expect(lien.searchParams.get('cc')).toBeNull();
    expect(lien.searchParams.get('to')).toBe('a@client.fr&cc=intrus@x.fr');
  });

  it('aucun lien sans destinataire, ni quand l’API ne les envoie pas encore', () => {
    expect(lienGmail('exploitant@exemple.fr', [])).toBeNull();
    expect(lienGmail('exploitant@exemple.fr', undefined)).toBeNull();
  });
});
