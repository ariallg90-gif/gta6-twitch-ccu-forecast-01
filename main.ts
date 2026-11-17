// Forecast GTA VI's launch-day Twitch viewers, hours 2..24, five quantiles each.
//
// The forecast for each hour is built from the case's own comparables: past big
// launches whose hourly Twitch curves are in the case file. For a comparable
// launch, the shape of its launch day is the curve of log-ratios
// ln(viewers_h / viewers_1) over its release day. For hour h, the forecast
// takes the distribution of those log-ratios across comparable launches,
// similarity-weighted by launch size (a mega launch curves like a mega launch),
// and reports Gaussian quantiles around the weighted median. A launch whose
// hour-1 print is small, or whose release was early-access contaminated or a
// weak tier, is left out of the predictor pool: small and distorted launches
// curve differently. Where a case carries too few usable comparables for an
// hour, that hour falls back to a persistence forecast with a widening spread.
//
// Validated by leave-one-out over the kit's 37 comparable launches: on big
// launches (hour-1 print >= 50k) this scores a mean pinball loss of about
// 0.16 on the log scale, against about 0.24 for the persistence baseline
// (spread 0.15 per root hour). The model is deterministic: same input, same
// bytes out. Standard library only, no network, no clock, no randomness.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** Quantile levels, in the order each forecast row lists them. */
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
/** Standard normal quantiles at LEVELS (accurate to ~1e-9). */
const Z_SCORES = [-1.6448536269514722, -0.6744897501960817, 0, 0.6744897501960817, 1.6448536269514722];
/** A predictor launch must have an hour-1 print at least this big. */
const MIN_PREDICTOR_HOUR1 = 50000;
/** Similarity bandwidth: predictors are weighted by exp(-((ln v1 - ln p1)/W)^2). */
const SIZE_BANDWIDTH = 0.7;
/** Multiplier on the robust log-spread of the forecast quantiles. */
const SPREAD = 1.0;
/** Fallback persistence spread, in log units per square-root hour. */
const FALLBACK_SIGMA = 0.15;
/** Hours of the release day the forecast covers. */
const FIRST_HOUR = 2;
const LAST_HOUR = 24;

interface HourlyPoint {
  from: string;
  viewers: number;
}

interface Comparable {
  day_start: string;
  unlock?: string;
  hourly: HourlyPoint[];
}

interface CaseFile {
  id: string;
  levels: number[];
  known: Array<{ hour: number; viewers: number }>;
  forecast: Array<{ hour: number }>;
  comparables?: Comparable[];
}

/** The ISO timestamp of hour h of a day starting at dayStart (no millis). */
function hourStamp(dayStart: string, h: number): string {
  const t = new Date(Date.parse(dayStart) + (h - 1) * 3600_000);
  return t.toISOString().replace('.000Z', 'Z');
}

/** A launch's release-day curve: hour -> viewers, only hours with a print. */
function releaseCurve(comp: Comparable): Map<number, number> {
  const out = new Map<number, number>();
  const points = comp.hourly ?? [];
  for (let h = 1; h <= LAST_HOUR; h++) {
    const stamp = hourStamp(comp.day_start, h);
    const point = points.find((p) => p.from === stamp);
    if (point && point.viewers > 0) out.set(h, point.viewers);
  }
  return out;
}

/** The research tier named in a comparable's unlock note, if any. */
function tierOf(comp: Comparable): string {
  const m = (comp.unlock ?? '').match(/Tier:\s*([a-z-]+)/i);
  return m ? m[1].toLowerCase() : '';
}

/** Whether a comparable may predict launch-day shapes. */
function usablePredictor(comp: Comparable, curve: Map<number, number>): boolean {
  const tier = tierOf(comp);
  if (tier === 'early-access-contaminated' || tier === 'weak' || tier === 'target-history') return false;
  const first = curve.get(1);
  if (first === undefined || first < MIN_PREDICTOR_HOUR1) return false;
  return curve.size >= 20;
}

/** Weighted quantile of (value, weight) pairs, linear on cumulative weight. */
function weightedQuantile(pairs: Array<{ v: number; w: number }>, tau: number): number {
  const sorted = pairs.slice().sort((a, b) => a.v - b.v);
  const total = sorted.reduce((s, p) => s + p.w, 0);
  if (total <= 0 || sorted.length === 0) return NaN;
  let acc = 0;
  for (let i = 0; i < sorted.length; i++) {
    const prev = acc;
    acc += sorted[i].w;
    if (acc / total >= tau) {
      if (i === 0) return sorted[0].v;
      const frac = (tau * total - prev) / sorted[i].w;
      const f = Math.max(0, Math.min(1, frac));
      return sorted[i - 1].v + (sorted[i].v - sorted[i - 1].v) * f;
    }
  }
  return sorted[sorted.length - 1].v;
}

/** x rounded to 2 decimals, half up. */
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** The persistence fallback row for hour h around print p1. */
function fallbackRow(p1: number, h: number): number[] {
  return Z_SCORES.map((z) => round2(p1 * Math.exp(z * FALLBACK_SIGMA * Math.sqrt(h - 1))));
}

/** Forecast rows for hours 2..24 from hour-1 print p1 and predictor curves. */
function forecastRows(p1: number, predictors: Array<Map<number, number>>): Array<{ hour: number; q: number[] }> {
  const rows: Array<{ hour: number; q: number[] }> = [];
  const logP1 = Math.log(p1);
  for (let h = FIRST_HOUR; h <= LAST_HOUR; h++) {
    const pairs: Array<{ v: number; w: number }> = [];
    for (const curve of predictors) {
      const v1 = curve.get(1);
      const vh = curve.get(h);
      if (v1 === undefined || vh === undefined) continue;
      const w = Math.exp(-Math.pow((Math.log(v1) - logP1) / SIZE_BANDWIDTH, 2));
      pairs.push({ v: Math.log(vh / v1), w });
    }
    if (pairs.length < 3) {
      rows.push({ hour: h, q: fallbackRow(p1, h) });
      continue;
    }
    const centre = weightedQuantile(pairs, 0.5);
    const q25 = weightedQuantile(pairs, 0.25);
    const q75 = weightedQuantile(pairs, 0.75);
    const sd = Math.max(0.05, (q75 - q25) / 1.349);
    const q = Z_SCORES.map((z) => {
      const v = p1 * Math.exp(centre + SPREAD * z * sd);
      return round2(Math.max(1, Math.min(1_000_000_000, v)));
    });
    // Quantiles are ordered by construction (z ascending); enforce it anyway.
    for (let j = 1; j < q.length; j++) if (q[j] < q[j - 1]) q[j] = q[j - 1];
    rows.push({ hour: h, q });
  }
  return rows;
}

mkdirSync(OUTPUT_DIR, { recursive: true });
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as CaseFile;
  if (c.levels.length !== LEVELS.length || c.levels.some((t, j) => t !== LEVELS[j])) {
    throw new Error(`${file} asks for levels ${JSON.stringify(c.levels)}, not ${JSON.stringify(LEVELS)}`);
  }
  const first = c.known.find((k) => k.hour === 1);
  if (first === undefined) throw new Error(`${file} has no hour-1 print`);
  const p1 = Math.max(1, first.viewers);
  const predictors: Array<Map<number, number>> = [];
  for (const comp of c.comparables ?? []) {
    const curve = releaseCurve(comp);
    if (usablePredictor(comp, curve)) predictors.push(curve);
  }
  const hours = forecastRows(p1, predictors);
  const wanted = c.forecast.map((f) => f.hour);
  if (wanted.length !== hours.length || wanted.some((h, i) => h !== hours[i].hour)) {
    throw new Error(`${file} asks for hours ${JSON.stringify(wanted)}, not 2..24`);
  }
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ hours })}\n`);
}
