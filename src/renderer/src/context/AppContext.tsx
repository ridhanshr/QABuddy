import React, { createContext, useContext } from "react";
import { useAppState } from "../hooks/useAppState";

type AppStateContextType = ReturnType<typeof useAppState>;

const AppContext = createContext<AppStateContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const state = useAppState();
  return <AppContext.Provider value={state}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return context;
}
