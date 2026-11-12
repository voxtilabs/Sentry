import { Transform } from 'class-transformer';
import { Equals, IsIn, IsBoolean, IsISO8601, IsOptional, IsString, IsUUID, Length, Matches, ValidateIf } from 'class-validator';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;

export class RegisterVisitDto {
  @IsUUID() clientVisitId!: string;
  @IsUUID() siteId!: string;
  // Se comparan con la sesión. Una cola de otro guardia/empresa no se reasigna.
  @IsUUID() expectedActorId!: string;
  @IsUUID() expectedTenantId!: string;
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 120)
  givenNames!: string;
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 120)
  familyNames!: string;
  @Transform(trim) @IsString() @Length(8, 12) run!: string;
  @IsISO8601() enteredAt!: string;
  @IsBoolean() arrivesInVehicle!: boolean;
  @ValidateIf((value: RegisterVisitDto) => value.arrivesInVehicle || value.plate !== undefined)
  @IsString() @Length(5, 10) plate?: string;
  @IsOptional() @IsUUID() vehicleCheckId?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(0, 80) vehicleMake?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(0, 120) vehicleModel?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(0, 80) vehicleColor?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(0, 200) destination?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(0, 160) originCompany?: string;
  @Equals(true) visitorInformed!: true;
}

export class ExitVisitDto {
  @IsUUID() visitId!: string;
  @IsUUID() expectedActorId!: string;
  @IsUUID() expectedTenantId!: string;
  @IsISO8601() exitedAt!: string;
}

export class VehicleLookupDto {
  @IsUUID() siteId!: string;
  @IsString() @Length(5, 10) @Matches(/^[A-Za-z0-9 .-]+$/) plate!: string;
}

export class PublicVehicleCheckDto {
  @IsUUID() siteId!: string;
  @IsString() @Matches(/^[A-Z0-9]{5,6}$/) plate!: string;
  @Equals('autoseguro') source!: 'autoseguro';
  @IsIn(['sin_encargo','con_encargo','encargo_parcial']) stolenStatus!: 'sin_encargo' | 'con_encargo' | 'encargo_parcial';
  @IsISO8601() checkedAt!: string;
  @IsOptional() @IsUUID() previousCheckId?: string;
}
