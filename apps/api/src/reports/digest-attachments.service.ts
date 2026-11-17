import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MailAttachment } from '../mail/mail-provider';
import { ReportsService, SummaryPdfSizeError, SummaryPhotoLimitError } from './reports.service';

export interface DigestDetail {
  siteId: string;
  name: string;
  photos: boolean;
  guardNames: boolean;
  maxBytes: number;
}
export interface DigestAttachmentResult {attachments: MailAttachment[]; notes: string[]}
export type DigestPdfCache = Map<string, Promise<{attachment: MailAttachment} | {note: string}>>;

/** Builds per-site PDFs with independent disclosure flags, never an unredacted cached report. */
@Injectable()
export class DigestAttachmentsService {
  constructor(private readonly reports: ReportsService, private readonly config: ConfigService) {}

  async prepare(sites: readonly DigestDetail[], from: Date, to: Date, cache: DigestPdfCache): Promise<DigestAttachmentResult> {
    const selected = sites.filter(s => s.photos || s.guardNames);
    if (!selected.length) return {attachments:[],notes:[]};
    const totalBudget = Math.min(...sites.map(s => s.maxBytes));
    const perSiteBudget = Math.floor(totalBudget / selected.length);
    const attachments: MailAttachment[] = [], notes: string[] = [];
    // Sequential compression keeps memory bounded and reuses PDFs between recipients.
    for (const site of selected) {
      const key = JSON.stringify([site.siteId,from,to,site.photos,site.guardNames,perSiteBudget]);
      let pending = cache.get(key);
      if (!pending) {pending=this.build(site,from,to,perSiteBudget);cache.set(key,pending);}
      const result = await pending;
      if ('attachment' in result) attachments.push(result.attachment);
      else notes.push(result.note);
    }
    if (notes.length) notes.push(`Consulta el detalle en Informes del panel de SentryCore con una cuenta autorizada: ${this.config.getOrThrow<string>('WEB_PUBLIC_URL')}`);
    return {attachments,notes};
  }

  private async build(site: DigestDetail, from: Date, to: Date, maxBytes: number): Promise<{attachment: MailAttachment} | {note: string}> {
    try {
      const report = await this.reports.buildSiteSummary(site.siteId,from.toISOString(),to.toISOString(),null,site.photos,site.guardNames,maxBytes);
      // Also protect against an incorrectly sized response from a replacement renderer.
      if (report.pdf.length > maxBytes) throw new SummaryPdfSizeError();
      return {attachment:{filename:report.filename,contentType:'application/pdf',contentBase64:report.pdf.toString('base64')}};
    } catch (error) {
      if (error instanceof SummaryPdfSizeError || error instanceof SummaryPhotoLimitError)
        return {note:`${site.name}: el detalle no se adjuntó porque supera el límite de tamaño o cantidad de fotos del PDF. El resumen se conserva completo.`};
      if (error instanceof ForbiddenException && site.photos)
        return {note:`${site.name}: el anexo fotográfico no está habilitado para esta empresa; consulta la configuración en el panel.`};
      // Database, filesystem and unexpected rendering errors must retry, never look like success.
      throw error;
    }
  }
}
