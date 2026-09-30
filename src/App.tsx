import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { StoreProvider } from "./lib/store";
import Login from "./screens/Login";
import Prices from "./screens/Prices";
import Station from "./screens/Station";
import Scan from "./screens/Scan";
import Spend from "./screens/Spend";
import Outlook from "./screens/Outlook";
import Garage from "./screens/Garage";

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return <div className="screen" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}><span className="spin" aria-label="Loading" /></div>;
  }
  if (!session) return <Login />;

  return (
    <StoreProvider userId={session.user.id}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Prices />} />
          <Route path="/station/:placeId" element={<Station />} />
          <Route path="/scan" element={<Scan />} />
          <Route path="/spend" element={<Spend />} />
          <Route path="/outlook" element={<Outlook />} />
          <Route path="/garage" element={<Garage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </StoreProvider>
  );
}
