/**
 * Black-Scholes binary (cash-or-nothing) option pricing.
 *
 * All prices in CENTS (integers) per project convention. Fair values
 * returned in 0–100 cents where 100¢ = "pays out at expiry".
 *
 * Risk-free rate r=0 throughout: for crypto markets in our TTE range
 * (≤6h), r impact is bp-level — well below 1¢ rounding.
 */

const SECONDS_PER_YEAR = 365 * 24 * 3600;
const SQRT_2 = Math.sqrt(2);

/**
 * Standard normal CDF via Abramowitz & Stegun erf approximation 7.1.26.
 * Max absolute error ~1.5e-7 — comfortably below 1¢ rounding precision.
 */
export function normalCDF(x: number): number {
  return 0.5 * (1 + erf(x / SQRT_2));
}

function erf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1.0 / (1.0 + p * ax);
  const y =
    1.0 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

/**
 * Binary call: pays 100¢ if spot > strike at expiry, else 0.
 * Returns the fair value in cents (rounded integer 0–100).
 *
 * At T≤0 this collapses to the indicator function.
 */
export function binaryCallFairValueCents(
  spotCents: number,
  strikeCents: number,
  timeSec: number,
  sigma: number,
): number {
  if (timeSec <= 0) {
    return spotCents > strikeCents ? 100 : 0;
  }
  const T = timeSec / SECONDS_PER_YEAR;
  const sqrtT = Math.sqrt(T);
  const d2 =
    (Math.log(spotCents / strikeCents) - 0.5 * sigma * sigma * T) /
    (sigma * sqrtT);
  return Math.round(100 * normalCDF(d2));
}

/**
 * Binary put: pays 100¢ if spot < strike at expiry. Defined as 100 − call
 * so put-call parity holds exactly under the same rounding.
 */
export function binaryPutFairValueCents(
  spotCents: number,
  strikeCents: number,
  timeSec: number,
  sigma: number,
): number {
  return 100 - binaryCallFairValueCents(spotCents, strikeCents, timeSec, sigma);
}
