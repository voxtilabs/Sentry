import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { LoginScreen } from './login-screen';

// Comprueba lo que recibe el guardia antes de hidratar el WebView: evita un
// destello del formulario de contraseña y regresiones hacia el código personal.
describe('acceso por código de empresa en la app', () => {
  it('la app abre directamente con un único código de 10 caracteres', () => {
    const html = renderToStaticMarkup(createElement(LoginScreen, { initialCompanyLogin: true }));
    expect(html).toContain('name="companyCode"');
    expect(html).toContain('maxLength="10"');
    expect(html).toContain('autoCapitalize="characters"');
    expect(html).not.toContain('name="identity"');
    expect(html).not.toContain('name="password"');
    expect(html).not.toContain('name="tenantSlug"');
    expect(html).toContain('Después elige tu nombre en la lista de guardias.');
  });
  it('mantiene la tarjeta opcional y el acceso de supervisores visible', () => {
    const html = renderToStaticMarkup(createElement(LoginScreen, { initialCompanyLogin: true }));
    expect(html).toContain('tarjeta NFC de la empresa');
    expect(html).toContain('Acceso de supervisores y administración');
    expect(html).toContain('Ayuda y reportes');
  });
  it('el panel web conserva usuario y contraseña para los roles de gestión', () => {
    const html = renderToStaticMarkup(createElement(LoginScreen, { initialCompanyLogin: false }));
    expect(html).toContain('name="identity"');
    expect(html).toContain('name="password"');
    expect(html).not.toContain('name="companyCode"');
  });
});
