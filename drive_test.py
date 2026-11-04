import asyncio, json, os
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = "/Users/rohanagarkar/Documents/Projects/palemoon-bridge"
params = StdioServerParameters(command="uv", args=["run", "--directory", ROOT, "palemoon-bridge"])

async def call(s, name, **args):
    r = await s.call_tool(name, args)
    txt = "\n".join(getattr(c, "text", "") for c in r.content)
    print(f"--- {name} {args}\n{txt[:1500]}\n", flush=True)
    return txt

async def main():
    async with stdio_client(params) as (r, w):
        async with ClientSession(r, w) as s:
            await s.initialize()
            await call(s, "list_tabs")
            await call(s, "navigate", url="https://httpbin.org/forms/post")
            els = await call(s, "get_interactive_elements")
            await call(s, "get_page_text", max_chars=500)

asyncio.run(main())
