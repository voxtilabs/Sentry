import {
  IsEmail,
  IsIn,
  IsString,
  IsOptional,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { normalizarUidNfc } from '../../admin/uid-nfc';

export class CreateTenantDto {
  @IsOptional()
  @Transform(({ value }) => typeof value === 'string' ? normalizarUidNfc(value) : value)
  @IsString()
  @Matches(/^[0-9A-F]{4,64}$/)
  loginCardUid?: string;
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MinLength(3)
  @MaxLength(48)
  slug!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(160)
  legalName!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  displayName!: string;

  @IsIn(['base', 'pro'])
  planKey!: 'base' | 'pro';

  @IsEmail()
  @MaxLength(254)
  adminEmail!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  adminGivenName!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  adminFamilyName!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  adminPassword!: string;
}
