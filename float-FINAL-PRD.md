# Float — Product Requirements Document
### ENS-named, non-custodial treasury wallet for agent-paid businesses
### ETHOnline 2026 · Bazantic + Uniswap + ENS · Fresh track (not Continuity)

---

## 1. One-liner

Float is a business wallet that turns idle crypto into real yield automatically — verify once, and the wallet itself never lets your money sit still again.

**Alt names considered:** Sweep, Cache. Going with Float.

---

## 2. Problem

Four things are true at once, and nobody has connected them into one product:

1. Real, safe yield exists onchain today at institutional scale — tokenized Treasuries pay ~4.5–5%, and the market is roughly $30B and growing toward an estimated $11 trillion by 2030 (Uniswap Labs' own figure).
2. Almost none of it reaches anyone else. One industry report tracking ~$60B in tokenized products found only ~3% ($1.7B) accessible to US retail investors.
3. Businesses increasingly paid via stablecoins/agentic commerce (x402 alone: 165M+ transactions, 69K active agents by April 2026) often have an *agent*, not a human, managing the balance day to day — and an autonomous agent has no legal personhood, so it cannot pass KYC on its own.
4. Under the GENIUS Act, payment stablecoins (like USDC) are legally barred from paying yield directly. A separate sweep-into-yield mechanism isn't a nice-to-have design choice — it's close to the only compliant path left.

**Who this is actually for:** not the median small business — JPMorgan Chase Institute data shows the median SMB holds only ~27 days of cash buffer (~$1,200 median balance), too thin to matter. The real target is businesses with lumpier, healthier cash flow: agencies, e-commerce sellers, consultancies paid in batches via stablecoins, who sit on meaningful idle balances between payment-in and payment-out.

---

## 3. Solution

Float is the business's wallet, not a service layered on top of one.

A business completes KYC once with a Float-integrated issuer and gets a **non-custodial smart wallet named after itself** — `mybiz.eth` — which it fully owns and can recover independently of Float. Every payment the business receives, including agent-to-agent commerce payments, lands directly in that wallet.

A second, narrowly-scoped signer — **the agent** — holds delegated, revocable permission to do exactly one thing within limits the business sets: sweep balance above a working-capital buffer into a real, yield-bearing tokenized Treasury position, and sweep it back the moment a bill is due. It cannot move funds anywhere else, cannot raise its own limits, and can be cut off at any time.

**Non-custodial, on purpose.** Float never holds business funds or controls the wallet's root keys — that would make Float a money transmitter, a licensing burden far beyond what this product should carry. This is the same pattern behind account-abstraction smart wallets already common in Ethereum (Safe, ERC-4337 session keys): the business owns the account, the agent gets a scoped, revocable session key.

### Walkthrough (plain terms)

1. Business signs up, completes KYC once — like opening a bank account.
2. Gets a wallet named after the business: `rosa-design.eth`.
3. Sets one number: the working-capital buffer (e.g. "$2,000 always available").
4. A client pays $8,000 → lands directly in the wallet.
5. Float sees $6,000 sitting idle above the buffer → automatically sweeps it into tokenized Treasuries.
6. Rent ($3,000) comes due two weeks later → Float automatically sweeps that amount back out in time to clear.
7. The yield earned the whole time it was parked is split — most to the business, a sliver to Float.

No dashboard to babysit. Two human decisions, ever: sign up, set the buffer.

---

## 4. Autonomy & permission model

This split is the actual security thesis, not a limitation to remove later.

| Action | Autonomous? | Who |
|---|---|---|
| KYC (one-time) | No | Business owner, once |
| Wallet + ENS setup | No | Business owner, once |
| Setting the policy (buffer, allowed protocols, spend cap) | **Never autonomous, by design** | Business owner only |
| Watching cash flow day to day | Yes | Agent |
| Deciding when to sweep in/out | Yes, within policy | Agent |
| Executing the swap through the Permissioned Pool | Yes | Agent |
| Anything outside policy (bigger amount, different protocol, unlimited approval) | No — auto-blocked | Kicked back to human |
| KYC/allowlist status itself | No, ever | Issuer's compliance oracle only |

Rationale: in the Grok/Bankr incident (May 2026), an attacker escalated an AI trading agent's wallet permission via a gifted NFT, then hid a transfer instruction in Morse code that the agent decoded and executed — $150–175K moved, without the private key ever being stolen. The agent's judgment was the attack surface. Float's agent hits a hard wall the moment it tries anything outside its pre-set policy, because it was never capable of authorizing itself in the first place — a fully compromised agent still can't raise its own limits.

---

## 5. How the sponsor stacks are used (load-bearing, not decorative)

**Uniswap — the settlement and compliance venue.**
Float integrates with an existing Uniswap v4 **Permissioned Pool** (shipped July 23, 2026, built with Securitize, Superstate, and Dowgo) — a hook standard letting a regulated tokenized asset trade on an AMM with the compliance allowlist enforced at the protocol level. Float doesn't issue its own RWA token; it plugs into an existing issuer's pool. Every sweep in/out is a real swap through that pool, and the pool's own hook decides whether the transaction is even allowed to happen.

**ENS v2 — the wallet's actual name and address.**
`mybiz.eth` isn't a label pointing at the wallet — via ENSv2's registry, it resolves directly to the smart account, so it's the address people and agents actually pay. The KYC/allowlist status the pool checks lives in a text record on that same name, writable only by the issuer's compliance oracle (**Enhanced Access Control**). This is what lets the business receive payments, prove compliance, and delegate signing rights to its agent, all through one persistent identity — even if the underlying smart account is ever migrated.

**Bazantic / x402 — how the decision logic becomes its own business.**
Float's "is this business allowlisted, should it sweep right now" check is exposed as a metered x402 endpoint via Bazantic. Any other agent-commerce builder can pay per-call to use Float's logic instead of building their own treasury automation — a second, independent revenue line, not just a track checkbox.

---

## 6. Business model

**Line 1 — yield spread (primary).** If the underlying tokenized Treasury pays 4.5%, Float passes through ~4.0% to the business and keeps ~0.5%. Comparable in kind to a robo-advisor management fee (Wealthfront: ~0.25% AUM) — the business never sees an invoice, just a slightly lower rate than the sticker yield.

**Line 2 — metered API revenue (secondary).** Other agent-commerce builders pay per-call via x402/Bazantic to use Float's allowlist-check and sweep-decision logic. Revenue from businesses that never become direct Float customers.

---

## 7. Competitive landscape

| Product | Who can access it | Automated to cash flow? | Built for agent-managed businesses? | Built on Permissioned Pools? |
|---|---|---|---|---|
| BlackRock BUIDL | Institutions only, SEC-registered qualified purchasers | No | No | No |
| Franklin Templeton BENJI | Registered fund, KYC only, $20 minimum | No | No | No |
| Ondo (OUSG / USDY) | DeFi-composable, USDY marketed to non-US investors | No | No | No |
| Circle Yield / Coinbase Prime | Institutional relationships, large minimums | No | No | No |
| MetaMask Money Account | Retail, self-custodial (closest consumer analog) | No — general personal finance | No — assumes a human clicking | No |
| **Float** | SMBs/freelancers, one-time KYC | **Yes** | **Yes** | **Yes** |

The gap every competitor shares: they're yield products a human manages. None are cash infrastructure that manages itself, and none assume the payer might be an agent rather than a person.

---

## 8. Track & prize mapping

| Sponsor | Prize | Fit | Status |
|---|---|---|---|
| Uniswap | Best Uniswap Stack Contribution ($3K pool) | Real integration with a 6-week-old v4 primitive (Permissioned Pools), not a cosmetic API call | ✅ Target |
| ENS | Best Use of ENSv2 (~$4.5K pool) | Enhanced Access Control carries the actual compliance attestation and is the wallet's real address | ✅ Target — strongest fit |
| Bazantic | Agentify a new API ($1K) | Sweep-recommendation engine wrapped as a new Bazantic service | ✅ Target |
| Bazantic | Best Recipe using sponsor APIs ($1K) | Chains ENS allowlist check + Uniswap pool swap into one flow | ✅ Target |
| ~~Bazantic~~ | ~~Help an agent use your project~~ | Continuity Track only — not eligible, this is a fresh build | ❌ Out of scope |

Four realistic prize tracks from one coherent integration, not four separate builds.

---

## 9. MVP scope

**Keep:**
- ENS subname + Enhanced Access Control fields (`spend-cap`, `allowed-protocols`, `allow-unlimited-approvals`, KYC/allowlist status)
- Non-custodial smart wallet (account-abstraction SDK — Safe, ZeroDev, or Alchemy Account Kit; don't build wallet primitives from scratch)
- Sweep logic: balance-above-buffer triggers swap in, upcoming-payment triggers swap out
- Integration with one real Uniswap v4 Permissioned Pool (or a minimal mock built on the real hook standard if no issuer is reachable on testnet in time — document this clearly if mocked)
- One Bazantic x402 endpoint + one Recipe
- Live demo: incoming payment lifts balance above buffer → auto-swept → simulated bill comes due → auto-swapped back, all visible onchain; plus a scripted "agent tries to act outside policy" attempt that gets blocked

**Cut if short on time:**
- Real issuer KYC integration → mock the compliance oracle write, be upfront about it in the README
- Multi-business/multi-agent support → one demo business is enough
- UI polish → a CLI or single demo page; judges are watching the block and the ENS record, not the frontend

---

## 10. Build timeline (today: Sep 8, hackathon runs to Sep 16 — 8 days left)

| Days | Focus |
|---|---|
| 1 (today) | Confirm testnet alignment across ENS v2 (Sepolia), Uniswap Permissioned Pools, Bazantic; pick an account-abstraction SDK; scaffold ENS subname + Enhanced Access Control roles |
| 2–3 | Non-custodial smart wallet + agent session-key delegation; sweep logic reading policy fields |
| 4 | Bazantic gateway + Recipe authoring |
| 5 | Wire the Uniswap Permissioned Pool swap leg into the sweep logic |
| 6 | End-to-end run: payment in → sweep → bill due → sweep out; scripted policy-violation block |
| 7 | Full dry run, fix rough edges, record demo video |
| 8 (buffer, due Sep 16) | FEEDBACK.md, Uniswap Developer Feedback Form, Bazantic username, README pointing to relevant contract lines, final submission |

---

## 11. Submission checklist

- [ ] Bazantic account + username in submission
- [ ] x402/MPP Gateway deployed for the sweep-check endpoint
- [ ] Recipe authored + before/after value demonstrated
- [ ] Public GitHub repo, open source
- [ ] `FEEDBACK.md` + Uniswap Developer Feedback Form linked in submission
- [ ] README points directly to the Permissioned Pool integration contract lines
- [ ] ENSv2 build functional on Sepolia, live demo (not hardcoded values)
- [ ] Clearly document which parts (KYC oracle, specific issuer) are mocked for the demo vs. real integrations

---

## 12. Known risks and open questions (say these out loud before a judge does)

- **Issuer partnership dependency.** Float doesn't control the KYC/allowlist process — it depends on a real Permissioned Pool issuer (Superstate, Securitize, Dowgo, or similar) being reachable on testnet within the hackathon window. If not, mock this step and say so clearly.
- **Accreditation is a separate gate from KYC, and it isn't automatically easier for a business.** Private-fund tokenized Treasury products require accredited-investor status — $1M net worth for an individual, or $5M in total assets for a business entity (or every owner individually accredited). Many target businesses may not clear either bar. Registered fund products (Franklin Templeton's BENJI model: KYC only, $20 minimum) are the safer issuer category to pursue.
- **Possible investment adviser registration exposure (not legal advice — needs real counsel).** Deciding when and how much to allocate a client's funds into a yield-bearing security, for compensation, resembles the activity the Investment Advisers Act of 1940 regulates — the same reason Wealthfront and Betterment are registered advisers, not just software companies. The non-custodial wallet design doesn't resolve this; it's a separate question about the advisory decision itself.
- **Smart contract and custody risk.** Any automated swap mechanism carries standard DeFi risk — not FDIC-insured, and that has to be stated plainly to any real business, not glossed over. The session-key/policy contract is unaudited; a bug there would defeat the safety thesis.
- **Wallet build dependency.** Real added scope versus a pure automation overlay — confirm the fastest account-abstraction SDK to wire up early, don't discover this mid-build.
- **Migration friction.** Asking a business to move its primary receiving address to a brand-new wallet is a bigger real-world adoption ask than connecting an existing one — worth acknowledging as a trade-off made deliberately for a simpler, more coherent product story.
- **Weak technical moat.** None of the individual pieces (ENS resolution, a Uniswap swap, sweep logic) are hard to replicate once proven — a well-funded incumbent (MetaMask, a business-banking app) could ship something similar. The realistic moat is issuer relationships and business trust, not unique technology — worth being upfront about rather than overclaiming defensibility.
- **Trust headwind.** 2026's headline agent-wallet failures (Grok/Bankr, LLM router drains) are the exact reason this product's design is defensive by default — but that has to be said explicitly, not assumed obvious, since the same headlines could just as easily make a skeptical business owner or judge wary of any agent touching a wallet at all.
