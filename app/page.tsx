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

  const [latestAlbum, albums, recentPages, recentStamps, expertCount] =
    await Promise.all([
      prisma.album.findFirst({
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true },
      }),
      prisma.album.findMany({
        where: albumWhere,
        orderBy: { createdAt: "desc" },
        take: search ? 12 : 8,
        include: {
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

  return (
    <>
      <header className="home-header">
        <div>
          <div className="eyebrow">Stamp Value App</div>
          <h1>Briefmarken</h1>
        </div>
        <div className="home-utilities">
          {expertCount > 0 ? (
            <span className="small-metric">{expertCount} pruefen</span>
          ) : null}
          <a className="secondary-button compact" href="/api/stamps/export">
            CSV
          </a>
        </div>
      </header>

      <nav className="home-mode-grid" aria-label="Start">
        <a className="mode-tile mode-tile-primary" href="#anlegen">
          <span>ANLEGEN</span>
          <small>Album oder Seite</small>
        </a>
        <a className="mode-tile mode-tile-secondary" href="#bearbeiten">
          <span>BEARBEITEN</span>
          <small>Suche und Alben</small>
        </a>
      </nav>

      <section className="home-section" id="anlegen">
        <div className="section-heading">
          <div>
            <h2>ANLEGEN</h2>
            <div className="muted">Neue Struktur oder neue Aufnahme.</div>
          </div>
        </div>

        <div className="create-choice-grid">
          <a className="action-tile" href="#album-anlegen">
            <span>ALBUM</span>
            <strong>Anlegen</strong>
          </a>
          {latestAlbum ? (
            <Link
              className="action-tile action-tile-warm"
              href={`/albums/${latestAlbum.id}#neue-seite`}
            >
              <span>SEITE</span>
              <strong>{latestAlbum.name}</strong>
            </Link>
          ) : (
            <a className="action-tile action-tile-warm" href="#album-anlegen">
              <span>SEITE</span>
              <strong>erst Album</strong>
            </a>
          )}
        </div>

        <section className="form-panel quick-form" id="album-anlegen">
          <h3>Album anlegen</h3>
          <form action={createAlbum} className="form-grid">
            <label className="field">
              <span>Name</span>
              <input className="input" name="name" required />
            </label>
            <label className="field">
              <span>Land-Hinweis</span>
              <input
                className="input"
                name="country"
                placeholder="z. B. Deutschland"
              />
            </label>
            <CameraCaptureField name="image" label="Albumfoto" />
            <label className="field">
              <span>Notizen</span>
              <textarea className="textarea compact-textarea" name="notes" />
            </label>
            <button className="button" type="submit">
              Album speichern
            </button>
          </form>
        </section>
      </section>

      <section className="home-section" id="bearbeiten">
        <div className="section-heading">
          <div>
            <h2>BEARBEITEN</h2>
            <div className="muted">Suchen, oeffnen, weiterarbeiten.</div>
          </div>
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

        <div className="edit-overview-grid">
          <section className="list-panel">
            <div className="list-panel-heading">
              <h3>Bestehende Alben</h3>
              <span>{albums.length}</span>
            </div>
            {albums.length === 0 ? (
              <p className="empty-state">Keine passenden Alben.</p>
            ) : (
              <div className="compact-list">
                {albums.map((album) => (
                  <Link
                    className="compact-row album-compact-row"
                    href={`/albums/${album.id}`}
                    key={album.id}
                  >
                    {album.imageUrl ? (
                      <img
                        className="compact-album-thumb"
                        src={album.imageUrl}
                        alt={`Albumfoto ${album.name}`}
                      />
                    ) : (
                      <span className="compact-album-thumb album-thumb-placeholder">
                        {album.name.slice(0, 2)}
                      </span>
                    )}
                    <span>
                      <strong>{album.name}</strong>
                      <small>{album.country || "Kein Land-Hinweis"}</small>
                    </span>
                    <em>{album._count.pages}</em>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="list-panel">
            <div className="list-panel-heading">
              <h3>Zuletzt</h3>
              <span>{recentItems.length}</span>
            </div>
            {recentItems.length === 0 ? (
              <p className="empty-state">Noch keine Bearbeitung.</p>
            ) : (
              <div className="compact-list">
                {recentItems.map((item) => (
                  <Link className="compact-row" href={item.href} key={item.key}>
                    <span>
                      <strong>{item.title}</strong>
                      <small>
                        {item.context} - {item.meta}
                      </small>
                    </span>
                    <time dateTime={item.date.toISOString()}>
                      {shortDate(item.date)}
                    </time>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>
      </section>
    </>
  );
}
