import Link from "next/link";
import { notFound } from "next/navigation";
import { CameraCaptureField } from "@/components/CameraCaptureField";
import { updateAlbumCover, uploadPage, uploadStampCrop } from "@/lib/actions";
import { prisma } from "@/lib/prisma";
import { StampTable } from "@/components/StampTable";

type AlbumPageProps = {
  params: Promise<{ albumId: string }> | { albumId: string };
  searchParams?:
    | Promise<{ actionError?: string; filter?: string }>
    | { actionError?: string; filter?: string };
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
  const expertStampCount = allStamps.filter(
    (stamp) => (stamp.valueClass ?? -1) >= 4 && stamp.needsExpert,
  ).length;
  const nextPageNo =
    album.pages.length === 0
      ? 1
      : Math.max(...album.pages.map((page) => page.pageNo)) + 1;

  return (
    <>
      <header className="album-hero">
        <Link className="back-link" href="/">
          Zurueck zur Sammlung
        </Link>
        <div className="album-hero-copy">
          <p>{album.country || "Album"}</p>
          <h1>{album.name}</h1>
          <span>{album.notes || "Seiten fotografieren und Marken einzeln erfassen."}</span>
        </div>
        <div className="album-hero-stats">
          <div>
            <strong>{album.pages.length}</strong>
            <span>Seiten</span>
          </div>
          <div>
            <strong>{allStamps.length}</strong>
            <span>Marken</span>
          </div>
          <div>
            <strong>{expertStampCount}</strong>
            <span>Pruefen</span>
          </div>
        </div>
        <div className="album-hero-actions">
          <a className="button" href="#neue-seite">
            Seite fotografieren
          </a>
          <a className="secondary-button" href="/api/stamps/export">
            CSV exportieren
          </a>
        </div>
      </header>

      {actionError ? (
        <div className="error-banner" role="alert">
          {actionError}
        </div>
      ) : null}

      <section className="form-panel album-cover-panel" id="albumfoto">
        <div className="section-heading app-section-heading">
          <div>
            <h2>Albumfoto</h2>
            <div className="muted">Cover aktualisieren oder nachtraeglich aufnehmen.</div>
          </div>
        </div>
        <form action={updateAlbumCover} className="form-grid">
          <input type="hidden" name="albumId" value={album.id} />
          {album.imageUrl ? (
            <a
              className="album-cover-preview"
              href={album.imageUrl}
              target="_blank"
              rel="noreferrer"
            >
              <img src={album.imageUrl} alt={`Albumfoto ${album.name}`} />
            </a>
          ) : null}
          <CameraCaptureField name="image" label="Albumfoto" />
          <button className="button save-button" type="submit">
            Albumfoto speichern
          </button>
        </form>
      </section>

      <section className="capture-callout" id="neue-seite">
        <div className="capture-callout-top">
          <span className="primary-action-icon">
            <CameraGlyph />
          </span>
          <div>
            <h2>Albumseite erfassen</h2>
            <p>Foto aufnehmen - Seite beschreiben - Marken spaeter zuschneiden</p>
          </div>
          <ArrowGlyph />
        </div>
        <form action={uploadPage} className="capture-form album-capture-form">
          <input type="hidden" name="albumId" value={album.id} />
          <label className="field">
            <span>Seitennummer</span>
            <input
              className="input"
              type="number"
              name="pageNo"
              min="1"
              defaultValue={nextPageNo}
              required
            />
          </label>
          <CameraCaptureField name="image" label="Foto" required />
          <label className="field">
            <span>Aufnahmequalitaet</span>
            <select className="input" name="quality" defaultValue="gut">
              <option value="gut">gut</option>
              <option value="schief">schief</option>
              <option value="unscharf">unscharf</option>
              <option value="nachfotografieren">nachfotografieren</option>
              <option value="unbekannt">unbekannt</option>
            </select>
          </label>
          <label className="field full-span">
            <span>Seitennotiz</span>
            <textarea
              className="textarea compact-textarea"
              name="notes"
              placeholder="z. B. Rand beschaedigt, Marken unten schlecht sichtbar"
            />
          </label>
          <button className="button submit-row" type="submit">
            Seite speichern & weiter
          </button>
        </form>
      </section>

      <section className="section page-section" id="seitenliste">
        <div className="section-heading app-section-heading">
          <div>
            <h2>Seitenliste</h2>
            <div className="muted">Scans, Qualitaet und Einzelmarken.</div>
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
                  <img
                    className="page-thumb"
                    src={page.imageUrl}
                    alt={`Albumseite ${page.pageNo}`}
                  />
                </a>
                <div>
                  <div className="page-row-header">
                    <div>
                      <h3>Seite {page.pageNo}</h3>
                      <div className="muted">{page.stamps.length} Marken-Crops</div>
                    </div>
                    <span className={`status-badge status-${page.status}`}>
                      {pageStatusLabel(page.status)}
                    </span>
                  </div>
                  <div className="meta-strip">
                    {page.quality ? <span>Qualitaet: {page.quality}</span> : null}
                    {page.notes ? <span>Notiz: {page.notes}</span> : null}
                  </div>
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
                      <span>Markennotiz</span>
                      <textarea
                        className="textarea compact-textarea"
                        name="notes"
                        placeholder="Auffaelligkeiten, Vermutung, Rueckseite pruefen ..."
                      />
                    </label>
                    <button className="button" type="submit">
                      Marke speichern
                    </button>
                  </form>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="section stamp-section">
        <div className="topbar">
          <div>
            <h2>Marken in diesem Album</h2>
            <div className="muted">
              {expertOnly
                ? "Gefiltert: Wertklasse ab 4 und Pruefbedarf ja"
                : "Alle manuell angelegten Marken-Crops"}
            </div>
          </div>
          <div className="toolbar">
            <Link
              className={`secondary-button ${expertOnly ? "active" : ""}`}
              href={
                expertOnly
                  ? `/albums/${album.id}`
                  : `/albums/${album.id}?filter=expert`
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
    </>
  );
}
