# palemoon-bridge

Lets an AI agent use Pale Moon as a tool. Pale Moon has no WebExtensions, so the relay is a legacy (bootstrapped) add-on.

    agent --MCP/stdio--> palemoon-bridge (Python) <--HTTP poll, localhost--> add-on --> tabs

## Setup
1. Install the add-on: in Pale Moon, open `about:addons`, remove any old "Pale Moon Bridge", then drag `palemoon-bridge.xpi` into the window and restart Pale Moon.
   Rebuild the package with: `cd extension && zip -X9 ../palemoon-bridge.xpi install.rdf bootstrap.js`
2. Create `.env` from `.env.example`:
   - `PALEMOON_BRIDGE_TOKEN`, `PALEMOON_BRIDGE_PORT`
   - `ESIC_USERNAME`, `ESIC_PASSWORD` (used only by `fill_login`)
3. In Pale Moon `about:config`, add the string preference `extensions.palemoonbridge.token` with the same value as `PALEMOON_BRIDGE_TOKEN`.
4. Register with pi: `pi mcp add palemoon -- uv run --directory <this dir> palemoon-bridge`, then `/reload`.

## Tools
| Tool | Purpose |
|---|---|
| `list_tabs`, `new_tab`, `close_tab` | Tab management |
| `navigate` | Load a URL and wait until loading finishes |
| `get_page_text`, `get_interactive_elements` | Read the page and find CSS selectors |
| `click`, `type_text` | Interact with elements (never submits unless asked) |
| `upload_file` | Attach a local file to a file input (does not click submit) |
| `detect_captcha` | Report whether a captcha is on the page |
| `wait_for_captcha_clear` | Wait for a human to solve a captcha (never solves it) |
| `fill_login` | Fill a login profile's username/password from `.env` (never submits, never touches captcha) |

Secrets are never logged: `fill_login` values are redacted in `/tmp/palemoon-bridge.log`.

## Policy
The bridge does not solve or bypass CAPTCHAs, and it does not submit forms unless the caller explicitly clicks a submit control.
