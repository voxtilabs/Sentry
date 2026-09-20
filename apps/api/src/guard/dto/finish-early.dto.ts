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
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string;
}
