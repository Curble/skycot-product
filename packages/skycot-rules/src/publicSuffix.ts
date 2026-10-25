import { PUBLIC_SUFFIX_LIST } from "./publicSuffixList.ts";

const BASE = 36;
const TMIN = 1;
const TMAX = 26;
const SKEW = 38;
const DAMP = 700;
const INITIAL_BIAS = 72;
const INITIAL_N = 128;

function digit(value: number): string {
  return String.fromCharCode(value + (value < 26 ? 97 : 22));
}

function adapt(delta: number, points: number, first: boolean): number {
  let adjusted = first ? Math.floor(delta / DAMP) : Math.floor(delta / 2);
  adjusted += Math.floor(adjusted / points);
  let k = 0;
  while (adjusted > Math.floor(((BASE - TMIN) * TMAX) / 2)) {
    adjusted = Math.floor(adjusted / (BASE - TMIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - TMIN + 1) * adjusted) / (adjusted + SKEW));
}

/** IDNA's punycode encoding keeps the matcher independent of platform URL APIs. */
function asciiLabel(label: string): string | null {
  const points = Array.from(label, (character) => character.codePointAt(0)!);
  if (points.every((point) => point < 0x80)) return label.toLowerCase();

  let output = "";
  for (const point of points) {
    if (point < 0x80) output += String.fromCharCode(point).toLowerCase();
  }
  const basic = output.length;
  let handled = basic;
  if (basic > 0) output += "-";
  let n = INITIAL_N;
  let delta = 0;
  let bias = INITIAL_BIAS;

  while (handled < points.length) {
    let next = Number.POSITIVE_INFINITY;
    for (const point of points) if (point >= n && point < next) next = point;
    if (
      !Number.isFinite(next) ||
      next - n > Math.floor((Number.MAX_SAFE_INTEGER - delta) / (handled + 1))
    ) {
      return null;
    }
    delta += (next - n) * (handled + 1);
    n = next;
    for (const point of points) {
      if (point < n) {
        delta += 1;
        if (!Number.isSafeInteger(delta)) return null;
      }
      if (point !== n) continue;
      let q = delta;
      for (let k = BASE; ; k += BASE) {
        const threshold = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
        if (q < threshold) break;
        const code = threshold + ((q - threshold) % (BASE - threshold));
        output += digit(code);
        q = Math.floor((q - threshold) / (BASE - threshold));
      }
      output += digit(q);
      bias = adapt(delta, handled + 1, handled === basic);
      delta = 0;
      handled += 1;
    }
    delta += 1;
    n += 1;
  }
  return `xn--${output}`;
}

function asciiDomain(domain: string): string | null {
  const labels = domain.split(".");
  const converted: Array<string> = [];
  for (const label of labels) {
    const ascii = asciiLabel(label);
    if (ascii === null) return null;
    converted.push(ascii);
  }
  return converted.join(".");
}

const exactRules = new Set<string>();
const wildcardRules = new Set<string>();
const exceptionRules = new Set<string>();

for (const line of PUBLIC_SUFFIX_LIST.split("\n")) {
  const rule = line.trim();
  if (rule === "" || rule.startsWith("//")) continue;
  if (rule.startsWith("!")) {
    const ascii = asciiDomain(rule.slice(1));
    if (ascii !== null) exceptionRules.add(ascii);
  } else if (rule.startsWith("*.")) {
    const ascii = asciiDomain(rule.slice(2));
    if (ascii !== null) wildcardRules.add(ascii);
  } else {
    const ascii = asciiDomain(rule);
    if (ascii !== null) exactRules.add(ascii);
  }
}

/** Returns a host's registrable domain under the complete ICANN and private PSL sections. */
export function registrableDomain(host: string): string | null {
  const ascii = asciiDomain(host);
  if (ascii === null) return null;
  const labels = ascii.split(".");
  let publicSuffixLabels = 1;

  for (let index = 0; index < labels.length; index += 1) {
    const suffix = labels.slice(index).join(".");
    if (exceptionRules.has(suffix)) {
      publicSuffixLabels = labels.length - index - 1;
      break;
    }
    if (exactRules.has(suffix))
      publicSuffixLabels = Math.max(publicSuffixLabels, labels.length - index);
    if (index < labels.length - 1 && wildcardRules.has(labels.slice(index + 1).join("."))) {
      publicSuffixLabels = Math.max(publicSuffixLabels, labels.length - index);
    }
  }

  if (labels.length <= publicSuffixLabels) return null;
  return labels.slice(-(publicSuffixLabels + 1)).join(".");
}
