"use client";

import {useState} from "react";
import {AppProviders} from "@/hooks/provider";
import {Shell} from "@/components/shell/Shell";
import {getDataSource} from "@/lib/data";

export function AppShell({children}: {children: React.ReactNode}) {
  const [source] = useState(getDataSource);
  return (
    <AppProviders source={source}>
      <Shell>{children}</Shell>
    </AppProviders>
  );
}
