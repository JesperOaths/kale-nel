#!/usr/bin/env python3
"""Bounded dual-TLS authenticated UTC estimate for future signed S9 intents.

This is NOT a clock repair, NOT an action signing service, and NOT a way to
loosen token verification. A caller must independently authenticate the user
and use a dedicated HMAC key. Current signed-action production readiness
continues to require the existing clock gate until a reviewed integration.
No credentials, media or recording state are touched here.

Each call probes 3 fixed HTTPS sites with the system CA verifier, admits >=2
distinct independent matching HTTP Date origins, and refuses clock leaps,
inconclusive offsets, slow responses and stale calibration. A successful
result is ephemeral: NEVER persist it as an NTP replacement.
"""
import dataclasses
import datetime
import email.utils
import json
import math
import statistics
import time
import urllib.parse
import urllib.request

ORIGINS=("www.cloudflare.com","www.microsoft.com","www.google.com")
REQUIRED=2
MAX_RTT_SECONDS=3.5
MAX_SPREAD_SECONDS=2.5
MAX_ABSOLUTE_CORRECTION_SECONDS=180.0
MAX_SAMPLING_SECONDS=25.0
MAX_CLOCK_LEAP_SECONDS=0.75
MAX_USE_AGE_SECONDS=5.0
MIN_UNIX_SECONDS=1600000000
MAX_UNIX_SECONDS=2200000000

class UntrustedTimeError(RuntimeError):
    """Fail closed without revealing source details or private state."""

@dataclasses.dataclass(frozen=True)
class Observation:
    host: str
    correction_s: float
    rtt_s: float

@dataclasses.dataclass(frozen=True)
class AttestedUtc:
    """Ephemeral candidate only, not token authority or signing permission."""
    unix_at_sample: float
    mono_at_sample: float
    correction_s: float
    source_count: int
    max_spread_s: float
    uncertainty_s: float

    def now_unix(self) -> float:
        """Refuse stale samples and monotonic rollback."""
        age=time.monotonic()-self.mono_at_sample
        if not math.isfinite(age) or age < 0 or age > MAX_USE_AGE_SECONDS:
            raise UntrustedTimeError("trusted_utc_expired_or_monotonic_invalid")
        result=self.unix_at_sample+age
        if not MIN_UNIX_SECONDS < result < MAX_UNIX_SECONDS:
            raise UntrustedTimeError("trusted_utc_epoch_invalid")
        return result

    def allows_signature_bypass(self):return False
    def authorizes_remote_action(self):return False
    def changes_system_clock(self):return False

def _request(host: str)->Observation:
    if host not in ORIGINS:
        raise UntrustedTimeError("time_origin_unrecognized")
    uri="https://"+host+"/"
    before=time.time()
    mono_start=time.monotonic()
    try:
        request=urllib.request.Request(uri,method="HEAD",
            headers={"User-Agent":"c720p-ephemeral-utc-v234"})
        # System CA and hostname verification remain enabled.
        with urllib.request.urlopen(request,timeout=6) as response:
            if response.status not in (200,204) or \
                    urllib.parse.urlparse(response.geturl()).hostname!=host or \
                    urllib.parse.urlparse(response.geturl()).scheme!="https":
                raise UntrustedTimeError("time_origin_response_invalid")
            date=response.headers.get("Date")
    except (OSError,ValueError):
        raise UntrustedTimeError("https_utc_source_unavailable") from None
    mono_end=time.monotonic()
    after=time.time()
    latency=mono_end-mono_start
    if not math.isfinite(latency) or not (0<=latency<=MAX_RTT_SECONDS) or \
            abs((after-before)-latency)>MAX_CLOCK_LEAP_SECONDS:
        raise UntrustedTimeError("https_utc_source_slow_or_clock_jump")
    try:
        parsed=email.utils.parsedate_to_datetime(date)
        if parsed.tzinfo is None:
            raise ValueError("naive date")
        unix=parsed.timestamp()
    except (ValueError,OverflowError,TypeError,AttributeError):
        raise UntrustedTimeError("https_utc_date_invalid") from None
    if not MIN_UNIX_SECONDS<unix<MAX_UNIX_SECONDS:
        raise UntrustedTimeError("https_utc_epoch_invalid")
    return Observation(host,unix-((before+after)/2),latency)

def calibrated_utc() -> AttestedUtc:
    wall_begin=time.time()
    mono_begin=time.monotonic()
    readings=[]
    for origin in ORIGINS:
        try:
            readings.append(_request(origin))
        except UntrustedTimeError:
            continue
    mono_finish=time.monotonic()
    wall_finish=time.time()
    elapsed=mono_finish-mono_begin
    if not math.isfinite(elapsed) or elapsed<0 or \
            elapsed>MAX_SAMPLING_SECONDS or \
            abs((wall_finish-wall_begin)-elapsed)>MAX_CLOCK_LEAP_SECONDS:
        raise UntrustedTimeError("trusted_utc_sampling_stale_or_clock_jump")
    unique={x.host for x in readings}
    if len(unique)<REQUIRED or len(unique)!=len(readings):
        raise UntrustedTimeError("trusted_utc_independent_sources_missing")
    offsets=[x.correction_s for x in readings]
    if any(not math.isfinite(v) or abs(v)>MAX_ABSOLUTE_CORRECTION_SECONDS
           for v in offsets):
        raise UntrustedTimeError("trusted_utc_correction_outside_safety_bound")
    spread=max(offsets)-min(offsets)
    if spread>MAX_SPREAD_SECONDS:
        raise UntrustedTimeError("trusted_utc_disagreement")
    median=statistics.median(offsets)
    # Date is second-resolution. This is a conservative *displayed* estimate
    # of uncertainty, never grounds for extending HMAC token validity.
    error=0.5 + max(x.rtt_s for x in readings)/2 + spread/2
    if not math.isfinite(error) or error>3.5:
        raise UntrustedTimeError("trusted_utc_uncertainty_outside_safety_bound")
    corrected=wall_finish+median
    if not MIN_UNIX_SECONDS<corrected<MAX_UNIX_SECONDS:
        raise UntrustedTimeError("trusted_utc_epoch_invalid")
    return AttestedUtc(corrected,mono_finish,median,len(unique),spread,error)

def main():
    try:
        estimate=calibrated_utc()
        # Read-only diagnostics; no token, browser session, private filenames,
        # secrets or media details are emitted.
        result={
            "status":"correlated_tls_time_verified",
            "source_count":estimate.source_count,
            "corrects_local_clock_by_seconds":round(estimate.correction_s,2),
            "spread_seconds":round(estimate.max_spread_s,2),
            "uncertainty_seconds":round(estimate.uncertainty_s,2),
            "ephemeral_age_limit_seconds":MAX_USE_AGE_SECONDS,
            "does_not_modify_system_clock":True,
            "remote_actions_enabled":False,
            "token_ttl_or_hmac_rules_modified":False,
            "media_or_person_reviews_modified":False,
            "production_clock_readiness_gate_changed":False,
        }
        code=0
    except Exception as err:
        known=err.args[0] if isinstance(err,UntrustedTimeError) else None
        result={
            "status":"fail_closed","reason":known or "unverified",
            "does_not_modify_system_clock":True,
            "remote_actions_enabled":False,
            "token_ttl_or_hmac_rules_modified":False,
            "production_clock_readiness_gate_changed":False,
        }
        code=2
    print("C720P_CORRELATED_TLS_UTC_V234 "+json.dumps(result,sort_keys=True))
    raise SystemExit(code)

if __name__=="__main__":
    main()
