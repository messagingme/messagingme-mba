import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

/**
 * 🔴 OÙ PART UN SECRET, SOUS LES YEUX DE CELUI QUI LE COLLE (lot 1 du CSM virtuel, B10, livraison 4a). Un système déclaré
 * depuis Claude a une adresse que personne n'a encore vue : la page Connecteurs API montre, sous le champ du secret,
 * l'adresse vers laquelle il partira (l'adresse du jeton pour un mot de passe OAuth, l'adresse de base sinon). Sans cette
 * ligne, une consigne glissée dans une conversation lue par Claude pourrait choisir où part le mot de passe.
 */
describe('la page Connecteurs API montre où part le secret', () => {
  it('🔴 la ligne de destination suit le champ du secret : l’adresse du jeton en OAuth, l’adresse de base sinon', () => {
    const page = readFileSync('web/components/ConnecteursBibliotheque.tsx', 'utf8');
    const champ = page.indexOf('data-testid={`source-secret-${source.id}`}');
    const destination = page.indexOf('data-testid={`source-secret-destination-${source.id}`}');
    expect(champ).toBeGreaterThan(-1);
    expect(destination).toBeGreaterThan(champ);
    const ligne = page.slice(destination, page.indexOf('</p>', destination));
    expect(ligne).toContain('source.oauth?.tokenUrl');
    expect(ligne).toContain('source.baseUrl');
  });
});
