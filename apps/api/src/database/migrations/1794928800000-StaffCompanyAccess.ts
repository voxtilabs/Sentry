import type {MigrationInterface,QueryRunner} from 'typeorm';

/** Cross-company views expose only memberships owned by the authenticated actor. */
export class StaffCompanyAccess1794928800000 implements MigrationInterface {
 name='StaffCompanyAccess1794928800000';
 async up(q:QueryRunner):Promise<void>{
  await q.query(`CREATE FUNCTION staff_company_portfolio() RETURNS TABLE(tenant_id uuid,tenant_name text,tenant_slug text,role_key text,sites jsonb)
   LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
    SELECT t.id,t.display_name,t.slug,m.role_key,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'branchName',s.branch_name) ORDER BY s.branch_name,s.name)
       FROM public.sites s WHERE s.tenant_id=t.id AND s.is_active AND
       (m.role_key='ADMIN' OR EXISTS(SELECT 1 FROM public.supervisor_sites ss WHERE ss.tenant_id=t.id AND ss.site_id=s.id AND ss.supervisor_id=u.id))),'[]'::jsonb)
    FROM public.users u JOIN public.memberships m ON m.user_id=u.id JOIN public.tenants t ON t.id=m.tenant_id
    WHERE u.id=NULLIF(current_setting('app.user_id',true),'')::uuid AND u.is_active AND t.status='active' AND m.role_key IN('ADMIN','SUPERVISOR')
    ORDER BY t.display_name,t.id
   $$`);
  await q.query(`CREATE FUNCTION supervision_access_directory() RETURNS jsonb
   LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
   DECLARE actor uuid:=NULLIF(current_setting('app.user_id',true),'')::uuid; platform_actor boolean; company_ids uuid[]; result jsonb;
   BEGIN
    IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=actor AND is_active) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
    platform_actor:=EXISTS(SELECT 1 FROM public.platform_memberships WHERE user_id=actor AND role_key='SUPERADMIN');
    SELECT COALESCE(array_agg(t.id),'{}'::uuid[]) INTO company_ids FROM public.tenants t WHERE t.status='active' AND
      (platform_actor OR EXISTS(SELECT 1 FROM public.memberships m WHERE m.tenant_id=t.id AND m.user_id=actor AND m.role_key='ADMIN'));
    IF NOT platform_actor AND cardinality(company_ids)=0 THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
    SELECT jsonb_build_object('companies',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',t.id,'name',t.display_name,'sites',
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',s.id,'name',s.name) ORDER BY s.name) FROM public.sites s WHERE s.tenant_id=t.id AND s.is_active),'[]'::jsonb)) ORDER BY t.display_name)
      FROM public.tenants t WHERE t.id=ANY(company_ids)),'[]'::jsonb),
     'supervisors',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',u.id,'name',trim(u.given_name||' '||u.family_name),'email',u.email,
      'memberships',COALESCE((SELECT jsonb_agg(jsonb_build_object('tenantId',m.tenant_id,'siteIds',COALESCE((SELECT jsonb_agg(ss.site_id) FROM public.supervisor_sites ss
        WHERE ss.tenant_id=m.tenant_id AND ss.supervisor_id=u.id),'[]'::jsonb))) FROM public.memberships m WHERE m.user_id=u.id AND m.role_key='SUPERVISOR' AND m.tenant_id=ANY(company_ids)),'[]'::jsonb)) ORDER BY u.given_name,u.family_name)
      FROM public.users u WHERE u.is_active AND EXISTS(SELECT 1 FROM public.memberships m WHERE m.user_id=u.id AND m.role_key='SUPERVISOR' AND m.tenant_id=ANY(company_ids))),'[]'::jsonb)) INTO result;
    RETURN result;
   END $$`);
  await q.query(`CREATE FUNCTION set_supervision_access(target_tenant uuid,target_user uuid,target_sites uuid[]) RETURNS void
   LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
   DECLARE actor uuid:=NULLIF(current_setting('app.user_id',true),'')::uuid; platform_actor boolean; membership_role text; candidate boolean;
   BEGIN
    IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=actor AND is_active) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
    platform_actor:=EXISTS(SELECT 1 FROM public.platform_memberships WHERE user_id=actor AND role_key='SUPERADMIN');
    IF NOT EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=target_tenant AND t.status='active' AND (platform_actor OR EXISTS(
      SELECT 1 FROM public.memberships m WHERE m.tenant_id=t.id AND m.user_id=actor AND m.role_key='ADMIN'))) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
    SELECT EXISTS(SELECT 1 FROM public.users u JOIN public.memberships m ON m.user_id=u.id WHERE u.id=target_user AND u.is_active AND m.role_key='SUPERVISOR'
      AND (platform_actor OR EXISTS(SELECT 1 FROM public.memberships owner WHERE owner.tenant_id=m.tenant_id AND owner.user_id=actor AND owner.role_key='ADMIN'))) INTO candidate;
    IF NOT candidate THEN RAISE EXCEPTION 'Supervisor unavailable' USING ERRCODE='42501'; END IF;
    IF target_sites IS NULL OR EXISTS(SELECT 1 FROM unnest(target_sites) chosen WHERE NOT EXISTS(SELECT 1 FROM public.sites s WHERE s.id=chosen AND s.tenant_id=target_tenant AND s.is_active)) THEN
      RAISE EXCEPTION 'Invalid site selection' USING ERRCODE='22023'; END IF;
    PERFORM id FROM public.tenants WHERE id=target_tenant FOR UPDATE;
    INSERT INTO public.memberships(tenant_id,user_id,role_key) VALUES(target_tenant,target_user,'SUPERVISOR') ON CONFLICT(tenant_id,user_id) DO NOTHING;
    SELECT role_key INTO membership_role FROM public.memberships WHERE tenant_id=target_tenant AND user_id=target_user FOR UPDATE;
    IF membership_role<>'SUPERVISOR' THEN RAISE EXCEPTION 'Existing role must be managed separately' USING ERRCODE='22023'; END IF;
    DELETE FROM public.supervisor_sites WHERE tenant_id=target_tenant AND supervisor_id=target_user AND NOT(site_id=ANY(target_sites));
    INSERT INTO public.supervisor_sites(tenant_id,supervisor_id,site_id) SELECT target_tenant,target_user,chosen FROM unnest(target_sites) chosen ON CONFLICT DO NOTHING;
    INSERT INTO public.audit_log(tenant_id,actor_id,actor_label,action,entity_type,entity_id,summary)
     VALUES(target_tenant,actor,CASE WHEN platform_actor THEN 'SUPERADMIN' ELSE 'ADMIN' END,'supervisor.recintos_asignados','supervisor',target_user,
       'Asignación de supervisión actualizada: '||cardinality(target_sites)||' recintos seleccionados.');
   END $$`);
  for(const signature of ['staff_company_portfolio()','supervision_access_directory()','set_supervision_access(uuid,uuid,uuid[])']){
   await q.query(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC`);
   await q.query(`GRANT EXECUTE ON FUNCTION ${signature} TO sentrycore_app`);
  }
 }
 async down(q:QueryRunner):Promise<void>{for(const f of ['set_supervision_access(uuid,uuid,uuid[])','supervision_access_directory()','staff_company_portfolio()'])await q.query(`DROP FUNCTION ${f}`);}
}
