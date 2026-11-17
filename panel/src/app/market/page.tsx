import { connection } from "next/server";
import { MarketView } from "@/components/market-view";
import { market } from "@/lib/server/store";
export default async function MarketPage() {
  await connection();
  return <MarketView initial={market(new URLSearchParams())} />;
}
