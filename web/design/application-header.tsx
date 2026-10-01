"use client";
import { type ReactNode } from "react";
import { InstallationSwitcher } from "./installation-switcher";
import { ThemeControls } from "./theme-controls";

// Each application entry loads the shared shell styles once. Importing them
// here too duplicates native layout CSS in the client component bundle.

export function ApplicationHeader({profile, labels, children, actions, brandSymbol}: {profile: string; labels?: Record<string,string>; children: ReactNode; actions?: ReactNode; brandSymbol?: ReactNode}) {
  return <header className="topbar"><InstallationSwitcher profile={profile} labels={labels} brandSymbol={brandSymbol} actions={<><ThemeControls inline/>{actions}</>}/>{children}</header>;
}
