#!/usr/bin/env python3
"""C720P HTTPS-attested UTC for FUTURE S9 signed-intent issuer (V234).

NO NTP changes, privileges, authentication bypass, token minting, phone
access, camera processing, original video reads or permanent runtime writes.

Existing V226 NTP readiness still fails while OS NTP is unsynchronized.
This is an ALTERNATIVE clock confidence primitive, not a bypass or a live
replacement: a future authenticated, server-only issuer must explicitly
integrate it and separately enforce signed HMAC, user approval and TTL.

Time samples come from independent CA-validated HTTPS HEAD Date headers.
Single providers, redirects, stale cached headers, long round trips,
local wall-clock jumps and inconsistent sources FAIL CLOSED.
"""
import dataclasses
import datetime as dt
import email.utils
import json
import ssl
import statistics
import time
import urllib.error
import urllib.parse
import urllib.request

MARK="C720P_S9_HTTPS_CLOCK_V234 "
HOSTS=("www.google.com","www.microsoft.com","www.cloudflare.com","github.com")
MAX_RTT_S=4.0
MAX_EPOCH_OFFSET_S=600.0
MAX_DISAGREEMENT_S=3.0
MAX_SAMPLE_AGE_S=18.0
SOURCE_TIMEOUT_S=4.5
MAX_WALL_JUMP_S=1.5

class Refusal(Exception):
    pass

def demand(condition, reason):
    if not condition:
        raise Refusal(reason)

@dataclasses.dataclass(frozen=True)
class Sample:
    host: str
    remote_epoch_s: float
    monotonic_mid_s: float
    duration_s: float
    remote_minus_local_s: float

@dataclasses.dataclass(frozen=True)
class Confidence:
    epoch_ms: int
    source_hosts: tuple
    source_spread_s: float
    remote_minus_hub_s: float
    sampled_at_monotonic_s: float
    def valid_for_signing_at(self, monotonic_now_s):
        return 0 <= monotonic_now_s-self.sampled_at_monotonic_s <= 2

class _NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, new_url):
        raise Refusal("https_time_redirect_forbidden")

def _header_date(response):
    values=response.headers.get_all("Date")
    demand(values is not None and len(values)==1,
           "tls_date_missing_or_ambiguous")
    ages=response.headers.get_all("Age") or []
    demand(len(ages)<=1, "tls_age_ambiguous")
    if ages:
        try:
            age=int(ages[0])
        except (TypeError,ValueError):
            raise Refusal("tls_cached_age_invalid") from None
        demand(0<=age<=1,"tls_date_cached_or_stale")
    try:
        parsed=email.utils.parsedate_to_datetime(values[0])
        demand(parsed.tzinfo is not None,"tls_date_timezone_missing")
        epoch=parsed.timestamp()
    except (TypeError,ValueError,OverflowError):
        raise Refusal("tls_date_invalid") from None
    demand(1600000000<epoch<2200000000,"tls_date_epoch_implausible")
    return epoch

def _single_source(host,wall=time.time,monotonic=time.monotonic):
    demand(host in HOSTS,"non_allowlisted_tls_time_origin")
    opener=urllib.request.build_opener(
        urllib.request.HTTPSHandler(context=ssl.create_default_context()),
        _NoRedirects())
    request=urllib.request.Request("https://"+host+"/",method="HEAD",
        headers={"User-Agent":"c720p-s9-time-source-v234",
                 "Cache-Control":"no-store,no-cache","Pragma":"no-cache"})
    before_wall=wall()
    before_mono=monotonic()
    try:
        with opener.open(request,timeout=SOURCE_TIMEOUT_S) as response:
            demand(response.status in (200,204),"tls_time_http_status_invalid")
            final=urllib.parse.urlparse(response.geturl())
            demand(final.scheme=="https" and final.hostname==host
                   and final.port is None and final.username is None,
                   "tls_time_origin_changed")
            epoch=_header_date(response)
    except Refusal:raise
    except (OSError,urllib.error.URLError,ValueError,TimeoutError):
        raise Refusal("https_time_origin_unavailable") from None
    after_mono=monotonic()
    after_wall=wall()
    duration=after_mono-before_mono
    demand(0<=duration<=MAX_RTT_S,"https_time_roundtrip_too_slow")
    demand(abs((after_wall-before_wall)-duration)<=MAX_WALL_JUMP_S,
           "hub_clock_changed_during_https_attestation")
    offset=epoch-(before_wall+after_wall)/2
    demand(abs(offset)<=MAX_EPOCH_OFFSET_S,
           "https_time_outside_bounded_hub_offset")
    return Sample(host,epoch,(before_mono+after_mono)/2,duration,offset)

def evaluate(samples, now_monotonic_s, now_wall_s):
    """Evaluate already collected TLS-authenticated Source samples.

    The observations themselves MUST originate from _single_source() in the
    trusted C720P backend; this pure function only enables synthetic tests.
    """
    distinct={}
    for source in samples:
        if not isinstance(source,Sample) or source.host not in HOSTS:
            continue
        age=now_monotonic_s-source.monotonic_mid_s
        if (not 0<=age<=MAX_SAMPLE_AGE_S
                or not 0<=source.duration_s<=MAX_RTT_S
                or abs(source.remote_minus_local_s)>MAX_EPOCH_OFFSET_S):
            continue
        if source.host in distinct:
            raise Refusal("duplicate_tls_time_source")
        distinct[source.host]=source
    demand(len(distinct)>=2,"two_independent_https_clocks_required")
    estimated=sorted((s.remote_epoch_s+
                     now_monotonic_s-s.monotonic_mid_s,s.host)
                     for s in distinct.values())
    groups=[]
    for i in range(len(estimated)):
        group=[(v,h) for v,h in estimated[i:]
               if v-estimated[i][0]<=MAX_DISAGREEMENT_S]
        if len(group)>=2:groups.append(group)
    demand(groups,"independent_https_clocks_disagree")
    length=max(len(group) for group in groups)
    best=[group for group in groups if len(group)==length]
    # Two incompatible, equally supported time clusters are not an oracle.
    unique={tuple(sorted(host for _,host in group)) for group in best}
    demand(len(unique)==1,"conflicting_time_majorities")
    chosen=best[0]
    spread=max(v for v,_ in chosen)-min(v for v,_ in chosen)
    trusted=statistics.median([v for v,_ in chosen])
    offset=trusted-now_wall_s
    demand(abs(offset)<=MAX_EPOCH_OFFSET_S,
           "attested_time_outside_bounded_offset")
    return Confidence(round(trusted*1000),
        tuple(sorted(host for _,host in chosen)),round(spread,3),
        round(offset,3),now_monotonic_s)

def attest_now_ms():
    """One-shot, fresh C720P server-side clock confidence; no persistence."""
    attempts=[]
    start=time.monotonic()
    for host in HOSTS:
        if time.monotonic()-start>=MAX_SAMPLE_AGE_S:
            break
        try:
            attempts.append(_single_source(host))
        except Refusal:
            continue
    confidence=evaluate(attempts,time.monotonic(),time.time())
    demand(confidence.valid_for_signing_at(time.monotonic()),
           "time_evidence_not_immediately_fresh")
    return confidence

def main():
    try:
        result=attest_now_ms()
        output={"status":"independent_https_clock_attested",
            "clock_source_count":len(result.source_hosts),
            "sources":result.source_hosts,
            "source_spread_s":result.source_spread_s,
            "remote_minus_hub_s":result.remote_minus_hub_s,
            "ready_for_future_issuer_clock_integration":True,
            "production_signer_enabled":False,
            "os_ntp_changed":False,"originals_or_reviews_touched":False}
    except Refusal as error:
        # Bound reason vocabulary, no external URL/error traceback leakage.
        allowed={"two_independent_https_clocks_required",
          "independent_https_clocks_disagree","conflicting_time_majorities",
          "attested_time_outside_bounded_offset",
          "duplicate_tls_time_source",
          "time_evidence_not_immediately_fresh"}
        output={"status":"no_attested_time",
            "reason":str(error) if str(error) in allowed
                     else "tls_sources_unavailable_or_untrusted",
            "ready_for_future_issuer_clock_integration":False,
            "production_signer_enabled":False,
            "os_ntp_changed":False,"originals_or_reviews_touched":False}
    print(MARK+json.dumps(output,sort_keys=True,separators=(",",":")),flush=True)
    if output["status"]!="independent_https_clock_attested":
        raise SystemExit(1)

if __name__=="__main__":
    main()
