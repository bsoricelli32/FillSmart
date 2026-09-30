import { NavLink } from "react-router-dom";
import { CarProfile, ChartLineUp, GasPump, Scan, Wallet } from "@phosphor-icons/react";

const TABS = [
  { to: "/", label: "Prices", Icon: GasPump, end: true },
  { to: "/outlook", label: "Outlook", Icon: ChartLineUp },
  { to: "/scan", label: "Scan", Icon: Scan },
  { to: "/spend", label: "Spend", Icon: Wallet },
  { to: "/garage", label: "Garage", Icon: CarProfile },
];

export function TabDock() {
  return (
    <nav className="tabdock glass" aria-label="Main">
      {TABS.map(({ to, label, Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => "tab" + (isActive ? " on" : "")}>
          {({ isActive }) => (
            <>
              <Icon size={22} weight={isActive ? "fill" : "regular"} aria-hidden />
              <span>{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

export function Bar({ left, title, right }: { left?: React.ReactNode; title: string; right?: React.ReactNode }) {
  return (
    <header className="bar">
      {left ?? <span style={{ width: 48 }} />}
      <h1 className="eyebrow">{title}</h1>
      {right ?? <span style={{ width: 48 }} />}
    </header>
  );
}

export function Section({ id, title, hint, right, children }: { id: string; title: string; hint?: string; right?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <section aria-labelledby={id} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <h2 id={id} className="h2">{title}</h2>
          {hint && <p className="hint">{hint}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export function PumpPrice({ price, size = 18 }: { price: number; size?: number }) {
  const s = price.toFixed(3);
  return (
    <span className="tnum" style={{ fontSize: size, fontWeight: 800 }}>
      ${s.slice(0, -1)}<sup style={{ fontSize: Math.round(size * 0.45) }}>{s.slice(-1)}</sup>
    </span>
  );
}
