'use client';

import { useRef, useState } from 'react';

import { ChildSafetyStandards } from './child-safety-standards';
import { FeedbackForm } from './feedback-form';

export function HelpButton() {
  const dialog = useRef<HTMLDialogElement>(null);
  const [opened, setOpened] = useState(false);
  return <>
    <button type="button" className="secondary-button help-button" onClick={() => {
      setOpened(true); dialog.current?.showModal();
    }}>Ayuda y reportes</button>
    <dialog ref={dialog} className="feedback-dialog" aria-labelledby="feedback-heading">
      <div className="feedback-dialog-header">
        <h2 id="feedback-heading">Ayuda y reportes</h2>
        <button className="secondary-button" type="button" onClick={() => dialog.current?.close()}>Volver a la app</button>
      </div>
      {opened ? <FeedbackForm /> : null}
      <details className="feedback-standards">
        <summary>Ver estándares de seguridad infantil</summary>
        <ChildSafetyStandards />
      </details>
    </dialog>
  </>;
}
