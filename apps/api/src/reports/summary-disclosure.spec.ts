import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pdfOperands } from './pdf-text.testing';
import sharp from 'sharp';
import { ConfigService } from '@nestjs/config';
import { patrolRulesSchema } from '@sentrycore/shared';
import type { TenantContextService } from '../database/tenant-context/tenant-context.service';
import type { RulesService } from '../rules/rules.service';
import type { BrandingService } from '../branding/branding.service';
import type { FeatureFlagsService } from '../rules/feature-flags.service';
import { ReportsService, SummaryPdfSizeError } from './reports.service';

const SECRET='QZXSECRETPERSON';
function fixture(root:string,photos:boolean) {
 const query=jest.fn().mockResolvedValueOnce([{tenant_name:'Empresa',site_name:'Recinto',branch_name:'Sucursal',timezone:'America/Santiago'}])
  .mockResolvedValueOnce([{id:'round',status:'completada',scheduled_start_at:new Date('2026-11-15T12:00Z'),closed_at:new Date('2026-11-15T13:00Z'),compliance_pct:'100',route_name:'Ruta',guard_name:SECRET}])
  .mockResolvedValueOnce([]).mockResolvedValueOnce([]);
 if(photos)query.mockResolvedValueOnce([{id:'photo',storage_path:'photo.jpg',mime_type:'image/jpeg',checkpoint_name:'Punto',scheduled_start_at:new Date('2026-11-15T12:00Z'),guard_name:SECRET}]);
 const service=new ReportsService({manager:{query}} as unknown as TenantContextService,
  {effective:async()=>patrolRulesSchema.parse({})} as unknown as RulesService,
  {forDocuments:async()=>({displayName:'Empresa',primaryColor:'#333333',logoUri:null,mailFooter:null})} as unknown as BrandingService,
  new ConfigService({EVIDENCE_PATH:root}),{isEnabled:async()=>true} as unknown as FeatureFlagsService);
 return {service,query};
}
describe('summary disclosure in real generated PDFs',()=>{
 let root:string;
 beforeAll(async()=>{root=await mkdtemp(join(tmpdir(),'disclosure471-'));await writeFile(join(root,'photo.jpg'),await sharp({create:{width:600,height:400,channels:3,background:'#497faa'}}).jpeg().toBuffer());});
 afterAll(async()=>rm(root,{recursive:true,force:true}));
 it.each([[false,false],[false,true],[true,false],[true,true]])('photos %s and names %s are independent, including photo captions',async(photos,names)=>{
  const {service,query}=fixture(root,photos);const report=await service.buildSiteSummary('site','2026-11-01T03:00Z','2026-12-01T03:00Z',null,photos,names);
  expect(report.pdf.toString('latin1').includes('/Subtype /Image')).toBe(photos);
  expect(pdfOperands(report.pdf).includes(SECRET)).toBe(names);
  if(!names){const sqls=query.mock.calls.map(call=>String(call[0]));expect(sqls.some(sql=>sql.includes('u.given_name'))).toBe(false);}
 });
 it('stops a PDF that exceeds its email byte budget',async()=>{
  const {service}=fixture(root,true);await expect(service.buildSiteSummary('site','2026-11-01T03:00Z','2026-12-01T03:00Z',null,true,false,200)).rejects.toBeInstanceOf(SummaryPdfSizeError);
 });
});
