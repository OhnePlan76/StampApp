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
  const [objectType, setObjectType] = useState("albumseite");
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
        const savedObjectType = objectType === "beleg" ? "Beleg" : "Seite";

        form.reset();
        setPageNo((currentPageNo) => currentPageNo + 1);
        setObjectType("albumseite");
        setResetSignal((currentSignal) => currentSignal + 1);
        setMessage(`${savedObjectType} ${savedPageNo} gespeichert. Naechstes Bild kann gescannt werden.`);
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
        <span>Typ</span>
        <select
          className="input"
          name="objectType"
          value={objectType}
          onChange={(event) => setObjectType(event.target.value)}
        >
          <option value="albumseite">Albumseite</option>
          <option value="beleg">Brief / Beleg</option>
        </select>
      </label>
      <label className="field">
        <span>{objectType === "beleg" ? "Belegnummer" : "Seitennummer"}</span>
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
        label={objectType === "beleg" ? `Beleg ${pageNo}` : `Seite ${pageNo}`}
        mode="scan"
        captureLabel={objectType === "beleg" ? "Beleg aufnehmen" : "Seite aufnehmen"}
        startLabel="Scanner starten"
        stopLabel="Scanner beenden"
        resetSignal={resetSignal}
        required
      />
      <label className="field full-span">
        <span>{objectType === "beleg" ? "Belegvermerk" : "Seitenvermerk"}</span>
        <textarea
          className="textarea compact-textarea"
          name="notes"
          placeholder={
            objectType === "beleg"
              ? "z. B. Ersttag, Sonderstempel, vollstaendiger Brief"
              : "z. B. Rand beschaedigt, Marken unten schlecht sichtbar"
          }
        />
      </label>
      <button className="button submit-row scanner-submit" type="submit" disabled={isPending}>
        {isPending
          ? "Bild wird gespeichert..."
          : objectType === "beleg"
            ? "Beleg speichern & fortfahren"
            : "Seite speichern & fortfahren"}
      </button>
      {message ? <div className="inline-success full-span">{message}</div> : null}
      {error ? <div className="inline-error full-span">{error}</div> : null}
    </form>
  );
}
