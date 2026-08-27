import {describe, expect, it} from "vitest";
import {render, screen} from "@testing-library/react";
import {ProbabilityChart} from "@/components/market/ProbabilityChart";
import type {Candle} from "@/lib/data/types";

const WAD = 10n ** 18n;
const cs: Candle[] = [
  {bucketStart: 0, open: WAD / 2n, high: WAD / 2n, low: WAD / 2n, close: WAD / 2n, volume: 0n},
  {bucketStart: 3600, open: (WAD * 59n) / 100n, high: (WAD * 59n) / 100n,
   low: (WAD * 59n) / 100n, close: (WAD * 59n) / 100n, volume: 0n},
];

describe("ProbabilityChart", () => {
  it("draws two series", () => {
    const {container} = render(<ProbabilityChart candles={cs} />);
    expect(container.querySelectorAll("path[data-series]").length).toBe(2);
  });

  it("labels the Y axis 0% to 100%, not the data range", () => {
    render(<ProbabilityChart candles={cs} />);
    for (const label of ["0%", "25%", "50%", "75%", "100%"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("the NO series is the complement of the YES series", () => {
    const {container} = render(<ProbabilityChart candles={cs} />);
    const yes = container.querySelector('path[data-series="yes"]')!.getAttribute("d")!;
    const no = container.querySelector('path[data-series="no"]')!.getAttribute("d")!;
    expect(yes).not.toBe(no);
    expect(yes).not.toContain("NaN");
    expect(no).not.toContain("NaN");
  });

  it("names the axis as a probability, not a price", () => {
    render(<ProbabilityChart candles={cs} />);
    expect(screen.getByText(/P\(YES\)/)).toBeInTheDocument();
  });

  it("empty data renders a message, not a bare axis", () => {
    render(<ProbabilityChart candles={[]} />);
    expect(screen.getByText(/no history yet/i)).toBeInTheDocument();
  });
});
