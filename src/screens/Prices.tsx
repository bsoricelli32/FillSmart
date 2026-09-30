import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowsClockwise, CaretRight, MagnifyingGlass, MapPin, MapTrifold, SortAscending } from "@phosphor-icons/react";
import { useStore, priceFor } from "../lib/store";
import { GRADES, gradeName } from "../lib/supabase";
import { timeAgo, sourceLabel } from "../lib/util";
import { Bar, PumpPrice, Section, TabDock } from "../components/TabDock";

export default function Prices() {
  const { prefs, setPrefs, stations, stationsLoading, stationsError, googleConfigured, reloadStations, loc, locate } = useStore();
  const grade = prefs.preferred_grade;
  const [q, setQ] = useState("");
  const [sortBy, setSortBy] = useState<"price" | "distance">("price");

  const list = useMemo(() => {
    const f = stations.filter((s) => !q || s.name.toLowerCase().includes(q.toLowerCase()) || (s.address ?? "").toLowerCase().includes(q.toLowerCase()));
    return [...f].sort((a, b) => {
      if (sortBy === "distance") return a.distance_mi - b.distance_mi;
      const pa = priceFor(a, grade), pb = priceFor(b, grade);
      if (pa == null && pb == null) return a.distance_mi - b.distance_mi;
      if (pa == null) return 1;
      if (pb == null) return -1;
      return pa - pb || a.distance_mi - b.distance_mi;
    });
  }, [stations, q, sortBy, grade]);

  const cheapest = useMemo(() => {
    const priced = stations.filter((s) => priceFor(s, grade) != null);
    return priced.sort((a, b) => priceFor(a, grade)! - priceFor(b, grade)!)[0];
  }, [stations, grade]);

  const mapsUrl = `https://www.google.com/maps/search/gas+stations/@${loc.lat},${loc.lng},13z`;

  return (
    <div className="screen with-search">
      <div className="hero">
        <Bar
          left={<a className="nb" href={mapsUrl} target="_blank" rel="noreferrer" aria-label="Open map of stations"><MapTrifold size={22} /></a>}
          title="Prices nearby"
          right={<button className="nb" aria-label={sortBy === "price" ? "Sort by distance" : "Sort by price"} onClick={() => setSortBy(sortBy === "price" ? "distance" : "price")}><SortAscending size={22} /></button>}
        />
        <section aria-label="Lowest price" style={{ display: "flex", justifyContent: "center", marginTop: 2 }}>
          <div className="rsunk" style={{ width: 196, height: 196, borderRadius: 98, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div className="dome" style={{ width: 160, height: 160, borderRadius: 80, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5 }}>
              <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".06em", color: "#fff", background: "#C21F1A", padding: "2px 8px", borderRadius: 8 }}>LOWEST {gradeName(grade).toUpperCase()}</span>
              {cheapest ? (
                <>
                  <PumpPrice price={priceFor(cheapest, grade)!} size={34} />
                  <span style={{ fontSize: 12, color: "var(--ink-2)" }}>{cheapest.distance_mi} mi away</span>
                </>
              ) : (
                <span style={{ fontSize: 14, color: "var(--ink-2)", textAlign: "center", padding: "0 18px" }}>{stationsLoading ? "Checking prices" : "No prices yet"}</span>
              )}
            </div>
          </div>
        </section>
      </div>

      <main className="main" style={{ paddingTop: 18 }}>
        <Section id="gr" title="Grade" hint="Tap a grade to update every price.">
          <div role="group" aria-label="Fuel grade" style={{ display: "flex", gap: 12 }}>
            {GRADES.map((g) => (
              <button key={g.id} className={"grade" + (g.id === grade ? " on" : "")} aria-pressed={g.id === grade} onClick={() => setPrefs({ preferred_grade: g.id })}>
                <span className="n">{g.id}</span><span className="s">{g.name}</span>
              </button>
            ))}
          </div>
        </Section>

        <Section
          id="near"
          title={`${gradeName(grade)} near you`}
          hint={sortBy === "price" ? "Cheapest first. Tap a station for all prices and directions." : "Closest first. Tap a station for all prices and directions."}
          right={<button className="nb xs" aria-label="Refresh prices" onClick={() => reloadStations(true)}>{stationsLoading ? <span className="spin" /> : <ArrowsClockwise size={18} />}</button>}
        >
          {stationsError && <p className="err">{stationsError === "network" ? "Can't reach the server. Check your connection." : "Couldn't load prices. Try refresh."}</p>}
          {!googleConfigured && !stationsError && (
            <p className="hint">Google prices aren't switched on yet. You'll see stations that you and your invites have scanned.</p>
          )}
          {!stationsLoading && list.length === 0 && !stationsError && (
            <div className="raised-sm empty"><p>No stations found here yet. Scan your next fill-up to add the first price.</p></div>
          )}
          <ol style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {list.map((s) => {
              const p = s.prices[grade];
              const best = cheapest && s.place_id === cheapest.place_id && sortBy === "price";
              return (
                <li key={s.place_id}>
                  <Link to={`/station/${encodeURIComponent(s.place_id)}`} className={"srow" + (best ? " tint" : "")}>
                    <div style={{ flexGrow: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                      <span style={{ fontWeight: 700, fontSize: 16, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</span>
                      <span style={{ fontSize: 13, color: "var(--ink-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.distance_mi} mi{p ? ` · ${timeAgo(p.updated_at)} · ${sourceLabel(p.source)}` : " · no price yet"}</span>
                    </div>
                    {p ? <PumpPrice price={p.price} size={18} /> : <span style={{ fontSize: 14, color: "var(--ink-2)" }}>--</span>}
                    <span className={"nb xs" + (best ? " accent" : "")} aria-hidden><CaretRight size={18} /></span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </Section>
      </main>

      <div className="searchdock glass" role="search">
        <button className="loc" onClick={locate} aria-label={loc.precise ? "Update my location" : "Use my location"}>
          <MapPin size={18} weight="fill" color="#C21F1A" aria-hidden />{loc.label}
        </button>
        <label className="search">
          <MagnifyingGlass size={18} aria-hidden />
          <span className="sr-only">Search stations</span>
          <input type="search" placeholder="Search stations" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      <TabDock />
    </div>
  );
}
