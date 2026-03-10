import { useState } from "react";
import styles from "./App.module.css";
import QueryInput from "./components/QueryInput";
import MapComponent from "./components/map-component/MapComponent.tsx";
import "maplibre-gl/dist/maplibre-gl.css";

export interface CrimeResult {
  id: number;
  query_id: string;
  persistent_id: string;
  category: string;
  month: string;
  street: string;
  latitude: number;
  longitude: number;
  outcome_category: string | null;
  outcome_date: string | null;
  location_type: string;
  context: string | null;
}

export interface QueryResponse {
  query_id: string;
  plan: {
    category: string;
    date: string;
    poly: string;
    viz_hint: "map" | "bar" | "table";
  };
  count: number;
  viz_hint: "map" | "bar" | "table";
  results: CrimeResult[];
}

export default function App() {
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleQuery(text: string) {
    setLoading(true);
    try {
      const res = await fetch("/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      setResult(data); // same as setData(jsonData)
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }
  console.log("result:", result);

  return (
    <div
      className={`${styles.app} ${result ? styles.hasResult : styles.empty}`}
    >
      {result && (
        <div className={styles.top}>
          <MapComponent data={result} />
        </div>
      )}
      <div className={styles.bottom}>
        <QueryInput onSubmit={handleQuery} loading={loading} />
      </div>
    </div>
  );
}
