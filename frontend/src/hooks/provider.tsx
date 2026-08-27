"use client";

import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {createContext, useContext, useState, type ReactNode} from "react";
import {CapabilityUnavailableError, type DataSource} from "@/lib/data/types";

const DataSourceContext = createContext<DataSource | null>(null);

export function useDataSource(): DataSource {
  const source = useContext(DataSourceContext);
  if (!source) throw new Error("useDataSource dipakai di luar AppProviders");
  return source;
}

export function AppProviders({source, children}: {source: DataSource; children: ReactNode}) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Kemampuan yang absen bukan kegagalan sementara — mengulanginya
            // hanya menunda status `unavailable` yang sudah pasti.
            retry: (count, error) =>
              !(error instanceof CapabilityUnavailableError) && count < 2,
            staleTime: 5_000,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <DataSourceContext.Provider value={source}>{children}</DataSourceContext.Provider>
    </QueryClientProvider>
  );
}
