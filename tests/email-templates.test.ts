import { describe, it, expect } from 'vitest';
import { renderBrandedEmail, renderInvitationEmail } from '../src/support/email-templates';
import { escapeHtml } from '../src/crm/render';

describe('escapeHtml', () => {
  it('échappe les caractères dangereux', () => {
    expect(escapeHtml('<b>A & B "x" \'y\'</b>')).toBe('&lt;b&gt;A &amp; B &quot;x&quot; &#39;y&#39;&lt;/b&gt;');
  });
});

describe('renderBrandedEmail (shell réutilisable)', () => {
  const html = renderBrandedEmail({
    title: 'Un titre',
    bodyHtml: '<p>Corps</p>',
    ctaLabel: 'Agir maintenant',
    ctaUrl: 'https://mba.messagingme.app/x/TOK',
  });

  it('rend un document HTML complet avec le CTA et son URL', () => {
    expect(html).toContain('<!DOCTYPE html');
    expect(html).toContain('Agir maintenant');
    expect(html).toContain('https://mba.messagingme.app/x/TOK');
    // Bouton construit en table (pas de <button>).
    expect(html).not.toContain('<button');
  });

  it('🔴 son logo est servi par la console, jamais par mba. (supprimé au lot 7 de la bascule)', () => {
    expect(html).toContain('src="https://console.messagingme.app/logo.png"');
    expect(html).not.toContain('mba.messagingme.app/logo');
  });

  it('porte l\'identité de marque (wordmark + tagline)', () => {
    expect(html).toContain('Messaging Me');
    expect(html).toContain('Business Agent');
    // Les 3 couleurs de la marque (barre d'accent) sont présentes.
    expect(html).toContain('#181C40');
    expect(html).toContain('#009AFE');
    expect(html).toContain('#17C74E');
  });

  it('n\'écrit JAMAIS « UChat »', () => {
    expect(html.toLowerCase()).not.toContain('uchat');
  });

  it('échappe le titre et l\'URL du CTA (données non fiables)', () => {
    const evil = renderBrandedEmail({
      title: '<script>alert(1)</script>',
      bodyHtml: '<p>ok</p>',
      ctaLabel: 'Go',
      ctaUrl: 'https://x.test/"><img>',
    });
    expect(evil).not.toContain('<script>alert(1)</script>');
    expect(evil).toContain('&lt;script&gt;');
    expect(evil).toContain('https://x.test/&quot;&gt;&lt;img&gt;');
  });
});

describe('renderInvitationEmail', () => {
  const acceptUrl = 'https://mba.messagingme.app/invite/INVITE_RAW';

  it('personnalise avec le nom ET l\'adresse de l\'invitant, l\'espace et le lien de l\'invitation, au vouvoiement', () => {
    const html = renderInvitationEmail({ inviterName: 'Julien', inviterEmail: 'julien@exemple.fr', workspaceName: 'Acme Corp', acceptUrl, role: 'agent' });
    // Lot identité C : un nom se choisit librement, l'adresse montrée à côté fait voir une usurpation.
    expect(html).toContain('Julien (julien@exemple.fr)</strong> vous invite');
    expect(html).toContain('Acme Corp');
    expect(html).toContain(acceptUrl);
    // Rôle traduit dans le corps.
    expect(html).toContain('agent');
    // Jamais « UChat ».
    expect(html.toLowerCase()).not.toContain('uchat');
    // C'est bien le shell brandé, avec un appel neutre : la page demande, selon l'adresse, un mot de passe ou Google.
    expect(html).toContain('Rejoindre l’espace');
    expect(html).not.toMatch(/\bt['’]invite\b|\bTu\b|\bton mot de passe\b|\bRejoins\b/);
  });

  it('l\'adresse seule quand l\'invitant n\'a pas de nom', () => {
    const html = renderInvitationEmail({ inviterName: null, inviterEmail: 'boss@exemple.fr', workspaceName: 'Acme', acceptUrl, role: 'agent' });
    expect(html).toContain('<strong>boss@exemple.fr</strong> vous invite');
  });

  it('traduit le rôle admin', () => {
    const html = renderInvitationEmail({ inviterName: 'Boss', workspaceName: 'Acme', acceptUrl, role: 'admin' });
    expect(html).toContain('administrateur');
  });

  it('retombe sur une formulation générique sans nom d\'invitant ni d\'espace', () => {
    const html = renderInvitationEmail({ inviterName: null, workspaceName: null, acceptUrl, role: 'agent' });
    expect(html).toContain(acceptUrl);
    expect(html).toContain('un espace de travail');
    expect(html).toContain('Rejoindre l’espace');
  });

  it('échappe un nom d\'invitant/espace malveillant (pas d\'injection de markup)', () => {
    const html = renderInvitationEmail({
      inviterName: '<img src=x onerror=alert(1)>',
      workspaceName: 'A & B <script>',
      acceptUrl,
      role: 'agent',
    });
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;img src=x');
    expect(html).toContain('A &amp; B');
  });
});
