import type { QueryResponse, CrimeResult } from "../App";

interface Props {
  result: QueryResponse;
}

const CATEGORY_LABELS: Record<string, string> = {
  "all-crime": "All Crime",
  "anti-social-behaviour": "Anti-Social Behaviour",
  "bicycle-theft": "Bicycle Theft",
  burglary: "Burglary",
  "criminal-damage-arson": "Criminal Damage & Arson",
  drugs: "Drugs",
  "other-theft": "Other Theft",
  "possession-of-weapons": "Possession of Weapons",
  "public-order": "Public Order",
  robbery: "Robbery",
  shoplifting: "Shoplifting",
  "theft-from-the-person": "Theft from Person",
  "vehicle-crime": "Vehicle Crime",
  "violent-crime": "Violent Crime",
  "other-crime": "Other Crime",
};

function formatDate(yyyymm: string) {
  const [year, month] = yyyymm.split("-");
  return new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString(
    "en-GB",
    {
      month: "long",
      year: "numeric",
    },
  );
}

function BarChart({ crimes }: { crimes: CrimeResult[] }) {
  const counts: Record<string, number> = {};
  for (const c of crimes) {
    counts[c.street] = (counts[c.street] ?? 0) + 1;
  }

  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12);

  const max = sorted[0]?.[1] ?? 1;

  return (
    <div className="chart">
      {sorted.map(([street, count]) => (
        <div key={street} className="chart-row">
          <span className="chart-label">
            {street.replace("On or near ", "")}
          </span>
          <div className="chart-bar-wrap">
            <div
              className="chart-bar"
              style={{ width: `${(count / max) * 100}%` }}
            />
            <span className="chart-count">{count}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function Table({ crimes }: { crimes: CrimeResult[] }) {
  return (
    <div className="table-wrap">
      <table className="results-table">
        <thead>
          <tr>
            <th>Category</th>
            <th>Street</th>
            <th>Month</th>
            <th>Outcome</th>
          </tr>
        </thead>
        <tbody>
          {crimes.map((c, i) => (
            <tr key={c.persistent_id || i}>
              <td>
                <span className="tag">
                  {CATEGORY_LABELS[c.category] ?? c.category}
                </span>
              </td>
              <td>{c.street.replace("On or near ", "")}</td>
              <td>{c.month}</td>
              <td className={c.outcome_category ? "" : "muted"}>
                {c.outcome_category ?? "Under investigation"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MapPlaceholder({ crimes }: { crimes: CrimeResult[] }) {
  const counts: Record<string, number> = {};
  for (const c of crimes) {
    counts[c.street] = (counts[c.street] ?? 0) + 1;
  }
  const hotspots = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  return (
    <div className="map-placeholder">
      <div className="map-grid">
        <p className="map-note">
          Map rendering requires a Mapbox/Leaflet integration. Top hotspots:
        </p>
        <div className="hotspot-list">
          {hotspots.map(([street, count], i) => (
            <div key={street} className="hotspot-item">
              <span className="hotspot-rank">#{i + 1}</span>
              <span className="hotspot-street">
                {street.replace("On or near ", "")}
              </span>
              <span className="hotspot-count">{count} incidents</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ResultRenderer({ result }: Props) {
  const { plan, count, viz_hint, results } = result;

  return (
    <div className="result">
      <div className="result-header">
        <div className="result-meta">
          <span className="result-category">
            {CATEGORY_LABELS[plan.category] ?? plan.category}
          </span>
          <span className="result-sep">·</span>
          <span className="result-date">{formatDate(plan.date)}</span>
        </div>
        <div className="result-count">
          <span className="count-number">{count.toLocaleString()}</span>
          <span className="count-label">incidents</span>
        </div>
      </div>

      <div className="result-body">
        {viz_hint === "bar" && <BarChart crimes={results} />}
        {viz_hint === "map" && <MapPlaceholder crimes={results} />}
        {viz_hint === "table" && <Table crimes={results} />}
        {viz_hint !== "bar" && viz_hint !== "map" && <Table crimes={results} />}
      </div>
    </div>
  );
}
