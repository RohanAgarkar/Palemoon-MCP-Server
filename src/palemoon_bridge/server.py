"""MCP server + local HTTP relay for the Pale Moon add-on.

Agent <-(MCP stdio)-> this process <-(HTTP long-poll, localhost)-> add-on.
"""
import json
import os
import queue
import secrets
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from mcp.server.mcpserver import MCPServer

from pathlib import Path


def _load_env():
    """Load KEY=VALUE lines from .env in the cwd or project root (existing env wins)."""
    for d in (Path.cwd(), Path(__file__).resolve().parents[2]):
        f = d / ".env"
        if f.is_file():
            for line in f.read_text().splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip().strip("\"'"))
            return


_load_env()

HOST = "127.0.0.1"
PORT = int(os.environ.get("PALEMOON_BRIDGE_PORT", "18765"))
TOKEN = os.environ.get("PALEMOON_BRIDGE_TOKEN") or secrets.token_hex(16)
TIMEOUT = 30

_commands: "queue.Queue[dict]" = queue.Queue()
_pending: dict[str, dict] = {}


LOG = os.environ.get("PALEMOON_BRIDGE_LOG", "/tmp/palemoon-bridge.log")


def _log(line: str):
    import time
    with open(LOG, "a") as f:
        f.write(f"{time.strftime('%H:%M:%S')} {line}\n")


def send_command(action: str, **params) -> dict:
    """Queue a command for the add-on and wait for its result."""
    cid = uuid.uuid4().hex
    slot = {"event": threading.Event(), "result": None}
    _pending[cid] = slot
    _commands.put({"id": cid, "action": action, "params": params})
    try:
        if not slot["event"].wait(TIMEOUT):
            raise TimeoutError("Pale Moon add-on did not respond (is it installed and the token set?)")
        res = slot["result"]
        _log(f"{action} {params} -> {json.dumps(res)[:2000]}")
        if res.get("error"):
            raise RuntimeError(res["error"])
        return res.get("data")
    finally:
        _pending.pop(cid, None)


class Relay(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _auth(self) -> bool:
        ok = self.headers.get("X-Bridge-Token") == TOKEN
        if not ok:
            self.send_response(401)
            self.end_headers()
        return ok

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if urlparse(self.path).path != "/poll" or not self._auth():
            return
        try:
            self._json(200, _commands.get(timeout=20))
        except queue.Empty:
            self._json(200, {})

    def do_POST(self):
        if urlparse(self.path).path != "/result" or not self._auth():
            return
        n = int(self.headers.get("Content-Length", 0))
        msg = json.loads(self.rfile.read(n) or b"{}")
        slot = _pending.get(msg.get("id"))
        if slot:
            slot["result"] = msg
            slot["event"].set()
        self._json(200, {"ok": True})


mcp = MCPServer("palemoon-bridge")


@mcp.tool()
def list_tabs() -> list:
    """List open Pale Moon tabs (index, title, url, selected)."""
    return send_command("list_tabs")


@mcp.tool()
def navigate(url: str, tab: int | None = None) -> dict:
    """Load a URL in a tab (default: the selected tab) and wait for it to finish loading."""
    return send_command("navigate", url=url, tab=tab)


@mcp.tool()
def new_tab(url: str = "about:blank") -> dict:
    """Open a new tab."""
    return send_command("new_tab", url=url)


@mcp.tool()
def close_tab(tab: int) -> dict:
    """Close the tab at the given index."""
    return send_command("close_tab", tab=tab)


@mcp.tool()
def get_page_text(tab: int | None = None, max_chars: int = 20000) -> dict:
    """Return the visible text of the page."""
    return send_command("get_text", tab=tab, max_chars=max_chars)


@mcp.tool()
def get_interactive_elements(tab: int | None = None) -> list:
    """List links, buttons and inputs with a CSS selector you can pass to click/type_text."""
    return send_command("get_elements", tab=tab)


@mcp.tool()
def click(selector: str, tab: int | None = None) -> dict:
    """Click the first element matching a CSS selector."""
    return send_command("click", selector=selector, tab=tab)


@mcp.tool()
def type_text(selector: str, text: str, submit: bool = False, tab: int | None = None) -> dict:
    """Type text into an input matching a CSS selector; optionally submit its form."""
    return send_command("type", selector=selector, text=text, submit=submit, tab=tab)


def main():
    srv = ThreadingHTTPServer((HOST, PORT), Relay)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    import sys
    print(f"palemoon-bridge relay on http://{HOST}:{PORT}  token={TOKEN}", file=sys.stderr)
    mcp.run()  # stdio


if __name__ == "__main__":
    main()
