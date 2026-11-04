# palemoon-bridge

Lets an AI agent use Pale Moon as a tool. Pale Moon has no WebExtensions, so the relay is a legacy (bootstrapped) add-on.

    agent --MCP/stdio--> palemoon-bridge (Python) <--HTTP poll, localhost-- add-on --> tabs

## Setup
1. Install the add-on: open `palemoon-bridge.xpi` in Pale Moon (rebuild: `cd extension && zip -r ../palemoon-bridge.xpi install.rdf bootstrap.js`).
2. Choose a token and run the server: `PALEMOON_BRIDGE_TOKEN=secret uv run palemoon-bridge`
3. In Pale Moon `about:config`, create string pref `extensions.palemoonbridge.token` = `secret`
   (optional `extensions.palemoonbridge.url`, default `http://127.0.0.1:18765`).
4. Register the command with your MCP client: `uv run --directory <this dir> palemoon-bridge`.

Tools: list_tabs, navigate, new_tab, close_tab, get_page_text, get_interactive_elements, click, type_text.
