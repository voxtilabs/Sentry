import { Transform } from 'class-transformer';
import { IsString, IsUUID, Matches } from 'class-validator';

import { normalizarUidNfc } from '../../admin/uid-nfc';

export class CompanyCardDto {
  @Transform(({ value }) => typeof value === 'string' ? normalizarUidNfc(value) : value)
  @IsString()
  @Matches(/^[0-9A-F]{4,64}$/)
  cardUid!: string;
}

export class SelectCompanyGuardDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  ticket!: string;

  @IsUUID()
  guardId!: string;
}

export class UpdateCompanyCardDto {
  /** An empty string revokes the company card. */
  @Transform(({ value }) => typeof value === 'string' ? normalizarUidNfc(value) : value)
  @IsString()
  @Matches(/^(?:[0-9A-F]{4,64})?$/)
  cardUid!: string;
}
