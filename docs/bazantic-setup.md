# Registering the Float gateway on Bazantic

## Status: registered and live

| | |
|---|---|
| Bazantic listing | **Float Sweep-Decision Gateway** |
| Public gateway URL | `https://4t6zxrx7r5czjbddgaiqvxigym.bazgateway.com` |
| MCP endpoint | `https://4t6zxrx7r5czjbddgaiqvxigym.bazgateway.com/mcp` |
| Upstream (this session) | the `cloudflared` tunnel below — ephemeral, swap for a real deployment |
| Auth | No auth (Bazantic → upstream) |
| Pricing | `checkSweep` (`POST /v1/check`) $0.01/call · `getPolicy` (`GET /v1/policy/:ensName`) free |

Verified directly against the live MCP endpoint: `initialize` responds with
`serverInfo.name: "Float Sweep-Decision Gateway"`, and `tools/list` correctly
exposes three tools — `checkSweep`, `getPolicy`, and an auto-generated `info`
— with our exact `openapi.ts` descriptions and schemas carried through.

Add it to an MCP client:
```sh
claude mcp add --transport http float-sweep-decision-gateway \
  https://4t6zxrx7r5czjbddgaiqvxigym.bazgateway.com/mcp
```

## The Recipe

`docs/recipe.bazantic.json` is a real Bazantic Recipe definition (their actual
schema — `name`/`description`/`input_schema`/`prompt_template`/
`tool_bindings`, confirmed against `bazantic.com/docs/recipes`), chaining
`checkSweep` + `getPolicy` into one agent-callable tool.

Fill in `<YOUR_GATEWAY_SLUG>` (both occurrences) — from the dashboard's
gateway **Overview** tab, or:
```sh
baz gateway list --json
```
Then:
```sh
baz recipe create docs/recipe.bazantic.json   # creates as a draft
baz recipe publish <handle-it-prints>          # locks it, exposes as one MCP tool
```

Or skip the file entirely and use the dashboard's **Recipes → New Recipe**
natural-language composer — paste:

> Given a business's ENS name (like rosa-design.float.eth), call Float's
> checkSweep tool to determine whether the business should sweep idle USDC
> into or out of its tokenized-Treasury position and how much. If not
> allowed (e.g. not KYC-verified), call getPolicy to explain why. Report the
> decision, direction, recommended amount, and reason in plain language.

It should bind to `checkSweep` and `getPolicy` automatically since they're
already registered.

## Remaining, optional

Publish the gateway to the Bazantic Marketplace (currently unpublished —
only callable by this account until then), claim a custom handle, and
publish the Recipe above.


Researched Bazantic's actual registration flow (`bazantic.com/docs/deploy-a-gateway`,
`/docs/cli`, `/docs/gateway-manifest`) and built what it needs. Two things
were missing from `apps/gateway` before this: a public URL (it only ever ran
on `localhost`) and an OpenAPI document (`GET /openapi.json`, added — see
`apps/gateway/src/openapi.ts`) for Bazantic's import step.

## What's ready

- **`GET /openapi.json`** — describes `POST /v1/check` and `GET
  /v1/policy/:ensName`. `servers[0].url` is derived from whatever host hits
  it, so it's correct behind any tunnel or real domain with nothing to keep
  in sync.
- **`X402_MODE=permissive`** (`.env`) — Bazantic fronts payment collection on
  its own layer (its dashboard's "x402/MPP" auth option) and calls our
  upstream freely; the gateway still logs every call to `gateway_calls`
  (`paid: false`, since Bazantic — not our own x402 challenge — collected
  payment). If you ever run the gateway standalone (no Bazantic in front),
  switch back to `X402_MODE=enforce` so it collects payment itself.
- **A public tunnel** — `cloudflared tunnel --url http://localhost:8402`.
  Quick Tunnels are ephemeral (no Cloudflare account, URL changes every
  restart) — perfect for registering and testing today, **not** a permanent
  listing. Before a real launch, point `upstream.url` at a real deployment
  instead (Railway/Render/Fly.io/your own domain) and re-run `baz gateway
  add` (or edit the listing) with that URL.

## Register it — two ways

### CLI (fastest, exact)

```sh
npm i -g @bazantic/cli
baz login          # opens a browser approval URL — your account, not mine
baz gateway add \
  --endpoint  <PUBLIC_GATEWAY_URL> \
  --spec-url  <PUBLIC_GATEWAY_URL>/openapi.json \
  --name      "Float Sweep Decisions" \
  --auth-type none \
  --status    draft
```

`--auth-type none`: Bazantic's own x402/MPP payment layer is separate from
this "auth" field, which just describes how *Bazantic* authenticates to your
upstream — the gateway has no API key to give it. `--status draft` first so
you can review pricing before it's publicly listed; flip to `active` (or use
the dashboard's **Save & Deploy**) once it looks right.

### Dashboard

1. `bazantic.com` → **Become a provider** → **Deploy a gateway**.
2. Base URL: `<PUBLIC_GATEWAY_URL>`
3. Authentication method: **x402/MPP**
4. Product website: this repo — `https://github.com/Rohitamalraj/Float`
5. Documentation URL: `https://github.com/Rohitamalraj/Float/blob/main/apps/gateway/README.md`
6. API Specification: `<PUBLIC_GATEWAY_URL>/openapi.json`
7. Review the two discovered methods, set pricing (`POST /v1/check` ≈
   `X402_PRICE_USDC` from `.env`, default $0.01; `GET /v1/policy/:ensName`
   free), **Save & Deploy**.
8. Use **Test in Playground** (Sandbox mode = Base Sepolia + Circle faucet
   USDC) to confirm the full payment flow before going live.

## Then: publish the Recipe

`docs/recipe.bazantic.json` chains ENS resolution → `/v1/check` → the
permissioned swap. Its `url` field is a placeholder
(`https://<your-gateway-domain>/v1/check`) — replace it with your gateway's
real URL (from `baz gateway list --json` or the dashboard **Overview** tab),
then follow `bazantic.com/docs/recipes` to publish it as one callable tool.

## Keeping the tunnel alive for this session

```sh
cloudflared tunnel --url http://localhost:8402
```

Prints a fresh `https://<random>.trycloudflare.com` URL each run — that's
your `<PUBLIC_GATEWAY_URL>` above until you deploy somewhere permanent.
