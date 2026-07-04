/**
 * context.tsx — provides the active DataProvider to the whole app.
 *
 * The source is chosen by VITE_DATA_SOURCE ("mock" | "live"). Today only "mock" is wired; "live" will
 * construct a LiveDataProvider over Supabase + platform edges. Screens call useData() and never know
 * which source is active — the swap is here and nowhere else.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { DataProvider } from "./provider.ts";
import { MockDataProvider } from "./mock.ts";

const DataContext = createContext<DataProvider | null>(null);

export function DataProviderHost({ children }: { children: ReactNode }) {
  const provider = useMemo<DataProvider>(() => {
    const source = (import.meta.env.VITE_DATA_SOURCE as string) ?? "mock";
    // When "live" is implemented: return new LiveDataProvider(supabaseClient, edges).
    // Defaulting to mock keeps the demo running with no backend.
    if (source === "live") {
      // Intentional: live provider not yet implemented; fall back to mock so the app always runs.
      return new MockDataProvider();
    }
    return new MockDataProvider();
  }, []);
  return <DataContext.Provider value={provider}>{children}</DataContext.Provider>;
}

export function useData(): DataProvider {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within DataProviderHost");
  return ctx;
}
