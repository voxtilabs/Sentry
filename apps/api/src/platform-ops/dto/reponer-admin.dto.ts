import { IsEmail, IsUUID, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * A donde mandar la invitacion del administrador de una empresa que se quedo
 * sin acceso.
 *
 * El correo se normaliza a minusculas antes de validar: la columna es `citext`
 * y dos direcciones que solo difieren en mayusculas son la misma persona, pero
 * el indice unico no perdona si una llega con otra forma.
 */
export class ReponerAdminDto {
  @IsUUID()
  tenantId!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail({}, { message: 'El correo del administrador no es valido' })
  @MaxLength(254)
  email!: string;
}
