'use client';

import { CoordinateMap } from './coordinate-map';
import type { TenantSite } from './role-management';

/** Catalog locations, separate from the checkpoint editor's evidence map. */
export function SiteLocationMap({ sites, tileUrl, attribution }: {
  sites: TenantSite[]; tileUrl: string | null; attribution: string;
}) {
  const located = sites.filter((site): site is TenantSite & { latitude: number; longitude: number } =>
    site.latitude !== null && site.longitude !== null);
  const first = located[0];
  if (!first) return null;
  return <aside className="site-catalog-map" aria-label="Ubicaciones de los recintos">
    <h3>Ubicaciones de referencia</h3>
    <CoordinateMap latitude={first.latitude} longitude={first.longitude}
      tileUrl={tileUrl} attribution={attribution}
      markers={located.map(site => ({ id: site.id, label: site.name, latitude: site.latitude, longitude: site.longitude }))} />
  </aside>;
}
