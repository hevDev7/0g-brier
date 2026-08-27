import {MarketView} from "./MarketView";

export default async function Page({params}: {params: Promise<{address: string}>}) {
  const {address} = await params;
  return <MarketView address={address as `0x${string}`} />;
}
