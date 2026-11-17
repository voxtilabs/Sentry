import { ConfigService } from '@nestjs/config';
import { DigestAttachmentsService, type DigestDetail } from './digest-attachments.service';
import { ReportsService, SummaryPdfSizeError, SummaryPhotoLimitError } from './reports.service';
const from=new Date('2026-10-01T03:00Z'),to=new Date('2026-11-01T03:00Z');
const site:DigestDetail={siteId:'site',name:'Recinto',photos:true,guardNames:false,maxBytes:8192};
function fixture(){const report={buildSiteSummary:jest.fn().mockResolvedValue({filename:'detail.pdf',pdf:Buffer.from('%PDF-test')})};
 return {report,service:new DigestAttachmentsService(report as unknown as ReportsService,new ConfigService({WEB_PUBLIC_URL:'https://panel.example.test'}))};}
describe('optional digest attachments',()=>{
 it('does not read evidence or names with both checks off',async()=>{const {report,service}=fixture();expect(await service.prepare([{...site,photos:false}],from,to,new Map())).toEqual({attachments:[],notes:[]});expect(report.buildSiteSummary).not.toHaveBeenCalled();});
 it('passes independent names/photos flags and reuses the selected PDF across recipients',async()=>{const {report,service}=fixture(),cache=new Map();const a=await service.prepare([site],from,to,cache);await service.prepare([site],from,to,cache);expect(a.attachments).toHaveLength(1);expect(report.buildSiteSummary).toHaveBeenCalledTimes(1);expect(report.buildSiteSummary).toHaveBeenCalledWith('site',from.toISOString(),to.toISOString(),null,true,false,8192);
  await service.prepare([{...site,photos:false,guardNames:true}],from,to,cache);expect(report.buildSiteSummary).toHaveBeenCalledTimes(2);expect(report.buildSiteSummary).toHaveBeenLastCalledWith('site',from.toISOString(),to.toISOString(),null,false,true,8192);});
 it.each([new SummaryPdfSizeError(),new SummaryPhotoLimitError()])('preserves summary and private panel access when the PDF cannot fit',async(error)=>{const {report,service}=fixture();report.buildSiteSummary.mockRejectedValue(error);const result=await service.prepare([site],from,to,new Map());expect(result.attachments).toEqual([]);expect(result.notes.join(' ')).toContain('https://panel.example.test');expect(result.notes.join(' ')).toContain('no se adjuntó');});
 it('keeps all attachments within the most restrictive site budget and never reuses a differently redacted PDF',async()=>{const {report,service}=fixture();const result=await service.prepare([site,{...site,siteId:'other',guardNames:true,maxBytes:4096}],from,to,new Map());expect(result.attachments).toHaveLength(2);expect(report.buildSiteSummary.mock.calls.map(c=>c[6])).toEqual([2048,2048]);});
 it('retries unexpected errors instead of falsely confirming attachment delivery',async()=>{const {report,service}=fixture();report.buildSiteSummary.mockRejectedValue(new Error('database unavailable'));await expect(service.prepare([site],from,to,new Map())).rejects.toThrow('database unavailable');});
});
