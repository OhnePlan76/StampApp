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
  const nextPageNo =
    album.pages.length === 0
      ? 1
      : Math.max(...album.pages.map((page) => page.pageNo)) + 1;

  return (
    <>
      <header className="page-title">
        <Link href="/">Zurueck zur Albumuebersicht</Link>
        <div className="album-heading album-detail-heading">
          {album.imageUrl ? (
            <img
              className="album-cover"
              src={album.imageUrl}
              alt={`Albumfoto ${album.name}`}
            />
          ) : (
            <div className="album-cover album-thumb-placeholder">
              {album.name.slice(0, 2)}
            </div>
          )}
          <div className="album-title-copy">
            <h1>{album.name}</h1>
            <div className="muted">
              {album.country ? `${album.country} - ` : ""}
              {album.notes || "Keine Notizen"}
            </div>
          </div>
          <div className="toolbar">
            <a className="button" href="#neue-seite">
              Seite fotografieren
            </a>
            <a className="secondary-button" href="/api/stamps/export">
              CSV exportieren
            </a>
          </div>
        </div>
      </header>

      {actionError ? (
        <div className="error-banner" role="alert">
          {actionError}
        </div>
      ) : null}

      <section className="form-panel album-cover-panel" id="albumfoto">
        <h2>Albumfoto</h2>
        <form action={updateAlbumCover} className="album-cover-form">
          <input type="hidden" name="albumId" value={album.id} />
          <CameraCaptureField name="image" label="Albumfoto" />
          <button className="button" type="submit">
            Albumfoto speichern
          </button>
        </form>
      </section>

      <section className="form-panel capture-panel" id="neue-seite">
        <div className="panel-heading">
          <div>
            <h2>Albumseite erfassen</h2>
            <div className="muted">Foto aufnehmen, kurze Notiz dazu, speichern.</div>
          </div>
        </div>
        <form action={uploadPage} className="capture-form">
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
          <CameraCaptureField name="image" label="Seitenfoto" required />
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

      <section className="section" id="seitenliste">
        <h2>Seitenliste</h2>
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

      <section className="section">
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
