/** Own each login read until native cleanup finishes, so an old login loop
 * cannot cancel a point scan that starts after navigation. */
export interface LoginReaderPort {
  start(): Promise<void>;
  supported(): Promise<boolean>;
  enabled(): Promise<boolean>;
  reserve(): Promise<void>;
  request(): Promise<void>;
  read(): Promise<{ id?: string } | null>;
  cancel(): Promise<void>;
  confirm(): void;
}
interface Session {
  cancelled: boolean;
  ownsRequest: boolean;
  finished: Promise<void>;
  stopSignal: Promise<void>;
  stop: () => void;
  cancelRequest?: Promise<void>;
}
export function crearEscuchaLogin(port: LoginReaderPort) {
  let current: Session | undefined;
  let generation = 0;
  const valid = (session: Session) => current === session && !session.cancelled;
  const cancel = (session: Session) => session.cancelRequest ??= new Promise<void>(resolve => {
    const timer = setTimeout(resolve, 3000);
    void port.cancel().catch(() => undefined).finally(() => { clearTimeout(timer); resolve(); });
  });
  const delay = (session: Session, ms: number) => new Promise<void>(resolve => {
    const timer = setTimeout(resolve, ms);
    void session.stopSignal.then(() => {
      clearTimeout(timer);
      resolve();
    });
  });

  async function run(session: Session, onUid: (uid: string) => void): Promise<void> {
    try {
      await port.start();
      if (!valid(session)) return;
      if (!await port.supported() || !valid(session)) return;
      if (!await port.enabled() || !valid(session)) return;
      await port.reserve();
      if (!valid(session)) return;

      while (valid(session)) {
        try {
          session.cancelRequest = undefined;
          session.ownsRequest = true;
          await Promise.race([port.request(), session.stopSignal]);
          if (!valid(session)) continue;
          const tag = await Promise.race([port.read(), session.stopSignal.then(() => null)]);
          const uid = tag?.id?.replace(/[^0-9a-f]/gi, '').toUpperCase();
          if (uid && uid.length >= 4 && uid.length <= 64 && valid(session)) {
            port.confirm();
            onUid(uid);
            await delay(session, 1500);
          }
        } catch {
          if (valid(session)) await delay(session, 400);
        } finally {
          await cancel(session);
          session.ownsRequest = false;
        }
      }
    } catch {
      // NFC availability must never become an unhandled login rejection.
    } finally {
      if (current === session) current = undefined;
    }
  }

  async function iniciar(onUid: (uid: string) => void): Promise<void> {
    if (current && !current.cancelled) return current.finished;
    const wanted = ++generation;
    const previous = current;
    if (previous?.ownsRequest) await previous.finished;
    if (wanted !== generation) return;
    let stop!: () => void;
    const stopSignal = new Promise<void>(resolve => { stop = resolve; });
    const session: Session = {
      cancelled: false, ownsRequest: false, finished: Promise.resolve(), stopSignal, stop,
    };
    current = session;
    session.finished = Promise.resolve().then(() => run(session, onUid));
    return session.finished;
  }

  async function detener(): Promise<void> {
    generation++;
    const session = current;
    if (!session) return;
    session.cancelled = true;
    session.stop();
    // A start/availability check owns no technology request and its late
    // continuation sees cancelled before touching the radio.
    if (!session.ownsRequest) return;
    await cancel(session);
    await session.finished;
  }

  return { iniciar, detener };
}
