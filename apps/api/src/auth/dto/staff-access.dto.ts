import {ArrayMaxSize,ArrayUnique,IsArray,IsUUID} from 'class-validator';
export class SwitchCompanyDto {@IsUUID() tenantId!:string;}
export class SupervisionAccessDto {
 @IsUUID() tenantId!:string;
 @IsUUID() supervisorId!:string;
 @IsArray() @ArrayUnique() @ArrayMaxSize(1000) @IsUUID(undefined,{each:true}) siteIds!:string[];
}
