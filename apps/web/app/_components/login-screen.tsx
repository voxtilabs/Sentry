'use client';

import type { Role } from '@sentrycore/shared';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

import { Brand } from './brand';
import { esAppDelGuardia } from '../_lib/app-del-guardia';
import {
  esCodigoEmpresaValido,
  guardarCodigoEmpresa,
  leerCodigoEmpresa,
  normalizarCodigoEmpresa,
  olvidarCodigoEmpresa,
} from '../_lib/codigo-empresa';
import { leerCredenciales } from './login-form-data';
import { rutaDelPanel } from './login-navegacion';
import { LogoutButton } from './logout-button';
import { HelpButton } from './help-button';

/**
 * Plazo maximo para el login. Existe porque una peticion sin respuesta dejaba
 * el boton en "Verificando…" indefinidamente: el usuario no podia distinguir
 * "esta pensando" de "esto no va a contestar nunca".
 */
const TIEMPO_MAXIMO_MS = 20_000;

export function LoginScreen({ initialCompanyLogin = false }: { initialCompanyLogin?: boolean }) {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? '/api';
  const [showPassword, setShowPassword] = useState(false);
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [mode, setMode] = useState<'login' | 'recovery' | 'action'>('login');
  const [action, setAction] = useState<{ purpose: 'invite' | 'reset'; token: string } | null>(
    null,
  );
  const [status, setStatus] = useState<
    'idle' | 'loading' | 'error' | 'offline' | 'success'
  >('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [tenantId, setTenantId] = useState('');
  const [tenantChoices, setTenantChoices] = useState<
    Array<{ tenantId: string; tenantName: string; tenantSlug: string; role: Role }>
  >([]);
  /*
   * El codigo de empresa fijado en ESTE telefono. Se lee en un efecto y no en
   * el estado inicial porque `localStorage` no existe durante el render del
   * servidor de Next: leerlo ahi haria que el HTML del servidor y el del
   * cliente no coincidan.
   */
  const [codigoEmpresa, setCodigoEmpresa] = useState('');
  const [editandoCodigoEmpresa, setEditandoCodigoEmpresa] = useState(false);
  const [codigoEmpresaBorrador, setCodigoEmpresaBorrador] = useState('');
  const [nfcFeedback, setNfcFeedback] = useState<string | null>(null);
  const [companyMode, setCompanyMode] = useState(initialCompanyLogin);
  const [companyAccessCode, setCompanyAccessCode] = useState('');
  const cardBusy = useRef(false);
  const [companyPicker, setCompanyPicker] = useState<{
    ticket: string; tenantName: string; tenantSlug: string;
    guards: Array<{ id: string; name: string }>;
  } | null>(null);

  async function selectCompanyGuard(guardId: string) {
    if (!companyPicker || cardBusy.current) return;
    cardBusy.current = true;
    setStatus('loading');
    try {
      const refreshed = await fetch(`${apiUrl}/auth/company-picker`, { credentials: 'include', cache: 'no-store' });
      const current = refreshed.ok ? await refreshed.json() as NonNullable<typeof companyPicker> : companyPicker;
      const response = await fetch(`${apiUrl}/auth/company-card/select`, {
        method: 'POST', credentials: 'include', signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ticket: current.ticket, guardId }),
      });
      if (!response.ok) {
        setCompanyPicker(null);
        throw new Error('Vuelve a ingresar el código o acerca la tarjeta de empresa para elegir tu usuario.');
      }
      guardarCodigoEmpresa(companyPicker.tenantSlug);
      window.location.assign(rutaDelPanel('GUARDIA'));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'No pudimos conectar.');
      setStatus('error');
    } finally { cardBusy.current = false; }
  }

  async function entrarConCodigoEmpresa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (cardBusy.current) return;
    if (!/^[A-Z0-9]{10}$/.test(companyAccessCode)) {
      setErrorMessage('Ingresa los 10 caracteres del código de tu empresa.');
      setStatus('error');
      return;
    }
    if (!navigator.onLine) {
      setStatus('offline');
      return;
    }
    setStatus('loading');
    setErrorMessage('');
    cardBusy.current = true;
    try {
      const respuesta = await fetch(`${apiUrl}/auth/company-code`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: companyAccessCode }),
        signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
      });
      const resultado = await respuesta.json().catch(() => null) as NonNullable<typeof companyPicker> | null;

      if (!respuesta.ok || !resultado?.ticket || !Array.isArray(resultado.guards)) {
        setErrorMessage(
          respuesta.status === 429
            ? 'Demasiados intentos. Espera un minuto e inténtalo de nuevo.'
            : 'Código de empresa incorrecto o no disponible.',
        );
        setStatus('error');
        return;
      }

      setCompanyAccessCode('');
      setCompanyPicker(resultado);
      setStatus('idle');
    } catch {
      setErrorMessage('No pudimos conectar. Revisa tu señal e inténtalo de nuevo.');
      setStatus(navigator.onLine ? 'error' : 'offline');
    } finally { cardBusy.current = false; }
  }

  useEffect(() => {
    setCodigoEmpresa(leerCodigoEmpresa());
    const controller = new AbortController();
    void fetch(`${apiUrl}/auth/company-picker`, { credentials: 'include', cache: 'no-store', signal: controller.signal })
      .then(async r => { if (r.ok) setCompanyPicker(await r.json() as NonNullable<typeof companyPicker>); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [apiUrl]);

  useEffect(() => {
    function readActionLink() {
      const parameters = new URLSearchParams(window.location.hash.slice(1));
      const invitation = parameters.get('invite');
      const reset = parameters.get('reset');
      if (invitation) {
        setAction({ purpose: 'invite', token: invitation });
        setMode('action');
      } else if (reset) {
        setAction({ purpose: 'reset', token: reset });
        setMode('action');
      }
    }
    readActionLink();
    window.addEventListener('hashchange', readActionLink);
    return () => window.removeEventListener('hashchange', readActionLink);
  }, []);

  /**
   * Abrir el campo del codigo con lo que hubiera fijado: el guardia corrige una
   * letra en vez de escribirlo entero, que es lo que suele fallar en la garita.
   */
  const abrirEdicionDeCodigo = useCallback(() => {
    setCodigoEmpresaBorrador(codigoEmpresa);
    setEditandoCodigoEmpresa(true);
  }, [codigoEmpresa]);

  const fijarCodigoEmpresa = useCallback((valor: string) => {
    const normalizado = normalizarCodigoEmpresa(valor);
    if (!esCodigoEmpresaValido(normalizado)) return;
    guardarCodigoEmpresa(normalizado);
    setCodigoEmpresa(normalizado);
    setEditandoCodigoEmpresa(false);
    setStatus('idle');
    setErrorMessage('');
  }, []);

  const borrarCodigoEmpresa = useCallback(() => {
    olvidarCodigoEmpresa();
    setCodigoEmpresa('');
    setCodigoEmpresaBorrador('');
    setEditandoCodigoEmpresa(true);
  }, []);

  const loginWithNfc = useCallback(async (cardUid: string) => {
    if (!cardUid || cardBusy.current || companyPicker) return;
    if (!navigator.onLine) { setStatus('offline'); return; }
    cardBusy.current = true;
    setStatus('loading');
    setErrorMessage('');
    setNfcFeedback('Tarjeta detectada · Verificando empresa…');
    try {
      const response = await fetch(`${apiUrl}/auth/company-card`, {
        method: 'POST', credentials: 'include', signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cardUid }),
      });
      if (!response.ok) {
        throw new Error(response.status === 429
          ? 'Espera un minuto y vuelve a acercar la tarjeta.'
          : 'Tarjeta de empresa no registrada o sin guardias activos. Contacta a tu supervisor.');
      }
      setCompanyPicker(await response.json() as NonNullable<typeof companyPicker>);
      setStatus('idle');
    } catch (error) {
      setStatus(navigator.onLine ? 'error' : 'offline');
      setErrorMessage(error instanceof Error ? error.message : 'No pudimos validar la tarjeta.');
    } finally { cardBusy.current = false; setNfcFeedback(null); }
  }, [apiUrl, companyPicker]);

  useEffect(() => {
    function alDetectarTarjetaNfc(uid: string) {
      if (mode !== 'login') return;
      void loginWithNfc(uid);
    }

    const handler = (event: Event) => {
      const custom = event as CustomEvent<{ uid: string }>;
      if (custom.detail?.uid) alDetectarTarjetaNfc(custom.detail.uid);
    };

    (window as unknown as { __sentrycoreNfcLogin?: (uid: string) => void }).__sentrycoreNfcLogin =
      alDetectarTarjetaNfc;
    window.addEventListener('sentrycore:nfc:login', handler);

    // Consumir UID si fue escaneado antes de que el componente terminara de montar
    const globalWin = window as unknown as { __sentrycoreLastNfcUid?: string };
    if (globalWin.__sentrycoreLastNfcUid) {
      const uidPendiente = globalWin.__sentrycoreLastNfcUid;
      delete globalWin.__sentrycoreLastNfcUid;
      alDetectarTarjetaNfc(uidPendiente);
    }

    return () => {
      delete (window as unknown as { __sentrycoreNfcLogin?: unknown }).__sentrycoreNfcLogin;
      window.removeEventListener('sentrycore:nfc:login', handler);
    };
  }, [mode, loginWithNfc]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const credenciales = leerCredenciales(new FormData(event.currentTarget));
    if (!credenciales.identity || !credenciales.password) {
      setErrorMessage('Completa el usuario y la contraseña para continuar.');
      setStatus('error');
      return;
    }
    if (!navigator.onLine) {
      setStatus('offline');
      return;
    }

    setStatus('loading');
    setErrorMessage('');

    try {
      const response = await fetch(
        `${apiUrl}/auth/login`,
        {
          method: 'POST',
          credentials: 'include',
          // Sin plazo, una peticion que nunca contesta deja el boton en
          // "Verificando…" para siempre y el guardia no sabe si esperar o
          // reintentar. Veinte segundos son de sobra para un login.
          signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            identity: credenciales.identity,
            password: credenciales.password,
            ...(credenciales.tenantId ? { tenantId: credenciales.tenantId } : {}),
            ...(!credenciales.tenantId && codigoEmpresa
              ? { tenantSlug: codigoEmpresa }
              : {}),
          }),
        },
      );
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        setErrorMessage(
          'El servicio de acceso no está disponible en este momento. Inténtalo nuevamente.',
        );
        setStatus('error');
        return;
      }

      const result = (await response.json()) as {
        requiresTenantSelection?: boolean;
        tenants?: Array<{
          tenantId: string;
          tenantName: string;
          tenantSlug: string;
          role: Role;
        }>;
        user?: { role: Role };
        code?: string;
        message?: string | string[];
      };

      if (result.requiresTenantSelection && result.tenants) {
        setTenantChoices(result.tenants);
        setStatus('idle');
        return;
      }
      if (!response.ok || !result.user) {
        if (result.code === 'TENANT_CODE_MISMATCH') abrirEdicionDeCodigo();
        // DEMASIADOS_INTENTOS tiene que llegar tal cual: decirle "revisa tus
        // credenciales" a alguien que ya esta bloqueado lo empuja a reintentar,
        // y cada reintento alarga el bloqueo hasta una hora. El mensaje del
        // servidor trae los minutos que faltan.
        const conMensajePropio =
          result.code === 'TENANT_SUSPENDED' ||
          result.code === 'TENANT_CODE_MISMATCH' ||
          result.code === 'DEMASIADOS_INTENTOS';
        setErrorMessage(
          conMensajePropio && typeof result.message === 'string'
            ? result.message
            : 'No pudimos iniciar sesión. Revisa tus credenciales e inténtalo nuevamente.',
        );
        setStatus('error');
        return;
      }

      /*
       * Dentro de la app hay dos señales mejores que el user-agent:
       * `ReactNativeWebView`, que solo existe en un WebView de React Native, y
       * el puente ya inyectado. El user-agent queda de respaldo porque puede
       * llegar recortado, y porque un APK viejo puede tardar en inyectar el
       * puente: expulsar al guardia por llegar un instante antes seria repetir
       * el bug del renombre por otra via.
       */
      const dentroDeLaApp =
        typeof window !== 'undefined' &&
        (Boolean((window as unknown as { __sentrycorePuente?: unknown }).__sentrycorePuente) ||
          Boolean((window as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView) ||
          esAppDelGuardia(navigator.userAgent));

      if (result.user.role === 'GUARDIA' && !dentroDeLaApp) {
        await fetch(`${apiUrl}/auth/logout`, {
          method: 'POST',
          credentials: 'include',
        });
        setErrorMessage('El acceso de guardia está disponible únicamente en la app Android.');
        setStatus('error');
        return;
      }

      window.location.assign(rutaDelPanel(result.user.role));
    } catch (error) {
      const expiro = error instanceof DOMException && error.name === 'TimeoutError';
      setErrorMessage(
        expiro
          ? 'El servidor tardó demasiado en responder. Vuelve a intentarlo.'
          : 'No pudimos conectar con el servicio de acceso. Comprueba tu conexión e inténtalo nuevamente.',
      );
      setStatus(navigator.onLine ? 'error' : 'offline');
    }
  }

  async function requestRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recoveryEmail.trim())) {
      setErrorMessage('Ingresa un correo válido.');
      return setStatus('error');
    }
    if (!navigator.onLine) return setStatus('offline');
    setStatus('loading');
    try {
      await fetch(`${apiUrl}/auth/password-reset/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: recoveryEmail }),
      });
      setStatus('success');
    } catch {
      setStatus(navigator.onLine ? 'error' : 'offline');
    }
  }

  async function completeAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action || password.length < 12 || password !== confirmation) {
      setErrorMessage('La contraseña debe tener 12 caracteres y ambas entradas deben coincidir.');
      return setStatus('error');
    }
    if (!navigator.onLine) return setStatus('offline');
    setStatus('loading');
    try {
      const endpoint =
        action.purpose === 'invite' ? 'invitations/complete' : 'password-reset/complete';
      const response = await fetch(`${apiUrl}/auth/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: action.token, password }),
      });
      if (!response.ok) {
        setErrorMessage('Este enlace no es válido o ya venció. Solicita uno nuevo.');
        return setStatus('error');
      }
      window.history.replaceState(null, '', window.location.pathname);
      setAction(null);
      setPassword('');
      setConfirmation('');
      setMode('login');
      setStatus('success');
    } catch {
      setStatus(navigator.onLine ? 'error' : 'offline');
    }
  }

  if (companyPicker) return <main className="login-shell company-guard-picker">
    <div className="company-picker-logout"><LogoutButton /></div>
    <section className="login-panel">
      <div className="login-card">
        <Brand />
        <span className="eyebrow">{companyPicker.tenantName}</span>
        <h2>Selecciona tu usuario</h2>
        <p className="login-intro">Elige tu nombre para comenzar la ronda.</p>
        <ul className="company-guard-list" aria-label="Guardias de la empresa">
          {companyPicker.guards.map((guard) => <li key={guard.id}>
            <button className="secondary-button" type="button" disabled={status === 'loading'}
              onClick={() => void selectCompanyGuard(guard.id)}>{guard.name}</button>
          </li>)}
        </ul>
        {errorMessage ? <p role="alert">{errorMessage}</p> : null}
        <HelpButton />
      </div>
    </section>
  </main>;

  return (
    <main className="login-shell">
      <section className="login-story">
        <Brand />
        <div className="story-copy">
          <span className="eyebrow">Seguridad operacional verificable</span>
          <h1>Cada ronda.<br />Cada punto.<br /><em>Bajo control.</em></h1>
          <p>
            Supervisa recorridos en tiempo real, valida presencia con NFC y conserva evidencia
            confiable incluso cuando el guardia trabaja sin conexión.
          </p>
        </div>
        <div className="trust-row" aria-label="Características principales">
          <span>● Operación en línea</span>
          <span>NFC + GPS</span>
          <span>Modo offline</span>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-card">
          <div className="mobile-brand"><Brand /></div>
          <span className="eyebrow">
            {mode === 'login' ? 'Portal de operaciones' : 'Acceso seguro'}
          </span>
          <h2>
            {mode === 'login'
              ? 'Bienvenido de vuelta'
              : mode === 'recovery'
                ? 'Recupera tu acceso'
                : action?.purpose === 'invite'
                  ? 'Activa tu cuenta'
                  : 'Nueva contraseña'}
          </h2>
          <p className="login-intro">
            {mode === 'login'
              ? companyMode ? 'Ingresa el código de tu empresa o acerca su tarjeta NFC.' : 'Acceso de supervisores y administración.'
              : mode === 'recovery'
                ? 'Te enviaremos un enlace si el correo está registrado.'
                : 'Define una contraseña segura para continuar.'}
          </p>

          {nfcFeedback ? (
            <div
              className="form-message info"
              role="status"
              style={{
                marginBottom: '1rem',
                backgroundColor: '#eff6ff',
                color: '#1d4ed8',
                border: '1px solid #bfdbfe',
                borderRadius: '0.5rem',
                padding: '0.75rem',
                fontSize: '0.875rem',
                fontWeight: 500,
              }}
            >
              <span>📇 {nfcFeedback}</span>
            </div>
          ) : null}

          {mode === 'login' && companyMode ? <form className="login-form" onSubmit={entrarConCodigoEmpresa}>
            <label className="company-access-code-field">Código de acceso de la empresa
              <input autoCapitalize="characters" autoComplete="off" autoCorrect="off"
                inputMode="text" name="companyCode" minLength={10} maxLength={10} required spellCheck={false}
                value={companyAccessCode} onChange={event => {
                  setCompanyAccessCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10));
                  setStatus('idle'); setErrorMessage('');
                }} placeholder="10 caracteres" aria-describedby="company-code-help" />
              <small id="company-code-help">Te lo entrega tu supervisor. Son 10 letras y números en mayúsculas.</small>
            </label>
            <p className="form-note">Después elige tu nombre en la lista de guardias.</p>
            {status === 'error' ? <p className="form-message error" role="alert">{errorMessage}</p> : null}
            {status === 'offline' ? <p className="form-message offline" role="alert">Estás sin conexión. Recupera la señal para identificar tu empresa. Las rondas ya iniciadas siguen disponibles sin conexión.</p> : null}
            <button className="primary-button" disabled={status === 'loading'} type="submit">
              {status === 'loading' ? 'Verificando…' : 'Ingresar a mi empresa'}
            </button>
            <p className="form-note">También puedes acercar la tarjeta NFC de la empresa, si está configurada.</p>
          </form> : null}

          {mode === 'login' && !companyMode ? <form className="login-form" noValidate onSubmit={submit}>
            {editandoCodigoEmpresa || !codigoEmpresa ? (
              <label className="codigo-empresa-campo">
                Código de empresa
                <input
                  autoCapitalize="none"
                  autoComplete="organization"
                  autoCorrect="off"
                  inputMode="text"
                  name="tenantSlug"
                  onChange={(event) => {
                    setCodigoEmpresaBorrador(event.target.value);
                    setStatus('idle');
                    setErrorMessage('');
                  }}
                  onBlur={(event) => fijarCodigoEmpresa(event.target.value)}
                  placeholder="tu-empresa"
                  spellCheck={false}
                  value={codigoEmpresaBorrador}
                />
                <small>
                  Te lo da tu supervisor. Se guarda en este teléfono: no lo escribes de nuevo.
                </small>
              </label>
            ) : (
              <p className="codigo-empresa-fijado">
                <span>
                  Empresa: <strong>{codigoEmpresa}</strong>
                </span>
                <button className="text-button" onClick={borrarCodigoEmpresa} type="button">
                  Cambiar
                </button>
              </p>
            )}

            <label>
              Usuario o correo
              <input
                autoComplete="username"
                name="identity"
                onChange={(event) => {
                  setIdentity(event.target.value);
                  setStatus('idle');
                  setErrorMessage('');
                }}
                placeholder="tu.usuario"
                required
                value={identity}
              />
            </label>
            <label>
              Contraseña
              <span className="password-field">
                <input
                  autoComplete="current-password"
                  name="password"
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setStatus('idle');
                    setErrorMessage('');
                  }}
                  placeholder="••••••••"
                  required
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                />
                <button
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  className="reveal-button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  type="button"
                >
                  {showPassword ? 'Ocultar' : 'Ver'}
                </button>
              </span>
            </label>
            {tenantChoices.length > 1 ? (
              <label>
                Empresa
                <select
                  name="tenantId"
                  onChange={(event) => {
                    setTenantId(event.target.value);
                    const elegida = tenantChoices.find(
                      (tenant) => tenant.tenantId === event.target.value,
                    );
                    if (elegida) fijarCodigoEmpresa(elegida.tenantSlug);
                  }}
                  required
                  value={tenantId}
                >
                  <option value="">Selecciona dónde ingresar</option>
                  {tenantChoices.map((tenant) => (
                    <option key={tenant.tenantId} value={tenant.tenantId}>
                      {tenant.tenantName} · {tenant.role}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {status === 'error' ? (
              <p className="form-message error" role="alert">
                {errorMessage || 'Completa todos los campos para continuar.'}
              </p>
            ) : null}
            {status === 'offline' ? (
              <p className="form-message offline" role="alert">
                Estás sin conexión. Comprueba tu red para iniciar sesión.
              </p>
            ) : null}
            {status === 'success' ? (
              <p className="form-message success" role="status">
                Contraseña definida correctamente. Ya puedes iniciar sesión.
              </p>
            ) : null}
            <button className="primary-button" disabled={status === 'loading'} type="submit">
              {status === 'loading' ? 'Verificando…' : 'Ingresar'}
              <span aria-hidden="true">{status === 'loading' ? '···' : '→'}</span>
            </button>
            <button
              className="text-button recovery-link"
              onClick={() => {
                setMode('recovery');
                setStatus('idle');
              }}
              type="button"
            >
              ¿Olvidaste tu contraseña?
            </button>
          </form> : null}

          {mode === 'login' ? <button className="text-button staff-access-switch" type="button"
            disabled={status === 'loading'} onClick={() => { setCompanyMode(value => !value); setStatus('idle'); setErrorMessage(''); }}>
            {companyMode ? 'Acceso de supervisores y administración' : 'Acceso de guardias con código de empresa'}
          </button> : null}

          {mode === 'recovery' ? (
            <form className="login-form" noValidate onSubmit={requestRecovery}>
              <label>
                Correo
                <input
                  autoComplete="email"
                  inputMode="email"
                  onChange={(event) => {
                    setRecoveryEmail(event.target.value);
                    setStatus('idle');
                  }}
                  required
                  type="email"
                  value={recoveryEmail}
                />
              </label>
              {status === 'success' ? (
                <p className="form-message success" role="status">
                  Si el correo está registrado, recibirás instrucciones en unos minutos.
                </p>
              ) : null}
              {status === 'offline' ? (
                <p className="form-message offline" role="alert">
                  Estás sin conexión. Comprueba tu red para continuar.
                </p>
              ) : null}
              {status === 'error' ? (
                <p className="form-message error" role="alert">
                  {errorMessage || 'No pudimos procesar la solicitud. Inténtalo nuevamente.'}
                </p>
              ) : null}
              <button className="primary-button" disabled={status === 'loading'} type="submit">
                {status === 'loading' ? 'Enviando…' : 'Enviar instrucciones'}
              </button>
              <button
                className="text-button recovery-link"
                onClick={() => {
                  setMode('login');
                  setStatus('idle');
                }}
                type="button"
              >
                Volver al inicio de sesión
              </button>
            </form>
          ) : null}

          {mode === 'action' ? (
            <form className="login-form" noValidate onSubmit={completeAction}>
              <label>
                Nueva contraseña
                <input
                  autoComplete="new-password"
                  minLength={12}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setStatus('idle');
                  }}
                  required
                  type="password"
                  value={password}
                />
              </label>
              <label>
                Repite la contraseña
                <input
                  autoComplete="new-password"
                  minLength={12}
                  onChange={(event) => {
                    setConfirmation(event.target.value);
                    setStatus('idle');
                  }}
                  required
                  type="password"
                  value={confirmation}
                />
              </label>
              {status === 'error' ? (
                <p className="form-message error" role="alert">{errorMessage}</p>
              ) : null}
              {status === 'offline' ? (
                <p className="form-message offline" role="alert">
                  Estás sin conexión. Comprueba tu red para continuar.
                </p>
              ) : null}
              <button className="primary-button" disabled={status === 'loading'} type="submit">
                {status === 'loading' ? 'Guardando…' : 'Definir contraseña'}
              </button>
            </form>
          ) : null}
        </div>
        {/*
          * El convenio con Vigilab va AQUI y no dentro del panel.
          *
          * La app es de marca blanca: en cuanto el tenant tiene nombre o logo
          * propio, la marca del producto desaparece de su pantalla (ver
          * brand.tsx). Meter a VoxTi y a Vigilab dentro del panel le pondria a
          * cada cliente la marca de OTRA empresa de seguridad encima de la
          * suya — justo lo contrario de lo que promete el producto.
          *
          * El ingreso es el unico lugar donde todavia no hay cliente: ahi la
          * marca del producto es lo que corresponde mostrar.
          */}
        <footer className="login-pie">
          <HelpButton />
          <span>SentryCore · Acceso seguro</span>
          <span className="login-convenio">
            <span>VoxTi Labs · en convenio con</span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/vigilab.png" alt="Vigilab" width={900} height={256} />
          </span>
        </footer>
      </section>
    </main>
  );
}
