import { describe, expect, it } from 'vitest';
import {
  binaryCallFairValueCents,
  binaryPutFairValueCents,
  normalCDF,
} from '../src/fairvalue/black-scholes.js';

describe('normalCDF', () => {
  it('returns 0.5 at zero', () => {
    expect(normalCDF(0)).toBeCloseTo(0.5, 7);
  });

  it('is symmetric: CDF(-x) + CDF(x) = 1', () => {
    for (const x of [0.5, 1, 1.5, 2, 3]) {
      expect(normalCDF(-x) + normalCDF(x)).toBeCloseTo(1, 6);
    }
  });

  it('saturates in the tails', () => {
    expect(normalCDF(6)).toBeGreaterThan(0.9999);
    expect(normalCDF(-6)).toBeLessThan(0.0001);
  });
});

describe('binaryCallFairValueCents', () => {
  it('returns ~50¢ at-the-money for short-dated options', () => {
    const v = binaryCallFairValueCents(10_000_000, 10_000_000, 3600, 0.65);
    expect(v).toBe(50);
  });

  it('returns 100¢ deep in-the-money', () => {
    const v = binaryCallFairValueCents(12_000_000, 11_000_000, 3600, 0.65);
    expect(v).toBe(100);
  });

  it('returns 0¢ deep out-of-the-money', () => {
    const v = binaryCallFairValueCents(10_000_000, 11_000_000, 3600, 0.65);
    expect(v).toBe(0);
  });

  // Hand-computed anchor: ln(100/101) ≈ -0.00995, σ²T/2 ≈ 2.41e-5,
  // σ√T ≈ 0.00695, d2 ≈ -1.4362, N(d2) ≈ 0.07547, → 8¢ rounded.
  it('matches pinned anchor at near-OTM (spot=$100k, strike=$101k, 1h, σ=0.65)', () => {
    const v = binaryCallFairValueCents(10_000_000, 10_100_000, 3600, 0.65);
    expect(v).toBe(8);
  });

  it('returns indicator when timeSec ≤ 0', () => {
    expect(binaryCallFairValueCents(10_000_000, 9_000_000, 0, 0.65)).toBe(100);
    expect(binaryCallFairValueCents(10_000_000, 11_000_000, 0, 0.65)).toBe(0);
    expect(binaryCallFairValueCents(10_000_000, 9_000_000, -100, 0.65)).toBe(100);
  });

  it('returns 0 at expiry when spot exactly equals strike', () => {
    expect(binaryCallFairValueCents(10_000_000, 10_000_000, 0, 0.65)).toBe(0);
  });
});

describe('binaryPutFairValueCents', () => {
  it('satisfies put-call parity: call + put = 100 across a range of inputs', () => {
    const inputs = [
      { spot: 10_000_000, strike: 10_000_000, T: 3600, sigma: 0.65 },
      { spot: 10_000_000, strike: 10_100_000, T: 3600, sigma: 0.65 },
      { spot: 11_000_000, strike: 10_000_000, T: 7200, sigma: 0.5 },
      { spot: 350_000, strike: 360_000, T: 1800, sigma: 0.8 },
      { spot: 9_500_000, strike: 10_000_000, T: 600, sigma: 1.2 },
    ];
    for (const { spot, strike, T, sigma } of inputs) {
      const call = binaryCallFairValueCents(spot, strike, T, sigma);
      const put = binaryPutFairValueCents(spot, strike, T, sigma);
      expect(call + put).toBe(100);
    }
  });

  it('returns indicator when timeSec ≤ 0', () => {
    expect(binaryPutFairValueCents(10_000_000, 11_000_000, 0, 0.65)).toBe(100);
    expect(binaryPutFairValueCents(10_000_000, 9_000_000, 0, 0.65)).toBe(0);
  });
});
