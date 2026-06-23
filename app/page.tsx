import Link from "next/link";
import { CameraCaptureField } from "@/components/CameraCaptureField";
import { createAlbum } from "@/lib/actions";
import { prisma } from "@/lib/prisma";

type HomeProps = {
  searchParams?: Promise<{ q?: string }> | { q?: string };
};

function shortDate(date: Date) {
  return date.toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
  });
}

function compactNumber(value: number) {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}K`;
  }

  return String(value);
}

function albumStatus(pageCount: number) {
  if (pageCount === 0) {
    return {
      className: "status-pill status-pill-waiting",
      label: "Ausstehend",
    };
  }

  return {
    className: "status-pill status-pill-review",
    label: "In Pruefung",
  };
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

function StampFallback() {
  return (
    <div className="album-thumb-fallback" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path d="M7 3h10a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4V5a2 2 0 0 1 2-2Zm2 4v3h6V7H9Zm0 6v2h6v-2H9Z" />
      </svg>
    </div>
  );
}

export default async function Home({ searchParams }: HomeProps) {
  const params = searchParams ? await searchParams : {};
  const search = typeof params.q === "string" ? params.q.trim() : "";
  const albumWhere = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { country: { contains: search, mode: "insensitive" as const } },
          { notes: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : undefined;

  const [
    latestAlbum,
    albums,
    recentPages,
    recentStamps,
    expertCount,
    albumCount,
    stampCount,
  ] = await Promise.all([
    prisma.album.findFirst({
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true },
    }),
    prisma.album.findMany({
      where: albumWhere,
      orderBy: { createdAt: "desc" },
      take: search ? 12 : 8,
      include: {
        pages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            imageUrl: true,
          },
        },
        _count: {
          select: {
            pages: true,
          },
        },
      },
    }),
    prisma.page.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      include: {
        album: {
          select: {
            id: true,
            name: true,
          },
        },
        _count: {
          select: {
            stamps: true,
          },
        },
      },
    }),
    prisma.stamp.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      include: {
        page: {
          select: {
            pageNo: true,
            album: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    }),
    prisma.stamp.count({
      where: {
        valueClass: {
          gte: 4,
        },
        needsExpert: true,
      },
    }),
    prisma.album.count(),
    prisma.stamp.count(),
  ]);

  const recentItems = [
    ...recentPages.map((page) => ({
      key: `page-${page.id}`,
      href: `/albums/${page.album.id}#seite-${page.id}`,
      title: `Seite ${page.pageNo}`,
      context: page.album.name,
      meta: `${page._count.stamps} Marken`,
      date: page.createdAt,
    })),
    ...recentStamps.map((stamp) => ({
      key: `stamp-${stamp.id}`,
      href: `/albums/${stamp.page.album.id}`,
      title:
        stamp.manualCountryHint ||
        stamp.country ||
        stamp.positionHint ||
        "Marke",
      context: `${stamp.page.album.name} - Seite ${stamp.page.pageNo}`,
      meta:
        stamp.valueClass === null
          ? "unanalysiert"
          : `Wertklasse ${stamp.valueClass}`,
      date: stamp.createdAt,
    })),
  ]
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 6);
  const progress = Math.min(100, Math.max(albumCount > 0 ? 12 : 4, albumCount * 8));

  return (
    <>
      <header className="home-hero">
        <div className="home-hero-copy">
          <p>Privates Erfassungsprojekt</p>
          <h1>Ihr Briefmarken-Katalog</h1>
          <span>Alben fotografieren, Marken auswerten, Prueffalle sammeln.</span>
        </div>
        <div className="progress-panel" aria-label="Erfassungsfortschritt">
          <div>
            <strong>Fortschritt</strong>
            <span>{albumCount} Alben erfasst</span>
          </div>
          <div className="progress-track">
            <span style={{ width: `${progress}%` }} />
          </div>
        </div>
      </header>

      <Link className="primary-action-card" href="#album-anlegen">
        <span className="primary-action-icon">
          <CameraGlyph />
        </span>
        <span className="primary-action-copy">
          <strong>Neues Album erfassen</strong>
          <small>Kamera starten - KI-Bewertung - Archivieren</small>
        </span>
        <ArrowGlyph />
      </Link>

      <section className="stat-grid" aria-label="Sammlungskennzahlen">
        <div className="stat-card">
          <strong>{compactNumber(albumCount)}</strong>
          <span>Alben</span>
        </div>
        <div className="stat-card">
          <strong>{compactNumber(stampCount)}</strong>
          <span>Marken</span>
        </div>
        <div className="stat-card">
          <strong>{compactNumber(expertCount)}</strong>
          <span>Pruefen</span>
        </div>
      </section>

      <section className="home-section album-overview" id="bearbeiten">
        <div className="section-heading app-section-heading">
          <div>
            <h2>Letzte Alben</h2>
            <div className="muted">Schnell weiterarbeiten oder durchsuchen.</div>
          </div>
          <a className="text-link" href="/#bearbeiten">
            Alle ansehen
          </a>
        </div>

        <form action="/" className="search-form">
          <label className="field search-field">
            <span>Suche</span>
            <input
              className="input search-input"
              name="q"
              defaultValue={search}
              placeholder="Album, Land, Notiz"
            />
          </label>
          <button className="button search-button" type="submit">
            Suchen
          </button>
          {search ? (
            <Link className="secondary-button search-reset" href="/">
              Zuruecksetzen
            </Link>
          ) : null}
        </form>

        {albums.length === 0 ? (
          <p className="empty-state">Keine passenden Alben.</p>
        ) : (
          <div className="album-card-list">
            {albums.map((album) => {
              const preview = album.imageUrl || album.pages[0]?.imageUrl;
              const status = albumStatus(album._count.pages);

              return (
                <article className="album-card" key={album.id}>
                  <div className="album-card-main">
                    <Link className="album-image-link" href={`/albums/${album.id}`}>
                      {preview ? (
                        <img
                          className="album-thumb"
                          src={preview}
                          alt={`Vorschau ${album.name}`}
                        />
                      ) : (
                        <StampFallback />
                      )}
                    </Link>
                    <div className="album-card-copy">
                      <Link href={`/albums/${album.id}`}>
                        <h3>{album.name}</h3>
                      </Link>
                      <span className={status.className}>{status.label}</span>
                      <p>
                        {album.country || album.notes || "Noch keine Details"} -{" "}
                        {album._count.pages} Seiten - {shortDate(album.createdAt)}
                      </p>
                    </div>
                  </div>
                  <div className="album-card-actions">
                    <Link href={`/albums/${album.id}#neue-seite`}>
                      Seiten scannen
                    </Link>
                    <Link href={`/albums/${album.id}`}>Oeffnen</Link>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="home-section create-section" id="album-anlegen">
        <div className="section-heading app-section-heading">
          <div>
            <h2>Neues Album hinzufuegen</h2>
            <div className="muted">Praezise benennen und direkt weiter erfassen.</div>
          </div>
          {latestAlbum ? (
            <Link className="secondary-button compact" href={`/albums/${latestAlbum.id}#neue-seite`}>
              Seite zu {latestAlbum.name}
            </Link>
          ) : null}
        </div>

        <section className="form-panel quick-form">
          <form action={createAlbum} className="form-grid">
            <label className="field">
              <span>Albumtitel</span>
              <input
                className="input large-input"
                name="name"
                placeholder="z. B. Deutsches Reich 1930-1945"
                required
              />
            </label>
            <label className="field">
              <span>Land / Region</span>
              <input
                className="input"
                name="country"
                placeholder="z. B. Deutschland"
              />
            </label>
            <CameraCaptureField name="image" label="Albumfoto" />
            <label className="field">
              <span>Notizen</span>
              <textarea
                className="textarea compact-textarea"
                name="notes"
                placeholder="Herkunft, Zustand, besondere Marken..."
              />
            </label>
            <button className="button save-button" type="submit">
              Album speichern & oeffnen
            </button>
          </form>
        </section>
      </section>

      <section className="home-section recent-section">
        <div className="section-heading app-section-heading">
          <div>
            <h2>Aktivitaet</h2>
            <div className="muted">Zuletzt hinzugefuegte Seiten und Marken.</div>
          </div>
          <a className="secondary-button compact" href="/api/stamps/export">
            CSV
          </a>
        </div>

        {recentItems.length === 0 ? (
          <p className="empty-state">Noch keine Bearbeitung.</p>
        ) : (
          <div className="compact-list recent-list">
            {recentItems.map((item) => (
              <Link className="compact-row" href={item.href} key={item.key}>
                <span>
                  <strong>{item.title}</strong>
                  <small>
                    {item.context} - {item.meta}
                  </small>
                </span>
                <time dateTime={item.date.toISOString()}>{shortDate(item.date)}</time>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
