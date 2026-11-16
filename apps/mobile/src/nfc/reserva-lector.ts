/** Inscripción compartida: cancelar un escaneo no debe devolver a Android
 * las etiquetas asociadas a otras apps. El sistema pausa el lector cuando
 * nuestra actividad deja de estar en primer plano. No registra puntos. */
export function crearReservaLector() {
  let reserva: Promise<void> | undefined;
  return (registrar: () => Promise<void>): Promise<void> => {
    if (!reserva) {
      reserva = Promise.resolve().then(registrar).catch((error: unknown) => {
        reserva = undefined;
        throw error;
      });
    }
    return reserva;
  };
}
export const reservarLector = crearReservaLector();
