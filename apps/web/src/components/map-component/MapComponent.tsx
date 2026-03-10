import { useMemo, useState } from "react";
import Map from "react-map-gl/maplibre";
import maplibregl from "maplibre-gl";
import { ScatterplotLayer } from "@deck.gl/layers";
import { HexagonLayer, HeatmapLayer } from "@deck.gl/aggregation-layers";
import "maplibre-gl/dist/maplibre-gl.css";
import DeckGLOverlay from "./DeckGLOverlay";

const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

export default function MapComponent({ data }) {
  const crimes = data.results;
  const [mode, setMode] = useState("points");
  const [hover, setHover] = useState(null);

  const points = useMemo(
    () =>
      crimes
        .map((c) => ({
          ...c,
          lng: c.longitude,
          lat: c.latitude,
        }))
        .filter((c) => !Number.isNaN(c.lng) && !Number.isNaN(c.lat)),
    [crimes],
  );

  const first = points[0];

  const layers = useMemo(() => {
    if (mode === "points")
      return [
        new ScatterplotLayer({
          id: "crime-points",
          data: points,
          getPosition: (d) => [d.lng, d.lat],
          getRadius: 30,
          radiusUnits: "meters",
          getFillColor: [220, 38, 38, 180],
          pickable: true,
          onHover: (info) => setHover(info.object || null),
        }),
      ];
    if (mode === "clusters")
      return [
        new HexagonLayer({
          id: "crime-clusters",
          data: points,
          getPosition: (d) => [d.lng, d.lat],
          radius: 200,
          elevationScale: 30,
          extruded: true,
          pickable: true,
        }),
      ];
    if (mode === "heatmap")
      return [
        new HeatmapLayer({
          id: "crime-heat",
          data: points,
          getPosition: (d) => [d.lng, d.lat],
          radiusPixels: 60,
        }),
      ];
    return [];
  }, [points, mode]);

  return (
    <div style={{ position: "relative", width: "100%", height: "600px" }}>
      <Map
        mapLib={maplibregl}
        initialViewState={{
          longitude: first?.lng ?? -0.1276,
          latitude: first?.lat ?? 51.5074,
          zoom: 12,
          pitch: 40,
        }}
        style={{ width: "100%", height: "100%" }}
        mapStyle={MAP_STYLE}
      >
        <DeckGLOverlay layers={layers} />
      </Map>

      {/* Mode selector */}
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 10,
          background: "white",
          padding: 8,
          borderRadius: 6,
          display: "flex",
          gap: 4,
        }}
      >
        {["points", "clusters", "heatmap"].map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            style={{ fontWeight: mode === m ? "bold" : "normal" }}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Tooltip */}
      {hover && (
        <div
          style={{
            position: "absolute",
            bottom: 20,
            left: 20,
            background: "white",
            padding: "8px 12px",
            borderRadius: 6,
            boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
          }}
        >
          <strong>{hover.category}</strong>
          <br />
          {hover.street}
          <br />
          {hover.month}
          {hover.outcome_category && <em>{hover.outcome_category}</em>}
        </div>
      )}
    </div>
  );
}
