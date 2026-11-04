# Leash

**A leash for AI agents' money, enforced onchain on NEAR.**

Built for NEAR HACKATHON, track: **AI Security & Defense**.

## The problem

AI agents are starting to hold wallets and pay for things. Today that means handing an agent a key with full control and hoping the prompt holds. One prompt injection, one bad tool call, one hallucinated address, and the funds are gone.

## What Leash does

Leash is a vault contract on NEAR. The human owner funds it and registers an agent account with a **policy**. The agent can only move money by asking the contract, and the contract enforces the rules, not the agent's good behavior:

- per-transaction limit and daily limit
- recipient allowlist
- risk score check on the recipient (blocked above a set threshold)
- owner approval required above a threshold
- emergency pause
- every attempt, including blocked ones, is written to an onchain activity log

Blocked payments don't revert. They return `Denied { reason }` and are logged, so the audit trail shows what the agent tried, not only what succeeded.

## NEAR features used

- Smart contract written in Rust (`near-sdk`) with unit tests
- Separate agent account with its own key, with owner and agent roles enforced by the contract
- Risk oracle account: a distinct account that is the only one allowed to publish risk scores
- Testnet RPC `call_function` views for the live dashboard

Planned, not built yet: restricted function-call access keys for the agent, and NEAR Intents for cross-chain payouts.

## Repo layout

```
contract/   Rust policy contract + 9 unit tests
agent/      TypeScript demo agent (tries good and bad payments)
web/        Next.js dashboard + /api/risk scorer (rule-based v0)
```

## Run the tests (no NEAR account needed)

```bash
cd contract && cargo test
```

Expected: `9 passed`.

## Try it on testnet: "do X, see Y"

Prereqs: Rust, `cargo-near`, NEAR CLI, Node 20+, a testnet account.

1. **Build and deploy the contract.**
   `cd contract && cargo near build` then deploy to `leash-demo.<you>.testnet` and call `new` with your account as `owner` and a second account as `risk_oracle`.
   *See:* `get_owner` returns your account.

2. **Fund the vault.** The contract account's own balance is the vault. Testnet faucet accounts start with 10 NEAR, which is enough for the demo. Optionally call `deposit` with more attached.
   *See:* the contract account balance (`near tokens <contract> view-near-balance`).

3. **Register the agent with a policy.** Call `set_policy` for `agent.<you>.testnet`: per-tx 5 NEAR, daily 8 NEAR, approval threshold 2 NEAR, `allowlist_only: true`, `max_risk: 50`. Then `set_allowed` for the vendor account.
   *See:* `get_policy` returns the policy.

4. **Run the demo agent.** Copy `.env.example`, fill it in, then `cd agent && npm install && npm run demo`.
   *See, in order:*
   - Pay vendor 1 NEAR: `Paid`
   - Pay vendor 6 NEAR: `Denied` (exceeds per-transaction limit)
   - Pay unlisted scam wallet: `Denied` (recipient not on allowlist)
   - Pay vendor 3 NEAR: `PendingApproval`

5. **Approve the pending payment as the owner.** Call `approve` with the id from step 4.
   *See:* the vendor receives 3 NEAR and the pending list is empty.

6. **Open the dashboard.** Put `NEXT_PUBLIC_LEASH_CONTRACT=<contract>` in `web/.env.local`, then `cd web && npm install && npm run dev`, open http://localhost:3000.
   *See:* the agent's rules, today's spend, pending approvals, and every attempt color-coded green (paid), amber (needs approval) and red (blocked), updating every 4 seconds.

6a. **Try the agent from the page.** In *Try the agent*, click the four scenario buttons (or send a custom payment).
   *See:* an immediate result for each (Paid, Blocked with the reason, or Waiting for approval), and the activity list updating. The agent's key lives server-side in `web/.env.local` (`AGENT_ACCOUNT`, `AGENT_PRIVATE_KEY`), never in the browser.

6b. **Use it as the owner.** Click *Connect wallet* and sign in as the owner account with Meteor Wallet (or HOT / Intear). Anyone else who connects gets a read-only view: only the owner account can approve, edit rules or pause.
   *See:* Approve/Reject buttons on pending payments, an *Edit the rules* form, and an *Emergency pause* button. Pausing makes the next agent payment return `Denied: agent is paused`.

7. **Test the risk check.** As the risk oracle, call `set_risk` with score 90 for an allowlisted account, then have the agent pay it.
   *See:* `Denied` (recipient flagged as high risk), even though it was allowlisted.

## Status

Contract: complete for the MVP and tested. Agent and dashboard: written and typechecked; the end-to-end testnet run is the next step. The risk scorer is a transparent rule-based placeholder, not real threat intelligence.

## License

MIT
