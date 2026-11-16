import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEmail, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
export class OperationsQuery {
  @IsOptional() @IsUUID() siteId?:string;
  @IsOptional() @IsISO8601() from?:string;
  @IsOptional() @IsISO8601() to?:string;
  @IsOptional() @Type(()=>Number) @IsInt() @Min(1) @Max(100) limit=50;
  @IsOptional() @Type(()=>Number) @IsInt() @Min(0) @Max(10000) offset=0;
}
export class RecipientsDto {
  @Transform(({value}:{value:unknown})=>Array.isArray(value)?value.map(v=>typeof v==='string'?v.trim().toLowerCase():v):value)
  @IsArray() @ArrayMaxSize(10) @IsEmail({}, {each:true}) recipients!:string[];
}
export class RutDto {
  @IsString() @MaxLength(16) rut!:string;
}
export class PatrolPdfQuery {
  @IsOptional() @IsIn(['true','false']) photos?:'true'|'false';
}
