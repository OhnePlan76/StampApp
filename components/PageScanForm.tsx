"use client";

import { type FormEvent, useRef, useState, useTransition } from "react";
import { uploadPage } from "@/lib/actions";
import { CameraCaptureField } from "@/components/CameraCaptureField";

type PageScanFormProps = {
  albumId: string;
  initialPageNo: number;
};

export function PageScanForm({ albumId, initialPageNo }: PageScanFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pageNo, setPageNo] = useState(initialPageNo);
  const [resetSignal, setResetSignal] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = formRef.current;

    if (!form) return;

    const formData = new FormData(form);
    formData.set("pageNo", String(pageNo));
    setError(null);
    setMessage(null);

    startTransition(async () => {
      try {
        await uploadPage(formData);
        const savedPageNo = pageNo;

        form.reset();
        setPageNo((currentPageNo) => currentPageNo + 1);
        setResetSignal((currentSignal) => currentSignal + 1);
        setMessage(`Seite ${savedPageNo} gespeichert. Naechste Seite kann gescannt werden.`);
      } catch (currentError) {
        setError(
          currentError instanceof Error
            ? currentError.message
            : "Seite konnte nicht gespeichert werden.",
        );
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={submit} className="capture-form album-capture-form">
      <input type="hidden" name="albumId" value={albumId} />
      <label className="field">
        <span>Seitennummer</span>
        <input
          className="input"
          type="number"
          name="pageNo"
          min="1"
          value={pageNo}
          onChange={(event) => setPageNo(Number(event.target.value))}
          required
        />
      </label>
      <CameraCaptureField
        name="image"
        label={`Seite ${pageNo}`}
        mode="scan"
        captureLabel="Seite aufnehmen"
        startLabel="Scanner starten"
        stopLabel="Scanner beenden"
        resetSignal={resetSignal}
        required
      />
      <label className="field full-span">
        <span>Seitenvermerk</span>
        <textarea
          className="textarea compact-textarea"
          name="notes"
          placeholder="z. B. Rand beschaedigt, Marken unten schlecht sichtbar"
        />
      </label>
      <button className="button submit-row scanner-submit" type="submit" disabled={isPending}>
        {isPending ? "Seite wird gespeichert..." : "Seite speichern & fortfahren"}
      </button>
      {message ? <div className="inline-success full-span">{message}</div> : null}
      {error ? <div className="inline-error full-span">{error}</div> : null}
    </form>
  );
}
