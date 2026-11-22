import type { MigrationInterface, QueryRunner } from 'typeorm';

const signatures = [
  'platform_company_groups()',
  'save_company_group(uuid,text,uuid[])',
  'assign_company_group_sites(uuid,uuid,boolean,uuid[])',
  'staff_company_groups()',
];

export class CompanyGroups1795284000000 implements MigrationInterface {
  name = 'CompanyGroups1795284000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE company_groups (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 2 AND 100),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE UNIQUE INDEX company_groups_name_idx ON company_groups (lower(name));
      CREATE TABLE company_group_tenants (
        tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
        group_id uuid NOT NULL REFERENCES company_groups(id) ON DELETE RESTRICT
      );
      CREATE INDEX company_group_tenants_group_idx ON company_group_tenants (group_id);
    `);
    // Platform metadata is exposed exclusively through actor-bound functions.
    for (const table of ['company_groups', 'company_group_tenants']) {
      await q.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
        ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
        CREATE POLICY ${table}_internal ON ${table} USING (current_user <> 'sentrycore_app');
        REVOKE ALL ON ${table} FROM PUBLIC, sentrycore_app;`);
    }
    await q.query(`
      CREATE FUNCTION platform_company_groups() RETURNS jsonb
      LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
      BEGIN
        PERFORM public.assert_platform_superadmin(public.app_user_id());
        RETURN public.supervision_access_directory() || jsonb_build_object(
          'groups', (SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id', g.id, 'name', g.name, 'companyIds',
            ARRAY(SELECT m.tenant_id FROM public.company_group_tenants m WHERE m.group_id=g.id ORDER BY m.tenant_id)
          ) ORDER BY g.name), '[]'::jsonb) FROM public.company_groups g),
          'organizations', (SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id', t.id, 'name', t.display_name, 'slug', t.slug, 'status', t.status
          ) ORDER BY t.display_name, t.slug), '[]'::jsonb) FROM public.tenants t)
        );
      END $$;

      CREATE FUNCTION save_company_group(target uuid, group_name text, companies uuid[]) RETURNS uuid
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
      DECLARE actor uuid := public.app_user_id(); group_key uuid := target; prior uuid[];
      BEGIN
        PERFORM public.assert_platform_superadmin(actor);
        IF companies IS NULL OR cardinality(companies)>50 OR EXISTS (
          SELECT 1 FROM unnest(companies) selected(id)
          WHERE NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id=selected.id)
        ) THEN RAISE EXCEPTION 'invalid group companies' USING ERRCODE='22023'; END IF;

        IF group_key IS NULL THEN
          INSERT INTO public.company_groups(name) VALUES (trim(group_name)) RETURNING id INTO group_key;
        ELSE
          UPDATE public.company_groups SET name=trim(group_name) WHERE id=group_key;
          IF NOT FOUND THEN RAISE EXCEPTION 'group unavailable' USING ERRCODE='P0002'; END IF;
        END IF;

        SELECT array_agg(m.tenant_id) INTO prior FROM public.company_group_tenants m WHERE m.group_id=group_key;
        DELETE FROM public.company_group_tenants m WHERE m.group_id=group_key AND NOT (m.tenant_id=ANY(companies));
        INSERT INTO public.company_group_tenants(tenant_id,group_id)
          SELECT DISTINCT id,group_key FROM unnest(companies) selected(id)
          WHERE NOT EXISTS(SELECT 1 FROM public.company_group_tenants m WHERE m.tenant_id=selected.id AND m.group_id=group_key)
          ORDER BY id;

        INSERT INTO public.audit_log(tenant_id,actor_id,actor_label,action,entity_type,entity_id,summary)
          SELECT DISTINCT tenant,actor,'SUPERADMIN','empresa.grupo_actualizado','grupo_empresarial',group_key,
            'Configuración del grupo empresarial actualizada.'
          FROM unnest(coalesce(prior,'{}'::uuid[]) || companies) affected(tenant);
        RETURN group_key;
      END $$;

      CREATE FUNCTION assign_company_group_sites(target_group uuid, target_user uuid, all_sites boolean, selected_sites uuid[])
      RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
      DECLARE actor uuid := public.app_user_id(); member record; wanted_sites uuid[];
      BEGIN
        PERFORM public.assert_platform_superadmin(actor);
        PERFORM id FROM public.company_groups WHERE id=target_group FOR UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'group unavailable' USING ERRCODE='P0002'; END IF;
        IF NOT EXISTS (
          SELECT 1 FROM public.users u JOIN public.memberships m ON m.user_id=u.id
          WHERE u.id=target_user AND u.is_active AND m.role_key='SUPERVISOR'
        ) THEN RAISE EXCEPTION 'supervisor unavailable' USING ERRCODE='P0002'; END IF;
        IF all_sites IS NULL OR selected_sites IS NULL OR EXISTS (
          SELECT 1 FROM unnest(selected_sites) selected(id) WHERE NOT EXISTS (
            SELECT 1 FROM public.sites s
            JOIN public.company_group_tenants g ON g.tenant_id=s.tenant_id
            JOIN public.tenants t ON t.id=s.tenant_id AND t.status='active'
            WHERE s.id=selected.id AND g.group_id=target_group AND s.is_active
          )
        ) THEN RAISE EXCEPTION 'invalid group sites' USING ERRCODE='22023'; END IF;

        FOR member IN
          SELECT g.tenant_id, m.role_key FROM public.company_group_tenants g
          JOIN public.tenants t ON t.id=g.tenant_id AND t.status='active'
          LEFT JOIN public.memberships m ON m.tenant_id=g.tenant_id AND m.user_id=target_user
          WHERE g.group_id=target_group ORDER BY g.tenant_id
        LOOP
          -- Administration already grants this company's sites independently.
          CONTINUE WHEN member.role_key='ADMIN';
          SELECT coalesce(array_agg(s.id ORDER BY s.id), '{}'::uuid[]) INTO wanted_sites
          FROM public.sites s WHERE s.tenant_id=member.tenant_id AND s.is_active
            AND (all_sites OR s.id=ANY(selected_sites));
          IF member.role_key='SUPERVISOR' OR cardinality(wanted_sites)>0 THEN
            PERFORM public.set_supervision_access(member.tenant_id, target_user, wanted_sites);
          END IF;
        END LOOP;
      END $$;

      CREATE FUNCTION staff_company_groups() RETURNS TABLE(id uuid,name text,company_ids uuid[])
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
        SELECT g.id,g.name,array_agg(m.tenant_id ORDER BY m.tenant_id)
        FROM public.staff_company_portfolio() allowed
        JOIN public.company_group_tenants m ON m.tenant_id=allowed.tenant_id
        JOIN public.company_groups g ON g.id=m.group_id
        WHERE jsonb_array_length(allowed.sites)>0
        GROUP BY g.id,g.name ORDER BY g.name,g.id
      $$;
    `);
    for (const signature of signatures) {
      await q.query(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC;
        GRANT EXECUTE ON FUNCTION ${signature} TO sentrycore_app;`);
    }
  }

  async down(q: QueryRunner): Promise<void> {
    for (const signature of signatures.toReversed()) {
      await q.query(`DROP FUNCTION ${signature}`);
    }
    await q.query('DROP TABLE company_group_tenants; DROP TABLE company_groups');
  }
}
