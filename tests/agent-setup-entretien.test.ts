import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  bornerPourModele, lireEtat, MAX_BASCULES, MAX_TOURS_CONSERVES,
} from '../src/agent/setup/entretien-store';
import { MAX_TOURS_HISTORIQUE } from '../src/agent/setup/conversation';

/**
 * 🔴 LE FIL PERDURE : CE QU'ON CONSERVE N'EST PLUS CE QU'ON ENVOIE (2026-09-14).
 *
 * La borne était posée à l'ÉCRITURE (`PgEntretienStore.ecrire` appelait `bornerMessages`), donc les tours
 * anciens n'étaient pas seulement absents du contexte du modèle : ils étaient DÉTRUITS. Sa documentation
 * l'assumait (« un entretien long ne perd rien de ce qui compte, seulement sa transcription ancienne »), ce
 * qui était vrai d'un entretien qui se TERMINE et faux d'un fil qui perdure, où la transcription ancienne
 * est justement ce qu'on vient relire des semaines plus tard.
 */
describe('le fil conserve tout, le prompt reste borné', () => {
  const fil = (n: number) => Array.from({ length: n }, (_, i) => ({
    role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant', content: `tour ${i}`,
  }));

  it('🔴 la relecture ne TRONQUE plus un fil plus long que le contexte', () => {
    // Avant, `etatSchema` plafonnait `messages` à `MAX_TOURS_HISTORIQUE * 2` : un fil conservé au-delà
    // retombait sur l'entretien vierge à la relecture, c'est-à-dire que le client perdait sa conversation.
    const long = fil(MAX_TOURS_HISTORIQUE * 2 + 40);
    const relu = lireEtat({ messages: long, reponses: [], poses: [], bascules: [] });
    expect(relu.messages).toHaveLength(long.length);
    expect(relu.messages[0]?.content).toBe('tour 0');
  });

  it('⚠️ mais ce qui PART au modèle reste borné', () => {
    expect(bornerPourModele(fil(MAX_TOURS_HISTORIQUE * 2 + 40))).toHaveLength(MAX_TOURS_HISTORIQUE * 2);
  });

  it('⚠️ et ce sont les DERNIERS tours qui partent, pas les premiers', () => {
    const borne = bornerPourModele(fil(MAX_TOURS_HISTORIQUE * 2 + 3));
    expect(borne[borne.length - 1]?.content).toBe(`tour ${MAX_TOURS_HISTORIQUE * 2 + 2}`);
  });

  it('⚠️ un plafond de sécurité demeure : un jsonb ne grossit pas sans fin, et le dépasser ne coûte que l’ancien', () => {
    const enorme = fil(MAX_TOURS_CONSERVES + 10);
    // Au-delà, on garde les DERNIERS tours : le tour suivant réécrit le fil ramené, le jsonb ne grossit donc plus.
    // Avant le 2026-11-23, le dépasser faisait retomber sur l'entretien vierge, donc perdre toute la conversation.
    const relu = lireEtat({ messages: enorme }).messages;
    expect(relu).toHaveLength(MAX_TOURS_CONSERVES);
    expect(relu.at(-1)?.content).toBe(`tour ${MAX_TOURS_CONSERVES + 9}`);
  });
});

/**
 * 🔴 UNE BORNE DÉPASSÉE NE COÛTE PLUS TOUT LE FIL (2026-11-23).
 *
 * La relecture refusait l'état entier dès qu'UNE valeur dépassait sa borne, et rendait l'entretien vierge : l'écran se
 * vidait, et le tour suivant écrasait le fil en base. Or le serveur écrit lui-même des valeurs au-delà : la réponse de
 * l'assistant (jusqu'à 4 000 caractères) reçoit encore la relance, l'annonce d'import et le bloc de fin, et la liste
 * des moments n'était plafonnée qu'à la relecture.
 */
describe('une borne dépassée se ramène, le fil reste', () => {
  const tours = [
    { role: 'user' as const, content: 'il répond aux questions sur mon offre' },
    { role: 'assistant' as const, content: 'x'.repeat(5_000) },
  ];

  it('🔴 une réponse de l’assistant plus longue que la borne d’un message client se relit entière', () => {
    const relu = lireEtat({ messages: tours, reponses: [], poses: [], bascules: [] });
    expect(relu.messages).toHaveLength(2);
    expect(relu.messages[1]!.content).toHaveLength(5_000);
  });

  it('🔴 trop de moments : les premiers sont gardés, et la conversation avec', () => {
    const moments = Array.from({ length: MAX_BASCULES + 3 }, (_, i) => ({ moment: `moment ${i}` }));
    const relu = lireEtat({ messages: tours, reponses: [], poses: [], bascules: moments });
    expect(relu.bascules.map((b) => b.moment)).toEqual(moments.slice(0, MAX_BASCULES).map((b) => b.moment));
    expect(relu.messages).toHaveLength(2);
  });

  it('une valeur trop longue est ramenée, une action inconnue oubliée, une adresse hors borne aussi', () => {
    const relu = lireEtat({
      messages: tours,
      reponses: [{ point: 'mission', valeur: 'v'.repeat(3_000) }],
      poses: ['mission'],
      bascules: [{ moment: 'le client veut un conseiller', action: 'teleporter' }],
      connaissanceUrl: `https://exemple.fr/${'p'.repeat(2_100)}`,
    });
    expect(relu.messages).toHaveLength(2);
    expect(relu.reponses[0]!.valeur).toHaveLength(2_000);
    expect(relu.bascules).toEqual([{ moment: 'le client veut un conseiller' }]);
    expect(relu.connaissanceUrl).toBeUndefined();
  });
});

/**
 * 🔴 CE QUE LA REVUE DU LOT A A TROUVÉ, ET QUI ANNULAIT LA TÂCHE ENTIÈRE.
 *
 * La route construisait l'état ÉCRIT à partir du fil BORNÉ (`historique`), pas du fil complet : la
 * troncature était donc seulement DÉPLACÉE de l'écriture vers la construction du prompt, jamais supprimée.
 * La base recevait un fil amputé à chaque tour, et « le fil perdure » était faux.
 *
 * ⚠️ NI LE COMPILATEUR NI UN TEST NE POUVAIENT LE VOIR : les deux tableaux ont exactement le même type, et
 * un test qui monte un faux store voit ce que le faux lui rend. Seule une relecture qui SUIT la donnée l'a vu.
 */
describe('le fil ÉCRIT n’est pas le fil ENVOYÉ', () => {
  it('🔴 le tour écrit le fil COMPLET, pas sa version bornée', () => {
    const src = readFileSync(resolve(__dirname, '../src/agent/setup/tour-entretien.ts'), 'utf8');
    // Le fil complet part de `avant.messages`, jamais de `bornerPourModele(...)`.
    expect(src).toContain('const filComplet: TourEntretien[] = [...avant.messages');
    // Et c'est LUI que l'état écrit reprend.
    expect(src).toContain('messages: [...filComplet');
    // ⚠️ La garde qui compte : l'état écrit ne doit JAMAIS repartir de `historique`.
    expect(src).not.toContain('messages: [...historique');
  });

  it('🔴 l’écran ne reçoit pas le fil entier : une réponse HTTP ne grossit pas sans fin', () => {
    const src = readFileSync(resolve(__dirname, '../src/http/agent-setup.ts'), 'utf8');
    expect(src).toContain('MAX_MESSAGES_AFFICHES');
    // Le total part avec, sinon l'écran laisserait croire que le reste n'existe plus.
    expect(src).toContain('total: entretien.messages.length');
  });

  it('🔴 l’auteur de chaque message est CONSERVÉ, pas seulement déclaré', () => {
    const store = readFileSync(resolve(__dirname, '../src/agent/setup/entretien-store.pg.ts'), 'utf8');
    // Une colonne ajoutée que personne n'écrit ni ne lit est une capacité câblée sur zéro consommateur.
    expect(store).toContain('auteurs = excluded.auteurs');
    expect(store).toMatch(/select messages, reponses, poses, bascules, auteurs/);
  });

  it('⚠️ un fil d’avant la migration se relit sans auteurs, et n’en invente pas', () => {
    const relu = lireEtat({ messages: [{ role: 'user', content: 'x' }], reponses: [], poses: [], bascules: [] });
    expect(relu.auteurs).toEqual([]);
  });
});
