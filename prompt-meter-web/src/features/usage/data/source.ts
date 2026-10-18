import type { UsageDataSource } from "./types";

export type DataSourceKind = "blocks" | "sample";

/** VITE_PM_DATA_SOURCE=sample|blocks (defaults to blocks live data). */
export function configuredDataSourceKind(raw: string | undefined = import.meta.env.VITE_PM_DATA_SOURCE): DataSourceKind {
  return raw === "sample" ? "sample" : "blocks";
}

export const dataSourceKind = configuredDataSourceKind();

let sourcePromise: Promise<UsageDataSource> | undefined;

/** Lazily loads only the selected implementation (keeps the sample JSON out of blocks builds). */
export function getUsageDataSource(): Promise<UsageDataSource> {
  sourcePromise ??= dataSourceKind === "blocks"
    ? import("./blocksSource").then((module) => module.createBlocksSource())
    : import("./sampleSource").then((module) => module.createSampleSource());
  return sourcePromise;
}
