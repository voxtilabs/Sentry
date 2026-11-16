import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';

export class CompanyCodeDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toUpperCase() : value)
  @IsString()
  @Matches(/^[A-Z0-9]{10}$/)
  code!: string;
}
