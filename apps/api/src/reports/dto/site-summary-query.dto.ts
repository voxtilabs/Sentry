import { IsISO8601, IsOptional, IsIn } from 'class-validator';

export class SiteSummaryQueryDto {
  @IsOptional() @IsIn(['true','false']) photos?: 'true'|'false';

  /** Inicio del periodo (ISO 8601). Sin valor: 30 dias antes de `to`. */
  @IsOptional()
  @IsISO8601()
  from?: string;

  /** Fin ISO con hora: exclusivo. Fecha sin hora: incluye ese día en el recinto. Sin valor: ahora. */
  @IsOptional()
  @IsISO8601()
  to?: string;
}
