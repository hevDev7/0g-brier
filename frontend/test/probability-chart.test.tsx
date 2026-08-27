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
    // Named in both the panel title and the series legend, which is why this
    // counts matches rather than demanding exactly one.
    expect(screen.getAllByText(/P\(YES\)/).length).toBeGreaterThan(0);
    // The accessible name has to carry it too: an axis labelled only visually
    // tells a screen-reader user nothing about what the chart plots.
    expect(screen.getByRole("img")).toHaveAccessibleName(/probability/i);
  });

  it("empty data renders a message, not a bare axis", () => {
    render(<ProbabilityChart candles={[]} />);
    expect(screen.getByText(/no history yet/i)).toBeInTheDocument();
  });
});

/**
 * The wedge. On the first live Galileo market — whose entire life was four
 * minutes — every trade landed in one bucket, so the chart had a single point.
 * `seriesPath` renders that as a bare `M x,y`, invisible as a stroke, but the AREA
 * path closes it down to the baseline and fills a triangle. The reader saw P(YES)
 * sliding from 57% to zero; it had actually gone 66.98% → 62.20% and never left
 * the bucket.
 *
 * No fixture could produce it: the fixtures are 24 hourly trades, which is 24
 * buckets at every interval the UI offers.
 */
describe("a single observation bucket", () => {
  const one = [{bucketStart: 1_787_868_000, open: 669_800_000_000_000_000n,
    high: 669_800_000_000_000_000n, low: 622_000_000_000_000_000n,
    close: 622_000_000_000_000_000n, volume: 312_460_000n}];

  it("states the value instead of plotting a trend that never happened", () => {
    const {container} = render(<ProbabilityChart candles={one} />);
    expect(screen.getByTestId("probability-chart")).toHaveTextContent("62.2%");
    expect(screen.getByTestId("probability-chart")).toHaveTextContent(/one observation bucket/i);
    // Targeted at the chart's own marks, not at "any svg": the panel header
    // carries a lucide icon, so a blanket `querySelector("svg")` would pass or
    // fail for reasons that have nothing to do with the chart.
    expect(container.querySelector("[data-series]")).toBeNull();
    expect(container.querySelector("[data-area]")).toBeNull();
  });

  it("still draws once there are two buckets to draw between", () => {
    const two = [one[0]!, {...one[0]!, bucketStart: one[0]!.bucketStart + 3600}];
    const {container} = render(<ProbabilityChart candles={two} />);
    expect(container.querySelector('path[data-series="yes"]')).not.toBeNull();
  });
});
