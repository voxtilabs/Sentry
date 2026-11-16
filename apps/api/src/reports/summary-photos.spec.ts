import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { ConfigService } from '@nestjs/config';
import { patrolRulesSchema } from '@sentrycore/shared';
import type { TenantContextService } from '../database/tenant-context/tenant-context.service';
import type { RulesService } from '../rules/rules.service';
import type { BrandingService } from '../branding/branding.service';
import type { FeatureFlagsService } from '../rules/feature-flags.service';
import { ReportsService } from './reports.service';
describe('resumen con fotos',()=>{
 it('incluye evidencia comprimida en el PDF del período y conserva el archivo original',async()=>{
  const root=await mkdtemp(join(tmpdir(),'summary460-'));
  try{
   const original=await sharp({create:{width:640,height:480,channels:3,background:'#497faa'}}).jpeg().toBuffer();await writeFile(join(root,'photo.jpg'),original);
   const query=jest.fn().mockResolvedValueOnce([{tenant_name:'Empresa',site_name:'Recinto',branch_name:'Sucursal',timezone:'America/Santiago'}]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{id:'photo',storage_path:'photo.jpg',mime_type:'image/jpeg',checkpoint_name:'Punto de prueba',scheduled_start_at:new Date(),guard_name:'Guardia de prueba'}]);
   const service=new ReportsService({manager:{query}} as unknown as TenantContextService,{effective:async()=>patrolRulesSchema.parse({})} as unknown as RulesService,{forDocuments:async()=>({displayName:'Empresa',primaryColor:'#333333',logoUri:null,mailFooter:null})} as unknown as BrandingService,new ConfigService({EVIDENCE_PATH:root}),{isEnabled:async()=>true} as unknown as FeatureFlagsService);
   const report=await service.buildSiteSummary('site',undefined,undefined,null,true);expect(report.pdf.toString('latin1')).toContain('/Subtype /Image');expect(report.pdf.length).toBeLessThan(100000);
   const {readFile}=await import('node:fs/promises');expect(await readFile(join(root,'photo.jpg'))).toEqual(original);
  }finally{await rm(root,{recursive:true,force:true});}
 });
});
