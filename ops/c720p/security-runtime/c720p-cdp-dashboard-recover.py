#!/usr/bin/env python3
import argparse
import base64
import json
import os
import socket
import struct
import sys
import time
import urllib.parse
import urllib.request

CDP = os.environ.get("C720P_CDP_BASE", "http://127.0.0.1:9222")
DASHBOARD_URL = os.environ.get("C720P_KIOSK_URL", "http://127.0.0.1:8123/c720p-hub/home")
GOOD_PATH = urllib.parse.urlparse(DASHBOARD_URL).path or "/c720p-hub/home"


class CDPError(Exception):
    pass


def http_json(url, timeout=3):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def find_tab():
    tabs = http_json(CDP + "/json", timeout=3)
    pages = [t for t in tabs if t.get("type") == "page"]
    for t in pages:
        if GOOD_PATH in (t.get("url") or ""):
            return t
    return pages[0] if pages else None


def ws_connect(ws_url):
    u = urllib.parse.urlparse(ws_url)
    host = u.hostname
    port = u.port or 80
    if u.scheme == "wss":
        raise CDPError("wss is not supported for local CDP")
    key = base64.b64encode(os.urandom(16)).decode("ascii")
    s = socket.create_connection((host, port), timeout=4)
    req = (
        f"GET {u.path} HTTP/1.1\r\n"
        f"Host: {host}:{port}\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        "Sec-WebSocket-Version: 13\r\n\r\n"
    )
    s.sendall(req.encode("ascii"))
    resp = b""
    while b"\r\n\r\n" not in resp:
        chunk = s.recv(4096)
        if not chunk:
            break
        resp += chunk
    if b" 101 " not in resp.split(b"\r\n", 1)[0]:
        raise CDPError("CDP websocket upgrade failed")
    return s


def ws_send(sock, obj):
    data = json.dumps(obj, separators=(",", ":")).encode("utf-8")
    header = bytearray([0x81])
    n = len(data)
    if n < 126:
        header.append(0x80 | n)
    elif n < 65536:
        header.append(0x80 | 126)
        header.extend(struct.pack("!H", n))
    else:
        header.append(0x80 | 127)
        header.extend(struct.pack("!Q", n))
    mask = os.urandom(4)
    header.extend(mask)
    sock.sendall(header + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))


def ws_recv(sock, timeout=6):
    deadline = time.monotonic() + timeout
    def read_exact(size):
        data = bytearray()
        while len(data) < size:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("CDP frame read timed out")
            sock.settimeout(remaining)
            chunk = sock.recv(size - len(data))
            if not chunk:
                raise CDPError("websocket closed during frame")
            data.extend(chunk)
        return bytes(data)
    first = read_exact(2)
    b1, b2 = first
    opcode = b1 & 0x0F
    masked = b2 & 0x80
    n = b2 & 0x7F
    if n == 126:
        n = struct.unpack("!H", read_exact(2))[0]
    elif n == 127:
        n = struct.unpack("!Q", read_exact(8))[0]
    mask = read_exact(4) if masked else b""
    data = bytearray(read_exact(n))
    if masked:
        data = bytearray(b ^ mask[i % 4] for i, b in enumerate(data))
    if opcode == 8:
        raise CDPError("websocket closed")
    if opcode != 1:
        return None
    return json.loads(data.decode("utf-8"))


class Client:
    def __init__(self, tab):
        self.sock = ws_connect(tab["webSocketDebuggerUrl"])
        self.next_id = 0

    def call(self, method, params=None, timeout=8):
        self.next_id += 1
        msg_id = self.next_id
        ws_send(self.sock, {"id": msg_id, "method": method, "params": params or {}})
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            r = ws_recv(self.sock, timeout=max(0.5, deadline - time.monotonic()))
            if r and r.get("id") == msg_id:
                if "error" in r:
                    raise CDPError(str(r["error"]))
                return r.get("result", {})
        raise CDPError(method + " timed out")

    def close(self):
        self.sock.close()


def evaluate(expr, timeout=10):
    tab = find_tab()
    if not tab:
        raise CDPError("no page tabs")
    c = Client(tab)
    try:
        return c.call(
            "Runtime.evaluate",
            {"expression": expr, "awaitPromise": True, "returnByValue": True, "timeout": timeout * 1000},
            timeout=timeout + 2,
        )
    finally:
        c.close()


def page_status():
    tab = find_tab()
    if not tab:
        return {"ok": False, "reason": "no_tab"}
    expr = """(() => {
      const app = document.querySelector('home-assistant') || document.querySelector('hui-root') || document.querySelector('ha-panel-lovelace');
      const bodyText = (document.body && document.body.innerText || '').trim();
      const launch = !!document.querySelector('#ha-launch-screen');
      return {
        url: location.href,
        title: document.title,
        readyState: document.readyState,
        bodyTextLength: bodyText.length,
        hasHomeAssistantElement: !!app,
        hasLaunchScreen: launch,
        background: getComputedStyle(document.body).backgroundColor
      };
    })()"""
    try:
        result = evaluate(expr, timeout=5).get("result", {}).get("value", {})
    except Exception as e:
        return {"ok": False, "reason": "eval_failed", "error": str(e), "tab": {"url": tab.get("url"), "title": tab.get("title")}}
    url = result.get("url") or tab.get("url") or ""
    ready = result.get("readyState") == "complete"
    good_url = GOOD_PATH in url
    has_ha = bool(result.get("hasHomeAssistantElement"))
    title_ok = "Home Assistant" in (result.get("title") or tab.get("title") or "")
    launch_screen = bool(result.get("hasLaunchScreen"))
    result.update({"ok": bool(good_url and ready and (has_ha or title_ok) and not launch_screen), "goodUrl": good_url, "titleOk": title_ok})
    return result


def reload_tab():
    tab = find_tab()
    if not tab:
        return False
    c = Client(tab)
    try:
        c.call("Page.reload", {"ignoreCache": True}, timeout=5)
        return True
    finally:
        c.close()


def navigate_tab(url=DASHBOARD_URL):
    tab = find_tab()
    if not tab:
        return False
    c = Client(tab)
    try:
        c.call("Page.navigate", {"url": url}, timeout=5)
        return True
    finally:
        c.close()


def screenshot(path):
    tab = find_tab()
    if not tab:
        raise CDPError("no page tabs")
    c = Client(tab)
    try:
        r = c.call("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False}, timeout=10)
        data = base64.b64decode(r.get("data", ""))
        with open(path, "wb") as f:
            f.write(data)
        return {"path": path, "bytes": len(data)}
    finally:
        c.close()


def recover():
    first = page_status()
    if first.get("ok"):
        return {"ok": True, "action": "already_ok", "status": first}
    reload_tab()
    time.sleep(4)
    second = page_status()
    if second.get("ok"):
        return {"ok": True, "action": "reload", "before": first, "status": second}
    navigate_tab(DASHBOARD_URL)
    time.sleep(5)
    third = page_status()
    if third.get("ok"):
        return {"ok": True, "action": "navigate", "before": first, "afterReload": second, "status": third}
    return {"ok": False, "action": "restart_required", "before": first, "afterReload": second, "afterNavigate": third}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["status", "recover", "eval", "screenshot", "reload", "navigate"])
    ap.add_argument("arg", nargs="?")
    args = ap.parse_args()
    if args.command == "status":
        print(json.dumps(page_status(), indent=2, sort_keys=True))
    elif args.command == "recover":
        print(json.dumps(recover(), indent=2, sort_keys=True))
    elif args.command == "eval":
        if not args.arg:
            raise SystemExit("eval needs expression")
        print(json.dumps(evaluate(args.arg), indent=2, sort_keys=True))
    elif args.command == "screenshot":
        print(json.dumps(screenshot(args.arg or "/tmp/c720p-dashboard-cdp.png"), indent=2, sort_keys=True))
    elif args.command == "reload":
        print(json.dumps({"ok": reload_tab()}))
    elif args.command == "navigate":
        print(json.dumps({"ok": navigate_tab(args.arg or DASHBOARD_URL)}))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}, indent=2, sort_keys=True))
        sys.exit(1)
