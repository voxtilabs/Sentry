import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * El motivo por el que la ronda se cierra sin completar (#231).
 *
 * Opcional: obligarlo haria que el guardia escriba "a" para poder salir, y un
 * motivo inventado es peor que ninguno. Cuando lo escribe, queda como novedad
 * de la ronda —"la reja estaba cerrada" vale mas en el informe que un 50% sin
 * explicacion—.
 */
export class FinishEarlyDto {
  /*
   * Se recorta ANTES de validar. La base mide `length(trim(reason)) >= 3`, asi
   * que un "  a  " pasaria el MinLength de 5 caracteres y reventaria contra el
   * CHECK: el guardia veria un error del servidor al intentar cerrar o pausar.
   * En blanco es ausente, no cadena vacia.
   */
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const recortado = value.trim();
    return recortado.length > 0 ? recortado : undefined;
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string;
}
