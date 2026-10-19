"""Pure, narrowly scoped Security cache-key transforms; no IO or deployment.

The caller supplies fresh text and the real HA dashboard document, then owns
backup, concurrent-source guards, staging, validation and deployment. Do not
alter global/static response headers or unrelated asset version identifiers.
"""
import copy
import re
import urllib.parse

RELEASE = "continuity-20261019-v1"
ENTRY = "/local/c720p-surveillance.html"
SECURITY_VIEW_PATH = "front-yard-security"
ASSET_ROOT = "/local/frontyard-security-new/"
NIGHT_SCRIPT = ASSET_ROOT + "s9-night-visibility-v1.js"
HTML_SCRIPTS = {
    "c720p-surveillance.html": ASSET_ROOT + "security-hub-v30.js",
    "security-hub-v30.html": ASSET_ROOT + "security-hub-v30.js",
    "security-people-v50.html": ASSET_ROOT + "security-people-v45.js",
}
SCRIPT_SOURCE = re.compile(
    r"<script\b[^>]*?\ssrc\s*=\s*(?P<quote>['\"])(?P<url>[^'\"]+)(?P=quote)[^>]*>",
    re.IGNORECASE,
)
HUB_VERSION = re.compile(
    r"\basset=(?P<asset_quote>['\"])/local/frontyard-security-new/(?P=asset_quote),"
    r"version=(?P<quote>['\"])(?P<value>v=[A-Za-z0-9._-]+)(?P=quote)"
)


def validate_release(release):
    if not isinstance(release, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{1,79}", release):
        raise ValueError("invalid_security_release_key")


def release_url(url, expected_path, release=RELEASE):
    """Replace exactly the local URL's v value, preserving other raw fields.

    The URL must already have one canonical v query key. Unexpected missing,
    encoded or duplicate v keys fail closed rather than inventing a new shape.
    """
    validate_release(release)
    if not isinstance(url, str):
        raise ValueError("invalid_security_asset_url")
    parsed = urllib.parse.urlsplit(url)
    if (parsed.scheme or parsed.netloc or parsed.path != expected_path
            or not url.startswith(expected_path + "?")):
        raise ValueError("unexpected_security_asset_url")
    head, marker, fragment = url.partition("#")
    base, _, query = head.partition("?")
    parts = query.split("&")
    keys = [(index, part.partition("=")[0]) for index, part in enumerate(parts)
            if urllib.parse.unquote_plus(part.partition("=")[0]) == "v"]
    if len(keys) != 1 or keys[0][1] != "v":
        raise ValueError("expected_one_canonical_security_version")
    parts[keys[0][0]] = "v=" + release
    return base + "?" + "&".join(parts) + (marker + fragment if marker else "")


def patch_html(text, script_path, release=RELEASE):
    """Touch only one existing script src URL; preserve all surrounding text."""
    validate_release(release)
    matches = [match for match in SCRIPT_SOURCE.finditer(text)
               if urllib.parse.urlsplit(match.group("url")).path == script_path]
    if len(matches) != 1:
        raise ValueError("expected_one_security_script_reference")
    match = matches[0]
    updated = release_url(match.group("url"), script_path, release)
    return text[:match.start("url")] + updated + text[match.end("url"):]


def patch_hub_js(text, release=RELEASE):
    """Refresh the existing child-page suffix, leaving tab routes untouched."""
    validate_release(release)
    matches = list(HUB_VERSION.finditer(text))
    if len(matches) != 1:
        raise ValueError("expected_one_security_child_version")
    match = matches[0]
    return text[:match.start("value")] + "v=" + release + text[match.end("value"):]


def patch_asset(name, text, release=RELEASE):
    if name in HTML_SCRIPTS:
        result = patch_html(text, HTML_SCRIPTS[name], release)
        # The outer entry always loads the independently maintained night UI.
        # Some inner shell copies include it too; preserve copies without it.
        night_present = any(urllib.parse.urlsplit(m.group('url')).path == NIGHT_SCRIPT
                            for m in SCRIPT_SOURCE.finditer(result))
        if name == 'c720p-surveillance.html' or (name == 'security-hub-v30.html' and night_present):
            result = patch_html(result, NIGHT_SCRIPT, release)
        return result
    if name == "security-hub-v30.js":
        return patch_hub_js(text, release)
    raise ValueError("unsupported_security_cache_asset")


def patch_dashboard(document, release=RELEASE):
    """Deep-copy a dashboard and refresh only its unique Security iframe.

    Accepts HA's .storage data.config wrapper or a bare dashboard config.
    Recurse through cards within the verified front-yard-security view only.
    A similarly titled view at any other path is outside this release's scope.
    """
    validate_release(release)
    if not isinstance(document, dict):
        raise ValueError("invalid_security_dashboard")
    result = copy.deepcopy(document)
    if isinstance(result.get("data"), dict) and isinstance(result["data"].get("config"), dict):
        config = result["data"]["config"]
    else:
        config = result
    views = config.get("views")
    if not isinstance(views, list):
        raise ValueError("dashboard_views_unavailable")
    selected = [view for view in views if isinstance(view, dict) and view.get("path") == SECURITY_VIEW_PATH]
    if len(selected) != 1 or not isinstance(selected[0].get("cards"), list):
        raise ValueError("expected_one_security_view")
    candidates = []

    def visit(value):
        if isinstance(value, dict):
            if value.get("type") == "iframe" and isinstance(value.get("url"), str):
                if urllib.parse.urlsplit(value["url"]).path == ENTRY:
                    candidates.append(value)
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    visit(selected[0]["cards"])
    if len(candidates) != 1:
        raise ValueError("expected_one_security_entry_iframe")
    candidates[0]["url"] = release_url(candidates[0]["url"], ENTRY, release)
    return result
