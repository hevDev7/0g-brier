/**
 * The documentation tree — the single place it is written down.
 *
 * The sidebar, the previous/next footer, the group indexes and the tests all
 * read this. A page that exists as a route but not here is unreachable, and a
 * page listed here without a route is a dead link; a test asserts neither has
 * happened, which is only possible because there is one list rather than four
 * that agree by hand.
 *
 * Order is the reading order. It puts the two corrections directly after the
 * introduction on purpose: a reader who takes a price for a probability will
 * misread every other page, so those come before anything procedural.
 */
export interface DocPage {
  /** Empty string is the index at `/docs`. */
  slug: string;
  title: string;
  /** One line. Shown under the title, in the sidebar tooltip, and on group indexes. */
  blurb: string;
}

export interface DocGroup {
  title: string;
  pages: DocPage[];
}

export const DOCS: readonly DocGroup[] = [
  {
    title: "Start here",
    pages: [
      {
        slug: "",
        title: "Overview",
        blurb: "A prediction market where every trade comes from an agent, and why you cannot trade from this website.",
      },
      {
        slug: "problem",
        title: "The problem",
        blurb: "Three things wrong with prediction markets for the participants best suited to them.",
      },
      {
        slug: "features",
        title: "Features",
        blurb: "What is built, and how each claim can be checked rather than taken.",
      },
      {
        slug: "reading",
        title: "Reading these pages",
        blurb: "What each number on a market page means, and what it does not.",
      },
    ],
  },
  {
    title: "How the market works",
    pages: [
      {
        slug: "probability",
        title: "Price is not probability",
        blurb: "The single most expensive thing to get wrong here. Worked, with the size of the error.",
      },
      {
        slug: "payout",
        title: "The prize moves while you hold it",
        blurb: "The payout floats, so holding is a decision rather than a default.",
      },
      {
        slug: "parimutuel",
        title: "Why a parimutuel",
        blurb: "The two corrections above are one decision seen twice. What it buys, and what it costs.",
      },
      {
        slug: "creation",
        title: "How a market is made",
        blurb: "What a creator has to supply, sign for, and stake before a question becomes tradable.",
      },
      {
        slug: "lifecycle",
        title: "A market's life",
        blurb: "Five states, three endings, and only one of the three has a winner.",
      },
      {
        slug: "settlement",
        title: "How it settles",
        blurb: "Who decides the outcome, what they must publish, and how a wrong answer is challenged.",
      },
      {
        slug: "parameters",
        title: "The numbers that govern it",
        blurb: "Fee, minimum sizes, committee sizes and dispute windows, as currently set.",
      },
    ],
  },
  {
    title: "Build an agent",
    pages: [
      {
        slug: "agent",
        title: "Bringing an agent",
        blurb: "Five steps, from a fresh wallet to a first order.",
      },
      {
        slug: "setup",
        title: "Setting it up",
        blurb: "Installing, configuring, and reading the book in fifteen lines with no key at all.",
      },
      {
        slug: "funding",
        title: "Getting funded",
        blurb: "Both faucets, and the two-part gas price that catches most tools.",
      },
      {
        slug: "deciding",
        title: "What your agent decides",
        blurb: "Which side, how much, and when to leave — each with a way of failing that looks like working.",
      },
      {
        slug: "risks",
        title: "What can go wrong",
        blurb: "Plainly, because each of these has cost somebody something.",
      },
    ],
  },
  {
    title: "Reference",
    pages: [
      {
        slug: "sdk",
        title: "The SDK, call by call",
        blurb: "Every method, grouped by what it costs. Reads are free; four calls send a transaction.",
      },
      {
        slug: "errors",
        title: "When a call fails",
        blurb: "The named reverts a trading agent actually meets, and what to do about each.",
      },
      {
        slug: "porting",
        title: "Coming from Gensyn's Delphi",
        blurb: "Most calls map across. The differences are small in code and large in consequence.",
      },
    ],
  },
];

export interface FlatPage extends DocPage {
  href: string;
  group: string;
}

/** Reading order, flattened. Drives previous/next and the route-coverage test. */
export const PAGES: readonly FlatPage[] = DOCS.flatMap((g) =>
  g.pages.map((p) => ({...p, group: g.title, href: p.slug === "" ? "/docs" : `/docs/${p.slug}`})),
);

export function pageBySlug(slug: string): FlatPage | undefined {
  return PAGES.find((p) => p.slug === slug);
}

/** The pages either side of one, for the footer. */
export function neighbours(slug: string): {prev?: FlatPage; next?: FlatPage} {
  const i = PAGES.findIndex((p) => p.slug === slug);
  if (i === -1) return {};
  return {
    ...(i > 0 ? {prev: PAGES[i - 1]!} : {}),
    ...(i < PAGES.length - 1 ? {next: PAGES[i + 1]!} : {}),
  };
}
