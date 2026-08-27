import {PageHeading} from "@/components/primitives/PageHeading";
import {AgentPicker} from "@/components/portfolio/AgentPicker";

export const metadata = {title: "Observed book"};

export default function PortfolioIndex() {
  return (
    <>
      <PageHeading
        eyebrow="0G / agent observatory"
        title="Observed book"
        description="Inspect any agent's exposure across the indexed markets. Because humans do not execute here, this is one agent's book seen from outside — not a personal portfolio."
      />
      <AgentPicker />
    </>
  );
}
