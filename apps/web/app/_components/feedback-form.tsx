'use client';

import { useRef, useState, type FormEvent } from 'react';

export function FeedbackForm() {
  const submissionId = useRef<string | null>(null);
  const busy = useRef(false);
  const [category, setCategory] = useState('support');
  const [message, setMessage] = useState('');
  const [replyEmail, setReplyEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'error' | 'received'>('idle');
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    if (message.trim().length < 10) {
      setError('Describe lo ocurrido con al menos 10 caracteres.');
      setStatus('error');
      return;
    }
    if (!navigator.onLine) {
      setError('Estás sin conexión. Tu reporte aún no se ha enviado. Conserva esta pantalla e inténtalo al recuperar señal.');
      setStatus('error');
      return;
    }
    busy.current = true;
    submissionId.current ??= crypto.randomUUID();
    setStatus('sending');
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? '/api'}/feedback`, {
        method: 'POST', credentials: 'omit',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({ submissionId: submissionId.current, category, message: message.trim(),
          ...(replyEmail.trim() ? { replyEmail: replyEmail.trim() } : {}) }),
      });
      if (!response.ok) {
        setError(response.status === 429
          ? 'Has enviado varios reportes. Espera unos minutos e inténtalo nuevamente.'
          : 'No pudimos recibir tu reporte. El texto sigue aquí para que puedas reintentarlo.');
        setStatus('error');
        return;
      }
      const result = await response.json() as { receipt?: string; status?: string };
      if (result.status !== 'received' || !result.receipt) throw new Error('invalid receipt');
      setReceipt(result.receipt);
      setMessage('');
      setReplyEmail('');
      setStatus('received');
    } catch {
      setError('No pudimos confirmar la recepción. El texto sigue aquí; reintenta cuando tengas conexión.');
      setStatus('error');
    } finally {
      busy.current = false;
    }
  }

  if (status === 'received') return <div className="feedback-confirmation" role="status">
    <h3>Reporte recibido</h3>
    <p>Tu reporte quedó registrado para su envío al equipo de SentryCore.</p>
    <p>Folio: <strong className="feedback-receipt">{receipt}</strong></p>
    <p>Si dejaste tu correo, podremos contactarte por ese medio. La recepción no significa que la revisión ya haya terminado.</p>
    <button type="button" className="secondary-button" onClick={() => {
      submissionId.current = null; setStatus('idle');
    }}>Enviar otro reporte</button>
  </div>;

  return <form className="feedback-form" onSubmit={submit}>
    <p>Envíanos comentarios, problemas o preocupaciones sobre seguridad infantil sin salir de SentryCore.</p>
    <label>Tipo de reporte
      <select value={category} disabled={status === 'sending'} onChange={event => {
        setCategory(event.target.value); submissionId.current = null;
      }}>
        <option value="support">Ayuda y comentarios</option>
        <option value="child-safety">Seguridad infantil</option>
      </select>
    </label>
    <label>Describe lo ocurrido
      <textarea value={message} required minLength={10} maxLength={5000} rows={6}
        disabled={status === 'sending'} onChange={event => {
          setMessage(event.target.value); submissionId.current = null;
        }} aria-describedby="feedback-data-help" />
    </label>
    <p id="feedback-data-help" className="feedback-note">No incluyas contraseñas, datos innecesarios de terceros ni material de abuso.
      Puedes indicar la referencia del registro que deseas reportar. No se admiten archivos ni fotos.</p>
    <label>Tu correo para recibir respuesta (opcional)
      <input type="email" autoComplete="email" value={replyEmail} maxLength={254}
        disabled={status === 'sending'} onChange={event => {
          setReplyEmail(event.target.value); submissionId.current = null;
        }} />
    </label>
    <p className="feedback-note">El reporte y el correo que indiques se envían al equipo de soporte de VoxTi Labs
      para atender tu solicitud. El formulario no adjunta tu ubicación ni fotografías. El contacto
      responsable de seguridad infantil es Bruno Urrea, service@voxtilabs.cl.</p>
    {status === 'error' ? <p role="alert" className="form-message error">{error}</p> : null}
    <button type="submit" className="primary-button" disabled={status === 'sending'}>
      {status === 'sending' ? 'Enviando…' : 'Enviar reporte'}
    </button>
  </form>;
}
