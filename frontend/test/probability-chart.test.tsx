import {describe, expect, it, vi} from "vitest";
import {render, screen} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    const {container} = render(<ProbabilityChart candles={cs} interval="1h" onIntervalChange={() => {}} />);
    expect(container.querySelectorAll("path[data-series]").length).toBe(2);
  });

  it("labels the Y axis 0% to 100%, not the data range", () => {
    render(<ProbabilityChart candles={cs} interval="1h" onIntervalChange={() => {}} />);
    for (const label of ["0%", "25%", "50%", "75%", "100%"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("the NO series is the complement of the YES series", () => {
    const {container} = render(<ProbabilityChart candles={cs} interval="1h" onIntervalChange={() => {}} />);
    const yes = container.querySelector('path[data-series="yes"]')!.getAttribute("d")!;
    const no = container.querySelector('path[data-series="no"]')!.getAttribute("d")!;
    expect(yes).not.toBe(no);
    expect(yes).not.toContain("NaN");
    expect(no).not.toContain("NaN");
  });

  it("names the axis as a probability, not a price", () => {
    render(<ProbabilityChart candles={cs} interval="1h" onIntervalChange={() => {}} />);
    // Named in both the panel title and the series legend, which is why this
    // counts matches rather than demanding exactly one.
    expect(screen.getAllByText(/P\(YES\)/).length).toBeGreaterThan(0);
    // The accessible name has to carry it too: an axis labelled only visually
    // tells a screen-reader user nothing about what the chart plots.
    expect(screen.getByRole("img")).toHaveAccessibleName(/probability/i);
  });

  it("empty data renders a message, not a bare axis", () => {
    render(<ProbabilityChart candles={[]} interval="1h" onIntervalChange={() => {}} />);
    // `toHaveTextContent`, not `getByText`: the sentence now names the bucket width,
    // so it is split across elements by the interpolation and `getByText` — which
    // joins only an element's DIRECT text nodes — would never match it.
    expect(screen.getByTestId("probability-chart")).toHaveTextContent(/no history in 1h buckets/i);
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
    const {container} = render(<ProbabilityChart candles={one} interval="1h" onIntervalChange={() => {}} />);
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
    const {container} = render(<ProbabilityChart candles={two} interval="1h" onIntervalChange={() => {}} />);
    expect(container.querySelector('path[data-series="yes"]')).not.toBeNull();
  });
});

/**
 * The reader picks the bucket width, and the choice reaches the DATA SOURCE, not
 * just the drawing: a different width is a different aggregation, so the page has to
 * re-ask for it. These cover the control; `market-page.test.tsx` covers the wiring.
 */
describe("ProbabilityChart — choosing a bucket width", () => {
  const widths = ["1h", "1d", "1w", "30d"] as const;

  it("offers hour, day, week and thirty days", () => {
    render(<ProbabilityChart candles={cs} interval="1h" onIntervalChange={() => {}} />);
    for (const w of widths) expect(screen.getByTestId(`interval-${w}`)).toBeInTheDocument();
  });

  /**
   * Thirty days, and it says so. A calendar month is not a fixed number of seconds,
   * and a bucket labelled "1M" would put February and August on one axis as equals —
   * a small lie a chart makes easy and a reader cannot check.
   */
  it("calls the widest bucket 30d, never 1M", () => {
    render(<ProbabilityChart candles={cs} interval="1h" onIntervalChange={() => {}} />);
    expect(screen.getByTestId("interval-30d")).toHaveTextContent("30d");
    expect(screen.queryByText("1M")).not.toBeInTheDocument();
  });

  it("marks the chosen width as pressed, and only that one", () => {
    render(<ProbabilityChart candles={cs} interval="1d" onIntervalChange={() => {}} />);
    expect(screen.getByTestId("interval-1d")).toHaveAttribute("aria-pressed", "true");
    for (const w of widths.filter((x) => x !== "1d")) {
      expect(screen.getByTestId(`interval-${w}`)).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("reports the width the reader picked", async () => {
    const onIntervalChange = vi.fn();
    render(<ProbabilityChart candles={cs} interval="1h" onIntervalChange={onIntervalChange} />);
    await userEvent.click(screen.getByTestId("interval-1w"));
    expect(onIntervalChange).toHaveBeenCalledWith("1w");
  });

  /**
   * An empty chart is often a bucket too wide or too narrow for the history that
   * exists. A reader who cannot change it has to guess whether the market is quiet
   * or the question was wrong.
   */
  it("keeps the picker reachable when there is nothing to plot", () => {
    render(<ProbabilityChart candles={[]} interval="30d" onIntervalChange={() => {}} />);
    expect(screen.getByTestId("interval-1h")).toBeInTheDocument();
    expect(screen.getByTestId("probability-chart")).toHaveTextContent(/no history in 30d buckets/i);
  });

  it("keeps it reachable when a single bucket swallowed every trade", () => {
    render(<ProbabilityChart candles={[cs[0]!]} interval="30d" onIntervalChange={() => {}} />);
    expect(screen.getByTestId("interval-1h")).toBeInTheDocument();
    expect(screen.getByTestId("probability-chart")).toHaveTextContent(/narrower bucket/i);
  });
});
