import { useState } from "react";
import QueryInput from "./components/QueryInput";
import ResultRenderer from "./components/ResultRenderer";

export interface CrimeLocation {
  latitude: string;
  longitude: string;
  street: { id: number; name: string };
}

export interface Crime {
  category: string;
  location: CrimeLocation;
  month: string;
  outcome_status: { category: string; date: string } | null;
  persistent_id: string;
  context: string;
  id: number;
  location_type: string;
  location_subtype: string;
}

export interface QueryResult {
  query_id: string;
  plan: {
    category: string;
    date: string;
    poly: string;
    viz_hint: "map" | "bar" | "table";
  };
  count: number;
  viz_hint: "map" | "bar" | "table";
  results: Crime[];
}

export default function App() {
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleQuery(text: string) {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? "Unknown error");
      }

      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <span className="logo-icon">🚔</span>
            <span className="logo-text">query<span className="logo-accent">-os</span></span>
          </div>
          <p className="tagline">Natural language crime intelligence for the UK</p>
        </div>
      </header>

      <main className="main">
        <QueryInput onSubmit={handleQuery} loading={loading} />

        {error && (
          <div className="error-banner">
            <span className="error-icon">⚠</span>
            <span>{error}</span>
          </div>
        )}

        {result && <ResultRenderer result={result} />}

        {!result && !loading && !error && (
          <div className="empty-state">
            <div className="empty-examples">
              <p className="empty-label">Try asking</p>
              <ul>
                <li onClick={() => handleQuery("Show me burglaries in Camden last month")}>
                  Show me burglaries in Camden last month
                </li>
                <li onClick={() => handleQuery("How many vehicle crimes in Hackney in 2024?")}>
                  How many vehicle crimes in Hackney in 2024?
                </li>
                <li onClick={() => handleQuery("List all drug offences in Lambeth this year")}>
                  List all drug offences in Lambeth this year
                </li>
              </ul>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
