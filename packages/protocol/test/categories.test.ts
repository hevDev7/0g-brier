import { describe, expect, it } from 'vitest';
import { CATEGORIES, categoryBit, categoryMask, isCategory } from '../src/categories';

describe('categories', () => {
  it('mirrors what DeployLib registers, in the same order', () => {
    expect([...CATEGORIES]).toEqual(['crypto', 'politics', 'sports', 'economics', 'science', 'culture']);
  });

  /**
   * The order is the reason this list is an array and not a set. A category's
   * position IS the bit an agent's policy sets, so a reordering would silently
   * repoint every policy already granted — allowing sports where politics was meant.
   */
  it('gives every category its own bit', () => {
    const bits = CATEGORIES.map(categoryBit);
    expect(new Set(bits).size).toBe(CATEGORIES.length);
    expect(categoryBit('crypto')).toBe(1n);
    expect(categoryBit('culture')).toBe(32n);
  });

  it('builds a mask that allows exactly what it was given', () => {
    const mask = categoryMask(['politics', 'sports']);
    expect(mask & categoryBit('politics')).toBe(categoryBit('politics'));
    expect(mask & categoryBit('sports')).toBe(categoryBit('sports'));
    expect(mask & categoryBit('crypto')).toBe(0n);
  });

  it('does not accept a near-miss as a category', () => {
    expect(isCategory('sports')).toBe(true);
    expect(isCategory('sport')).toBe(false);
    expect(isCategory('cyrpto')).toBe(false);
  });
});
