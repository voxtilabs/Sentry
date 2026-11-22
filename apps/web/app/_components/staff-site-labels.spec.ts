import type { StaffCompany } from '@sentrycore/shared';
import { staffCompanyLabel, staffSiteLabel } from './staff-site-labels';

describe('nombres del selector web de supervisión', () => {
  it('usa un nombre por recinto de Janssen con los datos que llegan de la cartera', () => {
    const companies: StaffCompany[] = [
      { tenantId: 'conchali', tenantName: 'Janssen', tenantSlug: 'janssen-conchali', role: 'SUPERVISOR', sites: [
        { id: 'edificio', name: 'Edificio', branchName: 'Janssen edificio' },
        { id: 'maquinaria', name: 'Janssen conchalí maquinaria', branchName: 'Janssen conchalí' },
      ] },
      { tenantId: 'bernardo', tenantName: 'Janssen San Bernardo', tenantSlug: 'janssen-san-bernardo', role: 'SUPERVISOR', sites: [
        { id: 'san-bernardo', name: 'SAN BERNARDO', branchName: 'SAN BERNARDO' },
      ] },
      { tenantId: 'antofagasta', tenantName: 'Janssen Antofagasta', tenantSlug: 'janssen-antofagasta', role: 'SUPERVISOR', sites: [
        { id: 'anf-pac', name: 'ANF PAC', branchName: 'ANF PAC' },
      ] },
    ];

    expect(companies.flatMap(company => company.sites.map(site => staffSiteLabel(staffCompanyLabel(company), site.name))))
      .toEqual(['Janssen Conchalí · Edificio', 'Janssen Conchalí · Maquinaria', 'Janssen San Bernardo', 'Janssen Antofagasta · ANF PAC']);
  });

  it('conserva el nombre de un recinto cuya sucursal no identifica a la empresa', () => {
    const site = { id: 'alfa', name: 'Bodega Alfa', branchName: 'Centro' };
    const company = { tenantId: 'logistica', tenantName: 'Logística', tenantSlug: 'logistica-norte', role: 'SUPERVISOR', sites: [site] } as const;
    expect(staffSiteLabel(staffCompanyLabel({ ...company, sites: [site] }), site.name)).toBe('Logística · Bodega Alfa');
  });
});
