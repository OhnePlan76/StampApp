import Link from "next/link";
import { CameraCaptureField } from "@/components/CameraCaptureField";
import { createAlbum } from "@/lib/actions";
import { prisma } from "@/lib/prisma";
import { StampTable } from "@/components/StampTable";

type HomeProps = {
  searchParams?: Promise<{ filter?: string }> | { filter?: string };
};

export default async function Home({ searchParams }: HomeProps) {
  const params = searchParams ? await searchParams : {};
  const expertOnly = params.filter === "expert";

  const [albums, stamps] = await Promise.all([
    prisma.album.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: {
            pages: true,
          },
        },
      },
    }),
    prisma.stamp.findMany({
      where: expertOnly
        ? {
            valueClass: {
              gte: 4,
            },
            needsExpert: true,
          }
        : undefined,
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
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const latestAlbum = albums[0];

  return (
    <>
      <header className="topbar">
        <div>
          <h1>Stamp Value App</h1>
          <div className="muted">
            Erfassung und grobe Bewertung grosser Briefmarkensammlungen
          </div>
        </div>
        <div className="toolbar">
          {latestAlbum ? (
            <Link className="button" href={`/albums/${latestAlbum.id}`}>
              Weiter erfassen
            </Link>
          ) : null}
          <a className="secondary-button" href="/api/stamps/export">
            CSV exportieren
          </a>
        </div>
      </header>

      <div className="grid">
        <section className="form-panel">
          <h2>Album anlegen</h2>
          <form action={createAlbum} className="form-grid">
            <label className="field">
              <span>Name</span>
              <input className="input" name="name" required />
            </label>
            <label className="field">
              <span>Land-Hinweis</span>
              <input className="input" name="country" placeholder="z. B. Deutschland" />
            </label>
            <CameraCaptureField name="image" label="Albumfoto" />
            <label className="field">
              <span>Notizen</span>
              <textarea className="textarea" name="notes" />
            </label>
            <button className="button" type="submit">
              Album speichern
            </button>
          </form>
        </section>

        <section>
          <h2>Albumuebersicht</h2>
          {albums.length === 0 ? (
            <p className="empty-state">Noch keine Alben angelegt.</p>
          ) : (
            <div>
              <div className="album-card-list">
                {albums.map((album) => (
                  <article className="album-card" key={album.id}>
                    {album.imageUrl ? (
                      <img
                        className="album-thumb"
                        src={album.imageUrl}
                        alt={`Albumfoto ${album.name}`}
                      />
                    ) : (
                      <div className="album-thumb album-thumb-placeholder">
                        {album.name.slice(0, 2)}
                      </div>
                    )}
                    <div>
                      <h3>
                        <Link href={`/albums/${album.id}`}>{album.name}</Link>
                      </h3>
                      <div className="muted">
                        {album.country || "Kein Land-Hinweis"} - {album._count.pages} Seiten
                      </div>
                    </div>
                    <div className="album-card-note">{album.notes || "Keine Notizen"}</div>
                    <Link className="secondary-button" href={`/albums/${album.id}`}>
                      Oeffnen
                    </Link>
                  </article>
                ))}
              </div>
              <div className="table-wrap album-table-desktop">
                <table>
                  <thead>
                    <tr>
                      <th>Bild</th>
                      <th>Name</th>
                      <th>Land-Hinweis</th>
                      <th>Seiten</th>
                      <th>Notizen</th>
                      <th>Angelegt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {albums.map((album) => (
                      <tr key={album.id}>
                        <td>
                          {album.imageUrl ? (
                            <img
                              className="album-thumb compact-thumb"
                              src={album.imageUrl}
                              alt={`Albumfoto ${album.name}`}
                            />
                          ) : (
                            <div className="album-thumb compact-thumb album-thumb-placeholder">
                              {album.name.slice(0, 2)}
                            </div>
                          )}
                        </td>
                        <td>
                          <Link href={`/albums/${album.id}`}>{album.name}</Link>
                        </td>
                        <td>{album.country || "-"}</td>
                        <td>{album._count.pages}</td>
                        <td className="wide-cell">{album.notes || "-"}</td>
                        <td>{album.createdAt.toLocaleDateString("de-DE")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>

      <section className="section">
        <div className="topbar">
          <div>
            <h2>Alle Marken</h2>
            <div className="muted">
              {expertOnly
                ? "Gefiltert: Wertklasse ab 4 und Pruefbedarf ja"
                : "Alle manuell angelegten Marken-Crops"}
            </div>
          </div>
          <div className="toolbar">
            <Link
              className={`secondary-button ${expertOnly ? "active" : ""}`}
              href={expertOnly ? "/" : "/?filter=expert"}
            >
              Wertklasse &gt;= 4 + Pruefbedarf
            </Link>
          </div>
        </div>
        <StampTable stamps={stamps} showAlbum />
      </section>
    </>
  );
}
