import { useCallback, useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import { LocateFixed, MapPin, Navigation, ParkingCircle, RefreshCw } from "lucide-react";
import "leaflet/dist/leaflet.css";

const DEFAULT_LOCATION = { lat: 12.9716, lon: 77.5946, label: "Bengaluru, India" };
const OVERPASS_URLS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const parkingIcon = L.divIcon({
  className: "parking-marker",
  html: '<div class="parking-marker-dot">P</div>',
  iconSize: [34, 34],
  iconAnchor: [17, 17],
});
const userIcon = L.divIcon({
  className: "user-marker",
  html: '<div class="user-marker-dot"><span></span></div>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

function distanceKm(from, to) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const dLat = radians(to.lat - from.lat);
  const dLon = radians(to.lon - from.lon);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function MapFocus({ point }) {
  const map = useMap();
  useEffect(() => {
    if (point) map.flyTo([point.lat, point.lon], 16, { duration: 0.6 });
  }, [map, point]);
  return null;
}

export default function NearbyParking() {
  const [location, setLocation] = useState(DEFAULT_LOCATION);
  const [radius, setRadius] = useState(3);
  const [places, setPlaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [locating, setLocating] = useState(false);

  const loadParking = useCallback(async () => {
    setLoading(true);
    setError("");
    const meters = radius * 1000;
    const query = `[out:json][timeout:25];(node[amenity=parking](around:${meters},${location.lat},${location.lon});way[amenity=parking](around:${meters},${location.lat},${location.lon});relation[amenity=parking](around:${meters},${location.lat},${location.lon}););out center tags;`;
    let lastError;
    for (const url of OVERPASS_URLS) {
      try {
        const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" }, body: `data=${encodeURIComponent(query)}` });
        if (!response.ok) throw new Error(`Parking data service returned ${response.status}`);
        const data = await response.json();
        const parsed = (data.elements || []).map((item) => {
          const lat = item.lat ?? item.center?.lat;
          const lon = item.lon ?? item.center?.lon;
          if (lat == null || lon == null) return null;
          const tags = item.tags || {};
          return { id: `${item.type}-${item.id}`, lat, lon, tags, distance: distanceKm(location, { lat, lon }) };
        }).filter(Boolean).sort((a, b) => a.distance - b.distance);
        setPlaces(parsed);
        setLoading(false);
        return;
      } catch (err) {
        lastError = err;
      }
    }
    setError(lastError?.message || "Could not load nearby parking areas.");
    setLoading(false);
  }, [location, radius]);

  useEffect(() => { loadParking(); }, [loadParking]);

  const locateMe = () => {
    if (!navigator.geolocation) {
      setError("Location is not supported by this browser.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocation({ lat: coords.latitude, lon: coords.longitude, label: "Your location" });
        setSelected(null);
        setLocating(false);
      },
      () => {
        setError("Could not access your location. Check browser permission and try again.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  };

  const mapKey = `${location.lat},${location.lon}`;
  const selectedPoint = useMemo(() => selected && { lat: selected.lat, lon: selected.lon }, [selected]);

  return (
    <main className="max-w-6xl mx-auto px-4 py-7">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
        <div>
          <div className="flex items-center gap-2 text-accent text-sm font-semibold mb-1"><ParkingCircle size={17} /> FIND A PLACE TO PARK</div>
          <h1 className="text-2xl font-bold text-ink">Nearby parking</h1>
          <p className="text-sm text-muted mt-1">Explore mapped parking areas around {location.label}.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-muted flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2">
            Search radius
            <select value={radius} onChange={(event) => setRadius(Number(event.target.value))} className="bg-transparent text-ink outline-none">
              <option value={1}>1 km</option><option value={3}>3 km</option><option value={5}>5 km</option>
            </select>
          </label>
          <button onClick={locateMe} disabled={locating} className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-surface2 disabled:opacity-60">
            <LocateFixed size={16} /> {locating ? "Locating…" : "Use my location"}
          </button>
          <button onClick={loadParking} disabled={loading} aria-label="Refresh parking results" className="rounded-lg border border-line bg-surface p-2 text-muted hover:text-ink hover:bg-surface2 disabled:opacity-60"><RefreshCw size={17} className={loading ? "animate-spin" : ""} /></button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="relative overflow-hidden rounded-xl border border-line bg-surface">
          <MapContainer key={mapKey} center={[location.lat, location.lon]} zoom={14} scrollWheelZoom className="parking-map">
            <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <MapFocus point={selectedPoint} />
            <Marker position={[location.lat, location.lon]} icon={userIcon}><Popup>{location.label}</Popup></Marker>
            {places.map((place) => (
              <Marker key={place.id} position={[place.lat, place.lon]} icon={parkingIcon} eventHandlers={{ click: () => setSelected(place) }}>
                <Popup><strong>{place.tags.name || place.tags.operator || "Parking area"}</strong><br />{place.distance.toFixed(1)} km away</Popup>
              </Marker>
            ))}
          </MapContainer>
          <div className="absolute bottom-3 left-3 z-[500] rounded-md border border-line bg-surface/95 px-3 py-2 text-xs text-muted shadow-lg">Map data © OpenStreetMap contributors</div>
        </section>

        <aside className="rounded-xl border border-line bg-surface overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <div><h2 className="font-semibold text-ink">Parking areas</h2><p className="text-xs text-muted mt-0.5">Within {radius} km · {loading ? "Searching…" : `${places.length} found`}</p></div>
            <MapPin size={17} className="text-accent" />
          </div>
          <div className="max-h-[480px] overflow-y-auto">
            {loading && <p className="p-5 text-sm text-muted">Searching OpenStreetMap…</p>}
            {!loading && error && <div className="p-4 text-sm text-amber-300">{error}<p className="text-xs text-muted mt-2">The map still works; parking search needs an internet connection.</p></div>}
            {!loading && !error && places.length === 0 && <p className="p-5 text-sm text-muted">No mapped parking areas found in this radius. Try a wider search.</p>}
            {!loading && places.map((place) => {
              const name = place.tags.name || place.tags.operator || "Parking area";
              const detail = place.tags.parking || place.tags.access || place.tags.fee;
              return <button key={place.id} onClick={() => setSelected(place)} className={`w-full border-b border-line px-4 py-3 text-left transition-colors hover:bg-surface2 ${selected?.id === place.id ? "bg-surface2" : ""}`}>
                <span className="flex items-start justify-between gap-3"><span className="font-medium text-sm text-ink">{name}</span><span className="shrink-0 text-xs text-accent">{place.distance.toFixed(1)} km</span></span>
                <span className="mt-1 flex items-center gap-1 text-xs text-muted"><Navigation size={12} /> {detail ? String(detail).replaceAll("_", " ") : "Parking"}{place.tags.capacity ? ` · ${place.tags.capacity} spaces` : ""}</span>
                <span className="mt-2 inline-block text-xs text-accent">View on map →</span>
              </button>;
            })}
          </div>
          <div className="border-t border-line px-4 py-3 text-[11px] leading-relaxed text-muted">Parking locations come from community mapped OpenStreetMap data. Availability and operating hours are not provided.</div>
        </aside>
      </div>
    </main>
  );
}
