import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsISO8601, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, Min, ValidateNested } from 'class-validator';
export class StartReferenceDto { @IsUUID() routeId!: string; }
export class ReferencePointDto {
  @IsUUID() clientPointId!: string;
  @IsISO8601({ strict: true }) recordedAt!: string;
  @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @IsNumber() @Min(-180) @Max(180) longitude!: number;
  @IsNumber() @Min(0.01) @Max(10000) accuracyM!: number;
  @IsOptional() @IsNumber() @Min(0) @Max(200) speedMps?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(360) heading?: number;
  @IsBoolean() stationary!: boolean;
  @IsInt() @Min(0) @Max(10000) accelSamples!: number;
  @IsInt() @Min(0) @Max(10000) gyroSamples!: number;
  @IsInt() @Min(0) @Max(1000) satellitesUsed!: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1000) accelRmsG?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(1000) gyroRmsRadS?: number;
}
export class ReferenceBatchDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ReferencePointDto)
  points!: ReferencePointDto[];
}
export class ReferenceScanDto {
  @IsUUID() clientScanId!: string;
  @IsString() @Matches(/^[0-9A-F]{4,64}$/) uid!: string;
  @IsISO8601({ strict: true }) scannedAt!: string;
}
