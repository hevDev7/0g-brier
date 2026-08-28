/**
 * The categories a market may be created under (spec §5.2).
 *
 * This list mirrors what `DeployLib.applyCategories` registers, and the ORDER is
 * load-bearing: a category's 1-based position is the bit an agent's
 * `Policy.allowedCategories` sets (spec §8.4). Reordering it here would not move
 * anything on chain — the registry is the authority — but it would make this
 * module disagree with the chain about which bit means what, which is worse than
 * being obviously wrong.
 *
 * The chain is extensible: governance can `addCategory` without an upgrade. A
 * client that only ever consults this array will miss anything added after it
 * shipped, so anything security-relevant reads `ConfigRegistry.categoryIndex`.
 * This is for labels and defaults.
 */
export const CATEGORIES = ['crypto', 'politics', 'sports', 'economics', 'science', 'culture'] as const;

export type Category = (typeof CATEGORIES)[number];

export function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

/** The bit this category occupies in a `Policy.allowedCategories` mask. */
export function categoryBit(category: Category): bigint {
  return 1n << BigInt(CATEGORIES.indexOf(category));
}

/** A mask allowing exactly these categories, and nothing else. */
export function categoryMask(categories: readonly Category[]): bigint {
  return categories.reduce((mask, c) => mask | categoryBit(c), 0n);
}
