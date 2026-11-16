import type { MigrationInterface,QueryRunner } from 'typeorm';
/** Database authorization mirrors the site-scoped registration endpoint. */
export class SiteGuardRegistration1794787201000 implements MigrationInterface{
 name='SiteGuardRegistration1794787201000';
 async up(q:QueryRunner):Promise<void>{
  await q.query(`CREATE FUNCTION guard_register_in_site(new_user_id uuid,new_username citext,new_password_hash text,new_given_name text,new_family_name text,target_site_id uuid)
   RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
   DECLARE tenant uuid:=public.app_tenant_id(); actor uuid:=public.app_user_id();
   BEGIN
    IF tenant IS NULL OR actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.sites s WHERE s.id=target_site_id AND s.tenant_id=tenant AND s.is_active)
     OR NOT EXISTS(SELECT 1 FROM public.memberships m JOIN public.users u ON u.id=m.user_id WHERE m.tenant_id=tenant AND m.user_id=actor AND u.is_active AND
      (m.role_key='ADMIN' OR (m.role_key='SUPERVISOR' AND EXISTS(SELECT 1 FROM public.supervisor_sites ss WHERE ss.tenant_id=tenant AND ss.supervisor_id=actor AND ss.site_id=target_site_id)))) THEN
      RAISE EXCEPTION 'guard registration access denied' USING ERRCODE='42501';
    END IF;
    INSERT INTO public.users(id,username,password_hash,given_name,family_name) VALUES(new_user_id,new_username,new_password_hash,new_given_name,new_family_name);
    INSERT INTO public.memberships(tenant_id,user_id,role_key) VALUES(tenant,new_user_id,'GUARDIA');
    INSERT INTO public.guard_sites(tenant_id,guard_id,site_id) VALUES(tenant,new_user_id,target_site_id);
    RETURN new_user_id;
   END $$`);
  await q.query('REVOKE ALL ON FUNCTION guard_register_in_site(uuid,citext,text,text,text,uuid) FROM PUBLIC');
  await q.query('GRANT EXECUTE ON FUNCTION guard_register_in_site(uuid,citext,text,text,text,uuid) TO sentrycore_app');
 }
 async down(q:QueryRunner):Promise<void>{await q.query('DROP FUNCTION guard_register_in_site(uuid,citext,text,text,text,uuid)');}
}
