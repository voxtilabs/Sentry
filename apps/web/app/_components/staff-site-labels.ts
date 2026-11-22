import type { StaffCompany } from '@sentrycore/shared';

const words = (label: string) => label.match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu) ?? [];
const key = (label: string) => words(label.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()).join(' ');
const capitalize = (label: string) => label.charAt(0).toLocaleUpperCase('es') + label.slice(1);

export function staffCompanyLabel(company: StaffCompany): string {
  const companyKey = key(company.tenantName);
  const slugKey = key(company.tenantSlug);
  if (!companyKey || !slugKey.startsWith(`${companyKey} `)) return company.tenantName;

  // A branch whose name matches the company identifier supplies the qualifier
  // and its accents when the commercial name is shared by several companies.
  const branch = company.sites.find(site => key(site.branchName) === slugKey);
  if (!branch) return company.tenantName;
  const qualifier = words(branch.branchName).slice(words(company.tenantName).length).map(capitalize).join(' ');
  return `${company.tenantName} ${qualifier}`;
}

export function staffSiteLabel(companyName: string, siteName: string): string {
  const companyKey = key(companyName);
  const siteKey = key(siteName);
  if (siteKey === companyKey || companyKey.endsWith(` ${siteKey}`)) return companyName;
  const name = companyKey && siteKey.startsWith(`${companyKey} `)
    ? capitalize(words(siteName).slice(words(companyName).length).join(' '))
    : siteName;
  return `${companyName} · ${name}`;
}
