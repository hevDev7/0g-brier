import type {Metadata} from "next";
import {MarketView} from "./MarketView";
import {getDataSource} from "@/lib/data";

/**
 * The tab should name the market, not just the product. A market that cannot be
 * read falls back to a generic title rather than failing the render: metadata is
 * not the place to surface a data error, and `MarketView` reports it properly.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{address: string}>;
}): Promise<Metadata> {
  const {address} = await params;
  try {
    const market = await getDataSource().getMarket(address as `0x${string}`);
    return {title: market.question};
  } catch {
    return {title: "Market"};
  }
}

export default async function Page({params}: {params: Promise<{address: string}>}) {
  const {address} = await params;
  return <MarketView address={address as `0x${string}`} />;
}
