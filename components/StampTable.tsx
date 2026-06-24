import Link from "next/link";
import { AnalyzeButton } from "@/components/AnalyzeButton";

type StampRow = {
  id: string;
  cropUrl: string;
  notes: string | null;
  positionHint: string | null;
  manualCountryHint: string | null;
  manualConditionHint: string | null;
  status: string;
  country: string | null;
  era: string | null;
  condition: string | null;
  catalogHint: string | null;
  valueClass: number | null;
  valueMin: number | null;
  valueMax: number | null;
  needsExpert: boolean;
  createdAt: Date;
  page?: {
    pageNo: number;
    album?: {
      id: string;
      name: string;
    };
  };
};

type StampTableProps = {
  stamps: StampRow[];
  showAlbum?: boolean;
};

function display(value: string | number | null | undefined) {
  return value === null || value === undefined || value === "" ? "-" : value;
}

function valueRange(min: number | null, max: number | null) {
  if (min === null && max === null) return "-";
  if (min !== null && max !== null) return `${min.toFixed(2)}-${max.toFixed(2)} EUR`;
  if (min !== null) return `ab ${min.toFixed(2)} EUR`;
  return `bis ${max?.toFixed(2)} EUR`;
}

function stampStatusLabel(status: string) {
  const labels: Record<string, string> = {
    unanalysiert: "Unanalysiert",
    analysiert: "Analysiert",
    pruefbedarf: "Pruefbedarf",
    fehler: "Fehler",
  };

  return labels[status] || status;
}

function manualHints(stamp: StampRow) {
  return [
    stamp.positionHint ? `Position: ${stamp.positionHint}` : null,
    stamp.manualCountryHint ? `Land: ${stamp.manualCountryHint}` : null,
    stamp.manualConditionHint ? `Zustand: ${stamp.manualConditionHint}` : null,
    stamp.notes ? `Notiz: ${stamp.notes}` : null,
  ].filter((hint): hint is string => Boolean(hint));
}

function albumLink(stamp: StampRow) {
  if (!stamp.page?.album) return null;

  return (
    <>
      <Link href={`/alben/${stamp.page.album.id}`}>{stamp.page.album.name}</Link>
      <div className="muted">Seite {stamp.page.pageNo}</div>
    </>
  );
}

export function StampTable({ stamps, showAlbum = false }: StampTableProps) {
  if (stamps.length === 0) {
    return <p className="empty-state">Keine Marken fuer diese Ansicht erfasst.</p>;
  }

  return (
    <>
      <div className="stamp-card-list">
        {stamps.map((stamp) => {
          const hints = manualHints(stamp);

          return (
            <article className="stamp-card" key={stamp.id}>
              <a href={stamp.cropUrl} target="_blank" rel="noreferrer">
                <img
                  className="stamp-card-image"
                  src={stamp.cropUrl}
                  alt="Briefmarken-Crop"
                />
              </a>
              <div className="stamp-card-body">
                <div className="stamp-card-topline">
                  <span className={`status-badge status-${stamp.status}`}>
                    {stampStatusLabel(stamp.status)}
                  </span>
                  <span className="value-badge">
                    {stamp.valueClass === null ? "-" : stamp.valueClass}
                  </span>
                </div>
                {showAlbum && stamp.page?.album ? (
                  <div className="stamp-card-album">{albumLink(stamp)}</div>
                ) : stamp.page ? (
                  <div className="muted">Seite {stamp.page.pageNo}</div>
                ) : null}
                <dl className="stamp-facts">
                  <div>
                    <dt>Land</dt>
                    <dd>{display(stamp.country)}</dd>
                  </div>
                  <div>
                    <dt>Epoche</dt>
                    <dd>{display(stamp.era)}</dd>
                  </div>
                  <div>
                    <dt>Wert</dt>
                    <dd>{valueRange(stamp.valueMin, stamp.valueMax)}</dd>
                  </div>
                  <div>
                    <dt>Pruefbedarf</dt>
                    <dd>{stamp.needsExpert ? "ja" : "nein"}</dd>
                  </div>
                </dl>
                {hints.length > 0 ? (
                  <div className="meta-strip">
                    {hints.map((hint) => (
                      <span key={hint}>{hint}</span>
                    ))}
                  </div>
                ) : null}
                <div className="stamp-card-note">{display(stamp.catalogHint)}</div>
                <AnalyzeButton
                  stampId={stamp.id}
                  analyzed={stamp.valueClass !== null}
                />
              </div>
            </article>
          );
        })}
      </div>

      <div className="table-wrap stamp-table-desktop">
        <table>
          <thead>
            <tr>
              <th>Bild</th>
              {showAlbum ? <th>Album</th> : null}
              <th>Status</th>
              <th>Land</th>
              <th>Epoche</th>
              <th>Zustand</th>
              <th>Hinweise</th>
              <th>Kataloghinweis</th>
              <th>Wertklasse</th>
              <th>Wert von/bis</th>
              <th>Pruefbedarf</th>
              <th>Analyse</th>
            </tr>
          </thead>
          <tbody>
            {stamps.map((stamp) => {
              const hints = manualHints(stamp);

              return (
                <tr key={stamp.id}>
                  <td>
                    <a href={stamp.cropUrl} target="_blank" rel="noreferrer">
                      <img
                        className="stamp-thumb"
                        src={stamp.cropUrl}
                        alt="Briefmarken-Crop"
                      />
                    </a>
                  </td>
                  {showAlbum ? <td>{albumLink(stamp) || "-"}</td> : null}
                  <td>
                    <span className={`status-badge status-${stamp.status}`}>
                      {stampStatusLabel(stamp.status)}
                    </span>
                  </td>
                  <td>{display(stamp.country)}</td>
                  <td>{display(stamp.era)}</td>
                  <td>{display(stamp.condition)}</td>
                  <td className="wide-cell">
                    {hints.length > 0 ? hints.join("; ") : "-"}
                  </td>
                  <td className="wide-cell">{display(stamp.catalogHint)}</td>
                  <td>
                    <span className="value-badge">
                      {stamp.valueClass === null ? "-" : stamp.valueClass}
                    </span>
                  </td>
                  <td>{valueRange(stamp.valueMin, stamp.valueMax)}</td>
                  <td>{stamp.needsExpert ? "ja" : "nein"}</td>
                  <td>
                    <AnalyzeButton
                      stampId={stamp.id}
                      analyzed={stamp.valueClass !== null}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
