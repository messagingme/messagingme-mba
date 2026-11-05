import { describe, it, expect } from 'vitest';
import { reseauDuClient } from '../src/ops/tentatives';

/**
 * 🔴 LA CLÉ RÉSEAU D'UN PLAFOND (lot identité B). Une machine louée a couramment un /64 entier : par adresse IPv6, un
 * script en change à chaque requête et le plafond de l'inscription ne mord jamais. Le /64 est la plus petite unité
 * qu'un hébergeur attribue.
 */
const req = (ip?: string) => ({ ip: '10.0.0.1', headers: ip === undefined ? {} : { 'cf-connecting-ip': ip } });

describe('reseauDuClient', () => {
  it('🔴 toutes les adresses d’un même /64 donnent la même clé, quelle que soit leur écriture', () => {
    const cles = [
      '2001:db8:abcd:12:1:2:3:4',
      '2001:db8:abcd:12::1',
      '2001:0DB8:abcd:0012:ffff::9',
      '2001:db8:abcd:12:0:0:0:0',
    ].map((ip) => reseauDuClient(req(ip)));
    expect(new Set(cles)).toEqual(new Set(['2001:db8:abcd:12::/64']));
    expect(reseauDuClient(req('2001:db8:abcd:13::1'))).toBe('2001:db8:abcd:13::/64');
  });

  it('une IPv4, écrite telle quelle ou en IPv6, reste elle-même', () => {
    expect(reseauDuClient(req('203.0.113.7'))).toBe('203.0.113.7');
    expect(reseauDuClient(req('::ffff:198.51.100.4'))).toBe('198.51.100.4');
    expect(reseauDuClient(req('0:0:0:0:0:ffff:198.51.100.4'))).toBe('198.51.100.4');
  });

  it('les formes limites : ::1, une zone, un texte qui n’est pas une adresse, l’absence d’en-tête', () => {
    expect(reseauDuClient(req('::1'))).toBe('0:0:0:0::/64');
    expect(reseauDuClient(req('fe80::1%eth0'))).toBe('fe80:0:0:0::/64');
    expect(reseauDuClient(req('pas-une-ip'))).toBe('pas-une-ip');
    expect(reseauDuClient(req('1:2:3:4:5:6:7:8:9'))).toBe('1:2:3:4:5:6:7:8:9');
    expect(reseauDuClient(req())).toBe('10.0.0.1');
  });
});
