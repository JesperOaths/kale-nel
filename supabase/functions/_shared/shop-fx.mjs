const ECB_DAILY_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
const PAIR = "USD_EUR";
const BASE_CURRENCY = "USD";
const QUOTE_CURRENCY = "EUR";
const CACHE_FRESH_MS = 6 * 60 * 60 * 1000;
const MAX_OBSERVED_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 6000;

const text = value => String(value ?? "").trim();
const roundedRate = value => Math.round(Number(value) * 1e10) / 1e10;

function timestampMs(value) {
  const ms = Date.parse(text(value));
  return Number.isFinite(ms) ? ms : 0;
}

function observedMs(value) {
  const iso = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return 0;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : 0;
}

function normalizeSnapshot(row, stale = false) {
  const rate = Number(row?.rate);
  const sourceRate = Number(row?.source_rate);
  const observedOn = text(row?.observed_on);
  const fetchedAt = text(row?.fetched_at);
  if (!Number.isFinite(rate) || rate <= 0 || rate >= 10 || !observedMs(observedOn)) return null;
  return Object.freeze({
    pair: PAIR,
    base_currency: BASE_CURRENCY,
    quote_currency: QUOTE_CURRENCY,
    rate: roundedRate(rate),
    source: text(row?.source) || "ecb_reference",
    source_rate: Number.isFinite(sourceRate) && sourceRate > 0 ? roundedRate(sourceRate) : null,
    observed_on: observedOn,
    fetched_at: fetchedAt || new Date().toISOString(),
    stale: stale === true,
  });
}

function cachedUsable(snapshot) {
  if (!snapshot) return false;
  const fetched = timestampMs(snapshot.fetched_at);
  const observed = observedMs(snapshot.observed_on);
  if (!fetched || !observed) return false;
  const now = Date.now();
  return now - fetched <= CACHE_FRESH_MS && now - observed <= MAX_OBSERVED_AGE_MS;
}

function staleFallbackUsable(snapshot) {
  if (!snapshot) return false;
  const observed = observedMs(snapshot.observed_on);
  return !!observed && Date.now() - observed <= MAX_OBSERVED_AGE_MS;
}

export function parseEcbUsdRate(xml) {
  const body = text(xml);
  const dateMatch = body.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/i);
  const direct = body.match(/currency=['"]USD['"][^>]*rate=['"]([0-9]+(?:\.[0-9]+)?)['"]/i);
  const reverse = body.match(/rate=['"]([0-9]+(?:\.[0-9]+)?)['"][^>]*currency=['"]USD['"]/i);
  const eurUsd = Number((direct || reverse)?.[1]);
  const observedOn = text(dateMatch?.[1]);
  if (!observedOn || !Number.isFinite(eurUsd) || eurUsd <= 0) throw new Error("ECB USD reference rate unavailable");
  const usdEur = roundedRate(1 / eurUsd);
  if (!Number.isFinite(usdEur) || usdEur <= 0 || usdEur >= 10) throw new Error("ECB USD/EUR conversion rate invalid");
  return Object.freeze({ observed_on: observedOn, eur_usd: roundedRate(eurUsd), usd_eur: usdEur });
}

async function fetchEcbSnapshot() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(ECB_DAILY_URL, {
      signal: controller.signal,
      headers: { Accept: "application/xml,text/xml;q=0.9,*/*;q=0.1", "User-Agent": "Kalenel-Shop-FX/8.34" },
    });
    if (!response.ok) throw new Error(`ECB reference rate HTTP ${response.status}`);
    const parsed = parseEcbUsdRate(await response.text());
    const now = new Date().toISOString();
    return normalizeSnapshot({
      rate: parsed.usd_eur,
      source: "ecb_reference",
      source_rate: parsed.eur_usd,
      observed_on: parsed.observed_on,
      fetched_at: now,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveUsdEurRate(supabase) {
  let cached = null;
  try {
    const { data, error } = await supabase.from("shop_fx_rates")
      .select("pair,base_currency,quote_currency,rate,source,source_rate,observed_on,fetched_at")
      .eq("pair", PAIR)
      .maybeSingle();
    if (!error) cached = normalizeSnapshot(data);
  } catch {}

  if (cachedUsable(cached)) return cached;

  try {
    const live = await fetchEcbSnapshot();
    if (!live) throw new Error("ECB USD/EUR snapshot unavailable");
    const row = {
      pair: PAIR,
      base_currency: BASE_CURRENCY,
      quote_currency: QUOTE_CURRENCY,
      rate: live.rate,
      source: live.source,
      source_rate: live.source_rate,
      observed_on: live.observed_on,
      fetched_at: live.fetched_at,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("shop_fx_rates").upsert(row, { onConflict: "pair" });
    if (error) console.warn("shop FX cache update failed", error.message || "unknown");
    return live;
  } catch (error) {
    if (staleFallbackUsable(cached)) return Object.freeze({ ...cached, stale: true });
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`USD/EUR exchange rate unavailable: ${detail.slice(0, 180)}`);
  }
}

function rateValue(snapshotOrRate) {
  const rate = typeof snapshotOrRate === "number" ? snapshotOrRate : Number(snapshotOrRate?.rate);
  if (!Number.isFinite(rate) || rate <= 0 || rate >= 10) throw new Error("Invalid USD/EUR exchange rate");
  return rate;
}

export function usdCentsToEurCents(rawUsdCents, snapshotOrRate) {
  const cents = Number(rawUsdCents);
  if (!Number.isFinite(cents) || cents < 0) throw new Error("Invalid USD-cent amount");
  return Math.round(cents * rateValue(snapshotOrRate));
}

export function retailEurCentsFromUsdCost(rawUsdCents, snapshotOrRate, marginEurCents = 500, minimumRetailEurCents = 0) {
  const margin = Math.round(Number(marginEurCents));
  const minimum = Math.round(Number(minimumRetailEurCents));
  if (!Number.isFinite(margin) || margin < 0) throw new Error("Invalid EUR margin");
  if (!Number.isFinite(minimum) || minimum < 0) throw new Error("Invalid minimum EUR retail price");
  const converted = usdCentsToEurCents(rawUsdCents, snapshotOrRate);
  return Math.max(minimum, Math.ceil((converted + margin) / 100) * 100);
}

export function eurCentsToUsdCents(rawEurCents, snapshotOrRate) {
  const cents = Number(rawEurCents);
  if (!Number.isFinite(cents) || cents < 0) throw new Error("Invalid EUR-cent amount");
  return Math.round(cents / rateValue(snapshotOrRate));
}

export function fxAuditSnapshot(snapshot) {
  return {
    pair: PAIR,
    base_currency: BASE_CURRENCY,
    quote_currency: QUOTE_CURRENCY,
    rate: rateValue(snapshot),
    source: text(snapshot?.source) || "ecb_reference",
    source_rate: Number.isFinite(Number(snapshot?.source_rate)) ? Number(snapshot.source_rate) : null,
    observed_on: text(snapshot?.observed_on) || null,
    fetched_at: text(snapshot?.fetched_at) || null,
    stale: snapshot?.stale === true,
  };
}

export const PRINTIFY_SOURCE_CURRENCY = BASE_CURRENCY;
