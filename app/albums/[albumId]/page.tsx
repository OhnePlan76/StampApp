import Link from "next/link";
import { notFound } from "next/navigation";
import { CameraCaptureField } from "@/components/CameraCaptureField";
import { PageScanForm } from "@/components/PageScanForm";
import { UploadImage } from "@/components/UploadImage";
import {
  updateAlbum,
  updateAlbumCover,
  updatePage,
  updateStamp,
  uploadStampCrop,
} from "@/lib/actions";
import { prisma } from "@/lib/prisma";
import { StampTable } from "@/components/StampTable";

type AlbumView = "summary" | "capture" | "pages" | "stamps" | "edit";

type AlbumPageProps = {
  params: Promise<{ albumId: string }> | { albumId: string };
  searchParams?:
    | Promise<{ actionError?: string; filter?: string; view?: string }>
    | { actionError?: string; filter?: string; view?: string };
};

function pageStatusLabel(status: string) {
  const labels: Record<string, string> = {
    offen: "Offen",
    teilweise_erfasst: "Teilweise erfasst",
    fertig: "Fertig",
    nachfotografieren: "Nachfotografieren",
  };

  return labels[status] || status;
}

function albumStatusLabel(status: string) {
  const labels: Record<string, string> = {
    erfassung: "Erfassung",
    auswertung: "Auswertung",
    sichtung: "Sichtung",
    fertig: "Fertig",
  };

  return labels[status] || labels.erfassung;
}

function pageAnalysisStatusLabel(status: string) {
  const labels: Record<string, string> = {
    wartet: "Wartet auf Auswertung",
    laeuft: "Auswertung laeuft",
    sichtung: "Sichtung erforderlich",
    fertig: "Auswertung fertig",
    fehler: "Auswertung fehlgeschlagen",
  };

  return labels[status] || status;
}

function albumView(value: string | undefined): AlbumView {
  if (
    value === "capture" ||
    value === "pages" ||
    value === "stamps" ||
    value === "edit"
  ) {
    return value;
  }

  return "summary";
}

function CameraGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="tile-icon">
      <path d="M8.5 5 10 3h4l1.5 2H19a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3h3.5ZM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
    </svg>
  );
}

function ArrowGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="arrow-icon">
      <path d="M13.3 5.3a1 1 0 0 1 1.4 0l6 6a1 1 0 0 1 0 1.4l-6 6a1 1 0 1 1-1.4-1.4L17.6 13H4a1 1 0 1 1 0-2h13.6l-4.3-4.3a1 1 0 0 1 0-1.4Z" />
    </svg>
  );
}

export default async function AlbumPage({
  params,
  searchParams,
}: AlbumPageProps) {
  const { albumId } = await params;
  const query = searchParams ? await searchParams : {};
  const activeView = albumView(query.view);
  const expertOnly = query.filter === "expert";
  const actionError = query.actionError;

  const album = await prisma.album.findUnique({
    where: { id: albumId },
    include: {
      pages: {
        orderBy: { pageNo: "asc" },
        include: {
          stamps: {
            orderBy: { createdAt: "desc" },
          },
        },
      },
    },
  });

  if (!album) {
    notFound();
  }

  const stamps = album.pages
    .flatMap((page) =>
      page.stamps.map((stamp) => ({
        ...stamp,
        page: {
          pageNo: page.pageNo,
        },
      })),
    )
    .filter((stamp) =>
      expertOnly ? (stamp.valueClass ?? -1) >= 4 && stamp.needsExpert : true,
    );
  const allStamps = album.pages.flatMap((page) => page.stamps);
  const stampEditors = album.pages.flatMap((page) =>
    page.stamps.map((stamp) => ({
      ...stamp,
      pageNo: page.pageNo,
    })),
  );
  const expertStampCount = allStamps.filter(
    (stamp) => (stamp.valueClass ?? -1) >= 4 && stamp.needsExpert,
  ).length;
  const rephotoPageCount = album.pages.filter(
    (page) => page.status === "nachfotografieren" || page.quality === "nachfotografieren",
  ).length;
  const openPageCount = album.pages.filter((page) => page.status === "offen").length;
  const donePageCount = album.pages.filter((page) => page.status === "fertig").length;
  const queuedAnalysisCount = album.pages.filter(
    (page) => page.analysisStatus === "wartet" || page.analysisStatus === "laeuft",
  ).length;
  const reviewPageCount = album.pages.filter(
    (page) =>
      page.analysisStatus === "sichtung" ||
      page.status === "teilweise_erfasst" ||
      page.status === "nachfotografieren",
  ).length;
  const nextPageNo =
    album.pages.length === 0
      ? 1
      : Math.max(...album.pages.map((page) => page.pageNo)) + 1;
  const reviewQueue = [
    {
      href: `/alben/${album.id}/scannen`,
      title: "Weiter scannen",
      meta: `Seite ${nextPageNo}`,
    },
    {
      href: `/alben/${album.id}/seiten`,
      title: "Hintergrundauswertung",
      meta: `${queuedAnalysisCount} Seiten`,
    },
    {
      href: `/alben/${album.id}/seiten`,
      title: "Nachbearbeiten",
      meta: `${reviewPageCount} Vermerke`,
    },
    {
      href: `/alben/${album.id}/seiten`,
      title: "Nachfotografieren",
      meta: `${rephotoPageCount} Seiten`,
    },
  ];

  return (
    <>
      <header className="album-hero">
        <Link className="back-link" href="/">
          Zurueck zur Sammlung
        </Link>
        <div className="album-hero-copy">
          <p>{album.country || "Album"}</p>
          <h1>{album.name}</h1>
          <span>{album.notes || "Album wurde fotografiert. Seiten werden im Scan-Modus archiviert."}</span>
        </div>
        <div className="album-hero-stats">
          <div>
            <strong>{album.pages.length}</strong>
            <span>Seiten</span>
          </div>
          <div>
            <strong>{albumStatusLabel(album.status)}</strong>
            <span>Status</span>
          </div>
          <div>
            <strong>{reviewPageCount}</strong>
            <span>Sichtung</span>
          </div>
        </div>
        <div className="album-hero-actions">
          <Link className="button" href={`/alben/${album.id}/scannen`}>
            Seiten scannen
          </Link>
          <Link className="secondary-button" href={`/alben/${album.id}/daten`}>
            Bearbeiten
          </Link>
        </div>
      </header>

      {actionError ? (
        <div className="error-banner" role="alert">
          {actionError}
        </div>
      ) : null}

      {activeView !== "capture" ? (
      <nav className="screen-tabs" aria-label="Albumansichten">
        <Link className={activeView === "summary" ? "active" : ""} href={`/alben/${album.id}`}>
          Uebersicht
        </Link>
        <Link
          className=""
          href={`/alben/${album.id}/scannen`}
        >
          Scannen
        </Link>
        <Link
          className={activeView === "pages" ? "active" : ""}
          href={`/alben/${album.id}/seiten`}
        >
          Seiten
        </Link>
        <Link
          className={activeView === "stamps" ? "active" : ""}
          href={`/alben/${album.id}/sichtung`}
        >
          Sichtung
        </Link>
        <Link
          className={activeView === "edit" ? "active" : ""}
          href={`/alben/${album.id}/daten`}
        >
          Daten
        </Link>
      </nav>
      ) : null}

      {activeView === "summary" ? (
        <section className="screen-panel overview-screen">
          <div className="quick-switch-grid">
            <Link className="action-tile compact-tile" href={`/alben/${album.id}/scannen`}>
              <span>Scannen</span>
              <strong>naechste Seite {nextPageNo}</strong>
            </Link>
            <Link
              className="action-tile compact-tile action-tile-warm"
              href={`/alben/${album.id}/seiten`}
            >
              <span>Seiten</span>
              <strong>{album.pages.length} erfasst</strong>
            </Link>
            <Link className="action-tile compact-tile" href={`/alben/${album.id}/sichtung`}>
              <span>Sichtung</span>
              <strong>{reviewPageCount} Vermerke</strong>
            </Link>
            <Link
              className="action-tile compact-tile action-tile-warm"
              href={`/alben/${album.id}/daten`}
            >
              <span>Archiv</span>
              <strong>{donePageCount} Seiten fertig</strong>
            </Link>
          </div>
          <section className="form-panel">
            <div className="section-heading app-section-heading">
              <div>
                <h2>Arbeitsqueue</h2>
                <div className="muted">Mobile Erfassung zuerst, Auswertung und Sichtung danach.</div>
              </div>
            </div>
            <div className="compact-list">
              {reviewQueue.map((item) => (
                <Link className="compact-row" href={item.href} key={item.title}>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.meta}</small>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        </section>
      ) : null}

      {activeView === "edit" ? (
      <section className="form-panel album-cover-panel" id="albumfoto">
        <div className="section-heading app-section-heading">
          <div>
            <h2>Albumfoto</h2>
            <div className="muted">Aktuelles Foto ansehen oder bei Bedarf ersetzen.</div>
          </div>
        </div>
        {album.imageUrl ? (
          <a
            className="album-cover-preview"
            href={album.imageUrl}
            target="_blank"
            rel="noreferrer"
          >
            <span>Aktuelles Albumfoto</span>
            <img src={album.imageUrl} alt={`Albumfoto ${album.name}`} />
          </a>
        ) : (
          <p className="empty-state">Noch kein Albumfoto gespeichert.</p>
        )}
        <details className="inline-editor cover-replace-editor">
          <summary>
            <span>{album.imageUrl ? "Albumfoto ersetzen" : "Albumfoto fotografieren"}</span>
            <small>Kamera oeffnen, Foto machen, Vorschau pruefen</small>
          </summary>
          <form action={updateAlbumCover} className="form-grid">
            <input type="hidden" name="albumId" value={album.id} />
            <CameraCaptureField
              name="image"
              label="Neues Albumfoto"
              captureLabel="Foto machen"
              startLabel="Kamera oeffnen"
              stopLabel="Kamera schliessen"
            />
            <button className="button save-button" type="submit">
              Neues Albumfoto speichern
            </button>
          </form>
        </details>
      </section>
      ) : null}

      {activeView === "edit" ? (
        <section className="screen-panel edit-screen">
          <section className="form-panel" id="albumdaten">
            <div className="section-heading app-section-heading">
              <div>
                <h2>Albumdaten</h2>
                <div className="muted">Titel, Region und Notizen bearbeiten.</div>
              </div>
            </div>
            <form action={updateAlbum} className="form-grid">
              <input type="hidden" name="albumId" value={album.id} />
              <label className="field">
                <span>Albumtitel</span>
                <input
                  className="input"
                  name="name"
                  defaultValue={album.name}
                  required
                />
              </label>
              <label className="field">
                <span>Land / Region</span>
                <input
                  className="input"
                  name="country"
                  defaultValue={album.country ?? ""}
                />
              </label>
              <label className="field">
                <span>Albumstatus</span>
                <select className="input" name="status" defaultValue={album.status}>
                  <option value="erfassung">Erfassung</option>
                  <option value="auswertung">Auswertung</option>
                  <option value="sichtung">Sichtung</option>
                  <option value="fertig">Fertig</option>
                </select>
              </label>
              <label className="field">
                <span>Notizen</span>
                <textarea
                  className="textarea compact-textarea"
                  name="notes"
                  defaultValue={album.notes ?? ""}
                />
              </label>
              <button className="button save-button" type="submit">
                Albumdaten speichern
              </button>
            </form>
          </section>

          <section className="form-panel" id="seiten-bearbeiten">
            <div className="section-heading app-section-heading">
              <div>
                <h2>Seiten bearbeiten</h2>
                <div className="muted">Nummer, Status, Qualitaet, Auswertung und Notiz.</div>
              </div>
            </div>
            {album.pages.length === 0 ? (
              <p className="empty-state">Noch keine Seiten vorhanden.</p>
            ) : (
              <div className="editor-stack">
                {album.pages.map((page) => (
                  <details className="inline-editor" key={page.id}>
                    <summary>
                      <span>Seite {page.pageNo}</span>
                      <small>{pageStatusLabel(page.status)}</small>
                    </summary>
                    <form action={updatePage} className="edit-grid">
                      <input type="hidden" name="albumId" value={album.id} />
                      <input type="hidden" name="pageId" value={page.id} />
                      <label className="field">
                        <span>Seitennummer</span>
                        <input
                          className="input"
                          type="number"
                          min="1"
                          name="pageNo"
                          defaultValue={page.pageNo}
                          required
                        />
                      </label>
                      <label className="field">
                        <span>Status</span>
                        <select className="input" name="status" defaultValue={page.status}>
                          <option value="offen">Offen</option>
                          <option value="teilweise_erfasst">Teilweise erfasst</option>
                          <option value="fertig">Fertig</option>
                          <option value="nachfotografieren">Nachfotografieren</option>
                        </select>
                      </label>
                      <label className="field">
                        <span>Qualitaet</span>
                        <select
                          className="input"
                          name="quality"
                          defaultValue={page.quality ?? ""}
                        >
                          <option value="">Keine Angabe</option>
                          <option value="gut">gut</option>
                          <option value="schief">schief</option>
                          <option value="unscharf">unscharf</option>
                          <option value="nachfotografieren">nachfotografieren</option>
                          <option value="unbekannt">unbekannt</option>
                        </select>
                      </label>
                      <label className="field">
                        <span>Auswertung</span>
                        <input
                          className="input"
                          value={pageAnalysisStatusLabel(page.analysisStatus)}
                          readOnly
                        />
                      </label>
                      <label className="field full-span">
                        <span>Seitennotiz</span>
                        <textarea
                          className="textarea compact-textarea"
                          name="notes"
                          defaultValue={page.notes ?? ""}
                        />
                      </label>
                      <button className="button submit-row" type="submit">
                        Seite speichern
                      </button>
                    </form>
                  </details>
                ))}
              </div>
            )}
          </section>

          <section className="form-panel" id="marken-bearbeiten">
            <div className="section-heading app-section-heading">
              <div>
                <h2>Einzelpruefungen bearbeiten</h2>
                <div className="muted">Ausnahmen, Hinweise und Wertdaten pflegen.</div>
              </div>
            </div>
            {stampEditors.length === 0 ? (
              <p className="empty-state">Noch keine Einzelpruefungen vorhanden.</p>
            ) : (
              <div className="editor-stack">
                {stampEditors.map((stamp) => (
                  <details className="inline-editor stamp-editor" key={stamp.id}>
                    <summary>
                      <img src={stamp.cropUrl} alt="Briefmarken-Crop" />
                      <span>
                        {stamp.manualCountryHint ||
                          stamp.country ||
                          stamp.positionHint ||
                          "Marke"}
                      </span>
                      <small>Seite {stamp.pageNo}</small>
                    </summary>
                    <form action={updateStamp} className="edit-grid stamp-edit-grid">
                      <input type="hidden" name="albumId" value={album.id} />
                      <input type="hidden" name="stampId" value={stamp.id} />
                      <label className="field">
                        <span>Status</span>
                        <select className="input" name="status" defaultValue={stamp.status}>
                          <option value="unanalysiert">Unanalysiert</option>
                          <option value="analysiert">Analysiert</option>
                          <option value="pruefbedarf">Pruefbedarf</option>
                          <option value="fehler">Fehler</option>
                        </select>
                      </label>
                      <label className="field">
                        <span>Position</span>
                        <input
                          className="input"
                          name="positionHint"
                          defaultValue={stamp.positionHint ?? ""}
                        />
                      </label>
                      <label className="field">
                        <span>Land-Hinweis</span>
                        <input
                          className="input"
                          name="manualCountryHint"
                          defaultValue={stamp.manualCountryHint ?? ""}
                        />
                      </label>
                      <label className="field">
                        <span>Zustand-Hinweis</span>
                        <input
                          className="input"
                          name="manualConditionHint"
                          defaultValue={stamp.manualConditionHint ?? ""}
                        />
                      </label>
                      <label className="field">
                        <span>Land</span>
                        <input
                          className="input"
                          name="country"
                          defaultValue={stamp.country ?? ""}
                        />
                      </label>
                      <label className="field">
                        <span>Epoche</span>
                        <input className="input" name="era" defaultValue={stamp.era ?? ""} />
                      </label>
                      <label className="field">
                        <span>Nennwert</span>
                        <input
                          className="input"
                          name="denomination"
                          defaultValue={stamp.denomination ?? ""}
                        />
                      </label>
                      <label className="field">
                        <span>Motiv</span>
                        <input
                          className="input"
                          name="motive"
                          defaultValue={stamp.motive ?? ""}
                        />
                      </label>
                      <label className="field">
                        <span>Verwendung</span>
                        <input
                          className="input"
                          name="usedState"
                          defaultValue={stamp.usedState ?? ""}
                        />
                      </label>
                      <label className="field">
                        <span>Zustand</span>
                        <input
                          className="input"
                          name="condition"
                          defaultValue={stamp.condition ?? ""}
                        />
                      </label>
                      <label className="field">
                        <span>Wertklasse</span>
                        <input
                          className="input"
                          type="number"
                          min="1"
                          max="5"
                          name="valueClass"
                          defaultValue={stamp.valueClass ?? ""}
                        />
                      </label>
                      <label className="field">
                        <span>Wert min</span>
                        <input
                          className="input"
                          inputMode="decimal"
                          name="valueMin"
                          defaultValue={stamp.valueMin ?? ""}
                        />
                      </label>
                      <label className="field">
                        <span>Wert max</span>
                        <input
                          className="input"
                          inputMode="decimal"
                          name="valueMax"
                          defaultValue={stamp.valueMax ?? ""}
                        />
                      </label>
                      <label className="check-field">
                        <input
                          type="checkbox"
                          name="needsExpert"
                          defaultChecked={stamp.needsExpert}
                        />
                        <span>Pruefbedarf</span>
                      </label>
                      <label className="field full-span">
                        <span>Kataloghinweis</span>
                        <textarea
                          className="textarea compact-textarea"
                          name="catalogHint"
                          defaultValue={stamp.catalogHint ?? ""}
                        />
                      </label>
                      <label className="field full-span">
                        <span>Notiz</span>
                        <textarea
                          className="textarea compact-textarea"
                          name="notes"
                          defaultValue={stamp.notes ?? ""}
                        />
                      </label>
                      <button className="button submit-row" type="submit">
                        Marke speichern
                      </button>
                    </form>
                  </details>
                ))}
              </div>
            )}
          </section>
        </section>
      ) : null}

      {activeView === "capture" ? (
      <section className="capture-callout scanner-mode" id="neue-seite">
        <div className="capture-callout-top">
          <span className="primary-action-icon">
            <CameraGlyph />
          </span>
          <div>
            <h2>Seite {nextPageNo} scannen</h2>
            <p>Kamera bleibt offen - Seite speichern und fortfahren</p>
          </div>
          <Link className="scanner-finish-link" href={`/alben/${album.id}/seiten`}>
            Fertig
          </Link>
        </div>
        <PageScanForm albumId={album.id} initialPageNo={nextPageNo} />
      </section>
      ) : null}

      {activeView === "pages" ? (
      <section className="section page-section" id="seitenliste">
        <div className="section-heading app-section-heading">
          <div>
            <h2>Seitenliste</h2>
            <div className="muted">Archivierte Seiten, Auswertungsstatus und Nachbearbeitungsvermerke.</div>
          </div>
        </div>
        {album.pages.length === 0 ? (
          <p className="empty-state">Noch keine Seiten hochgeladen.</p>
        ) : (
          <div className="page-list">
            {album.pages.map((page) => (
              <article className="page-row" id={`seite-${page.id}`} key={page.id}>
                <a
                  className="page-image-link"
                  href={page.imageUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <UploadImage
                    className="page-thumb"
                    src={page.imageUrl}
                    alt={`Albumseite ${page.pageNo}`}
                    fallbackText="Seite neu fotografieren"
                  />
                </a>
                <div>
                  <div className="page-row-header">
                    <div>
                      <h3>Seite {page.pageNo}</h3>
                      <div className="muted">
                        {pageAnalysisStatusLabel(page.analysisStatus)}
                      </div>
                    </div>
                    <span className={`status-badge status-${page.status}`}>
                      {pageStatusLabel(page.status)}
                    </span>
                  </div>
                  <div className="meta-strip">
                    {page.quality ? <span>Qualitaet: {page.quality}</span> : null}
                    <span>Auswertung: {pageAnalysisStatusLabel(page.analysisStatus)}</span>
                    {page.analysisNotes ? <span>Vermerk: {page.analysisNotes}</span> : null}
                    {page.notes ? <span>Notiz: {page.notes}</span> : null}
                  </div>
                  <details className="inline-editor crop-editor">
                    <summary>
                      <span>Ausnahme: Einzelmarke pruefen</span>
                      <small>bei KI-Hinweis oder Nutzerwunsch</small>
                    </summary>
                  <form action={uploadStampCrop} className="stamp-capture-form">
                    <input type="hidden" name="albumId" value={album.id} />
                    <input type="hidden" name="pageId" value={page.id} />
                    <CameraCaptureField name="crop" label="Einzelmarke" required />
                    <label className="field">
                      <span>Position</span>
                      <input
                        className="input"
                        name="positionHint"
                        placeholder="z. B. oben links"
                      />
                    </label>
                    <label className="field">
                      <span>Land-Hinweis</span>
                      <input
                        className="input"
                        name="manualCountryHint"
                        placeholder="z. B. Deutsches Reich"
                      />
                    </label>
                    <label className="field">
                      <span>Zustand-Hinweis</span>
                      <input
                        className="input"
                        name="manualConditionHint"
                        placeholder="z. B. Falz, Zahnfehler"
                      />
                    </label>
                    <label className="field full-span">
                      <span>Pruefnotiz</span>
                      <textarea
                        className="textarea compact-textarea"
                        name="notes"
                        placeholder="Auffaelligkeiten, Vermutung, Rueckseite pruefen ..."
                      />
                    </label>
                    <button className="button" type="submit">
                      Einzelpruefung speichern
                    </button>
                  </form>
                  </details>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      ) : null}

      {activeView === "stamps" ? (
      <section className="section stamp-section">
        <div className="topbar">
          <div>
            <h2>Einzelpruefungen in diesem Album</h2>
            <div className="muted">
              {expertOnly
                ? "Gefiltert: Wertklasse ab 4 und Pruefbedarf ja"
                : "Nur manuell angelegte Ausnahmen und KI-Pruefkandidaten"}
            </div>
          </div>
          <div className="toolbar">
            <Link
              className={`secondary-button ${expertOnly ? "active" : ""}`}
              href={
                expertOnly
                  ? `/alben/${album.id}/sichtung`
                  : `/alben/${album.id}/sichtung?filter=expert`
              }
            >
              Wertklasse &gt;= 4 + Pruefbedarf
            </Link>
            <a className="secondary-button" href="/api/stamps/export">
              CSV exportieren
            </a>
          </div>
        </div>
        <StampTable stamps={stamps} />
      </section>
      ) : null}
    </>
  );
}
