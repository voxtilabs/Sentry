import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { DataSource } from 'typeorm';

/** Comprueba el rol REAL al arrancar, incluso si se cambió DATABASE_URL después del init. */
@Injectable()
export class RuntimeDatabaseSecurity implements OnApplicationBootstrap {
  constructor(private readonly source: DataSource) {}

  async onApplicationBootstrap(): Promise<void> {
    const roles = await this.source.query<Array<{ unsafe: boolean }>>(`
      SELECT (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb
        OR has_schema_privilege(current_user, 'public', 'CREATE')) AS unsafe
      FROM pg_roles WHERE rolname = current_user`);
    if (roles.length !== 1 || roles[0]?.unsafe !== false) {
      throw new Error('La API requiere un rol PostgreSQL restringido, sin privilegios administrativos ni BYPASSRLS');
    }
    const tables = await this.source.query<Array<{ relname: string }>>(`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid
          AND a.attname='tenant_id' AND NOT a.attisdropped)
        AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)`);
    if (tables.length) throw new Error('Una tabla de empresa no tiene RLS habilitado y forzado');
  }
}
