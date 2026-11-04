//! Leash: a vault that lets an AI agent spend NEAR only within human-set rules.
//!
//! Flow: the owner deposits funds, registers an agent account with a `Policy`,
//! and (optionally) an allowlist of recipients. The agent calls
//! `request_payment`. The contract never panics on a policy violation; it
//! records a `Denied` outcome in the activity log instead, so every blocked
//! attempt is visible onchain (a panic would roll the log entry back).

use near_sdk::json_types::U128;
use near_sdk::store::{IterableMap, LookupMap, Vector};
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault, Promise};

const DAY_NS: u64 = 86_400_000_000_000;

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Policy {
    /// Max amount (yoctoNEAR) for a single payment.
    pub per_tx_limit: U128,
    /// Max total (yoctoNEAR) the agent may spend per UTC day.
    pub daily_limit: U128,
    /// Payments above this need owner approval. Must be <= per_tx_limit to matter.
    pub approval_threshold: U128,
    /// If true, only allowlisted recipients can be paid.
    pub allowlist_only: bool,
    /// Recipients with a risk score above this are blocked (0-100).
    pub max_risk: u8,
    /// Emergency stop.
    pub paused: bool,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub enum Outcome {
    Paid,
    PendingApproval { id: u64 },
    Denied { reason: String },
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Activity {
    pub agent: AccountId,
    pub to: AccountId,
    pub amount: U128,
    pub memo: String,
    pub outcome: Outcome,
    pub timestamp_ns: u64,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug)]
pub struct Pending {
    pub id: u64,
    pub agent: AccountId,
    pub to: AccountId,
    pub amount: U128,
    pub memo: String,
}

#[near(serializers = [borsh])]
#[derive(Clone, Default)]
struct DayUsage {
    day: u64,
    spent: u128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Leash {
    owner: AccountId,
    risk_oracle: AccountId,
    policies: IterableMap<AccountId, Policy>,
    allowed: LookupMap<(AccountId, AccountId), bool>,
    usage: LookupMap<AccountId, DayUsage>,
    risk: LookupMap<AccountId, u8>,
    pending: IterableMap<u64, Pending>,
    next_pending: u64,
    log: Vector<Activity>,
}

#[near]
impl Leash {
    #[init]
    pub fn new(owner: AccountId, risk_oracle: AccountId) -> Self {
        Self {
            owner,
            risk_oracle,
            policies: IterableMap::new(b"p"),
            allowed: LookupMap::new(b"a"),
            usage: LookupMap::new(b"u"),
            risk: LookupMap::new(b"r"),
            pending: IterableMap::new(b"q"),
            next_pending: 0,
            log: Vector::new(b"l"),
        }
    }

    // ---------- owner ----------

    /// Anyone can fund the vault.
    #[payable]
    pub fn deposit(&mut self) {}

    pub fn set_policy(&mut self, agent: AccountId, policy: Policy) {
        self.assert_owner();
        require!(
            policy.per_tx_limit.0 <= policy.daily_limit.0,
            "per_tx_limit must be <= daily_limit"
        );
        require!(policy.max_risk <= 100, "max_risk must be 0-100");
        self.policies.insert(agent, policy);
    }

    pub fn set_allowed(&mut self, agent: AccountId, to: AccountId, allowed: bool) {
        self.assert_owner();
        self.allowed.insert((agent, to), allowed);
    }

    pub fn set_paused(&mut self, agent: AccountId, paused: bool) {
        self.assert_owner();
        let mut p = self.policies.get(&agent).cloned().expect("unknown agent");
        p.paused = paused;
        self.policies.insert(agent, p);
    }

    pub fn approve(&mut self, id: u64) -> Promise {
        self.assert_owner();
        let p = self.pending.remove(&id).expect("no such pending payment");
        self.charge_daily(&p.agent, p.amount.0, true);
        self.record(&p.agent, &p.to, p.amount, &p.memo, Outcome::Paid);
        Promise::new(p.to).transfer(NearToken::from_yoctonear(p.amount.0))
    }

    pub fn reject(&mut self, id: u64) {
        self.assert_owner();
        let p = self.pending.remove(&id).expect("no such pending payment");
        self.record(
            &p.agent,
            &p.to,
            p.amount,
            &p.memo,
            Outcome::Denied { reason: "rejected by owner".to_string() },
        );
    }

    // ---------- risk oracle ----------

    /// Called by the risk oracle account (the off-chain risk service's key).
    pub fn set_risk(&mut self, account: AccountId, score: u8) {
        require!(
            env::predecessor_account_id() == self.risk_oracle,
            "only the risk oracle can set risk scores"
        );
        require!(score <= 100, "score must be 0-100");
        self.risk.insert(account, score);
    }

    // ---------- agent ----------

    /// The agent asks to pay `to`. Never panics on policy violations: returns
    /// `Denied { reason }` and logs it, so blocked attempts stay auditable.
    pub fn request_payment(&mut self, to: AccountId, amount: U128, memo: String) -> Outcome {
        let agent = env::predecessor_account_id();
        let outcome = self.evaluate(&agent, &to, amount.0);

        let outcome = match outcome {
            Outcome::Paid => {
                self.charge_daily(&agent, amount.0, true);
                Outcome::Paid
            }
            Outcome::PendingApproval { .. } => {
                let id = self.next_pending;
                self.next_pending += 1;
                self.pending.insert(
                    id,
                    Pending { id, agent: agent.clone(), to: to.clone(), amount, memo: memo.clone() },
                );
                Outcome::PendingApproval { id }
            }
            denied => denied,
        };

        self.record(&agent, &to, amount, &memo, outcome.clone());

        if outcome == Outcome::Paid {
            // Fire-and-forget transfer; balance was checked in `evaluate`.
            let _ = Promise::new(to).transfer(NearToken::from_yoctonear(amount.0));
        }
        outcome
    }

    // ---------- views ----------

    pub fn get_policy(&self, agent: AccountId) -> Option<Policy> {
        self.policies.get(&agent).cloned()
    }

    pub fn get_risk(&self, account: AccountId) -> u8 {
        self.risk.get(&account).copied().unwrap_or(0)
    }

    pub fn is_allowed(&self, agent: AccountId, to: AccountId) -> bool {
        self.allowed.get(&(agent, to)).copied().unwrap_or(false)
    }

    pub fn get_pending(&self) -> Vec<Pending> {
        self.pending.iter().map(|(_, p)| p.clone()).collect()
    }

    /// Newest first.
    pub fn get_activity(&self, limit: Option<u32>) -> Vec<Activity> {
        let limit = limit.unwrap_or(20).min(100) as u64;
        let len = self.log.len() as u64;
        let start = len.saturating_sub(limit);
        (start..len).rev().filter_map(|i| self.log.get(i as u32).cloned()).collect()
    }

    pub fn spent_today(&self, agent: AccountId) -> U128 {
        let today = env::block_timestamp() / DAY_NS;
        match self.usage.get(&agent) {
            Some(u) if u.day == today => U128(u.spent),
            _ => U128(0),
        }
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner.clone()
    }
}

impl Leash {
    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, "only the owner can call this");
    }

    /// Pure policy check. Order matters: cheapest/most absolute rules first.
    fn evaluate(&self, agent: &AccountId, to: &AccountId, amount: u128) -> Outcome {
        let deny = |r: &str| Outcome::Denied { reason: r.to_string() };

        let Some(policy) = self.policies.get(agent) else {
            return deny("agent not registered");
        };
        if policy.paused {
            return deny("agent is paused");
        }
        if amount == 0 {
            return deny("amount must be greater than zero");
        }
        if amount > policy.per_tx_limit.0 {
            return deny("exceeds per-transaction limit");
        }
        if self.spent_today(agent.clone()).0.saturating_add(amount) > policy.daily_limit.0 {
            return deny("exceeds daily limit");
        }
        let listed = self.is_allowed(agent.clone(), to.clone());
        if policy.allowlist_only && !listed {
            return deny("recipient not on allowlist");
        }
        if self.get_risk(to.clone()) > policy.max_risk {
            return deny("recipient flagged as high risk");
        }
        if env::account_balance().as_yoctonear() < amount {
            return deny("vault balance too low");
        }
        if amount > policy.approval_threshold.0 {
            return Outcome::PendingApproval { id: 0 }; // real id assigned by caller
        }
        Outcome::Paid
    }

    fn charge_daily(&mut self, agent: &AccountId, amount: u128, enforce: bool) {
        let today = env::block_timestamp() / DAY_NS;
        let mut u = self.usage.get(agent).cloned().unwrap_or_default();
        if u.day != today {
            u = DayUsage { day: today, spent: 0 };
        }
        u.spent = u.spent.saturating_add(amount);
        if enforce {
            let limit = self.policies.get(agent).map(|p| p.daily_limit.0).unwrap_or(0);
            require!(u.spent <= limit, "daily limit exceeded");
        }
        self.usage.insert(agent.clone(), u);
    }

    fn record(&mut self, agent: &AccountId, to: &AccountId, amount: U128, memo: &str, outcome: Outcome) {
        self.log.push(Activity {
            agent: agent.clone(),
            to: to.clone(),
            amount,
            memo: memo.to_string(),
            outcome,
            timestamp_ns: env::block_timestamp(),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    const NEAR: u128 = 1_000_000_000_000_000_000_000_000;

    fn owner() -> AccountId { accounts(0) }
    fn agent() -> AccountId { accounts(1) }
    fn vendor() -> AccountId { accounts(2) }
    fn scammer() -> AccountId { accounts(3) }
    fn oracle() -> AccountId { accounts(4) }

    fn ctx(pred: AccountId, ts: u64) {
        let mut b = VMContextBuilder::new();
        b.predecessor_account_id(pred)
            .block_timestamp(ts)
            .account_balance(NearToken::from_near(100));
        testing_env!(b.build());
    }

    fn setup() -> Leash {
        ctx(owner(), 0);
        let mut c = Leash::new(owner(), oracle());
        c.set_policy(
            agent(),
            Policy {
                per_tx_limit: U128(5 * NEAR),
                daily_limit: U128(8 * NEAR),
                approval_threshold: U128(2 * NEAR),
                allowlist_only: true,
                max_risk: 50,
                paused: false,
            },
        );
        c.set_allowed(agent(), vendor(), true);
        c
    }

    fn pay(c: &mut Leash, to: AccountId, near: u128, ts: u64) -> Outcome {
        ctx(agent(), ts);
        c.request_payment(to, U128(near * NEAR / 10), "test".into())
    }

    #[test]
    fn small_payment_to_allowlisted_vendor_is_paid() {
        let mut c = setup();
        assert_eq!(pay(&mut c, vendor(), 10, 1), Outcome::Paid); // 1 NEAR
        assert_eq!(c.spent_today(agent()).0, NEAR);
    }

    #[test]
    fn over_per_tx_limit_is_denied() {
        let mut c = setup();
        let o = pay(&mut c, vendor(), 60, 1); // 6 NEAR > 5
        assert!(matches!(o, Outcome::Denied { reason } if reason.contains("per-transaction")));
    }

    #[test]
    fn unlisted_recipient_is_denied() {
        let mut c = setup();
        let o = pay(&mut c, scammer(), 10, 1);
        assert!(matches!(o, Outcome::Denied { reason } if reason.contains("allowlist")));
    }

    #[test]
    fn high_risk_recipient_is_denied_even_if_allowlisted() {
        let mut c = setup();
        ctx(owner(), 0);
        c.set_allowed(agent(), scammer(), true);
        ctx(oracle(), 0);
        c.set_risk(scammer(), 90);
        let o = pay(&mut c, scammer(), 10, 1);
        assert!(matches!(o, Outcome::Denied { reason } if reason.contains("high risk")));
    }

    #[test]
    fn daily_limit_caps_total_spend_then_resets_next_day() {
        let mut c = setup();
        assert_eq!(pay(&mut c, vendor(), 20, 1), Outcome::Paid); // 2
        assert_eq!(pay(&mut c, vendor(), 20, 2), Outcome::Paid); // 4
        assert_eq!(pay(&mut c, vendor(), 20, 3), Outcome::Paid); // 6
        assert_eq!(pay(&mut c, vendor(), 20, 4), Outcome::Paid); // 8
        let o = pay(&mut c, vendor(), 10, 5);
        assert!(matches!(o, Outcome::Denied { reason } if reason.contains("daily")));
        assert_eq!(pay(&mut c, vendor(), 10, DAY_NS + 1), Outcome::Paid); // new day
    }

    #[test]
    fn above_threshold_needs_owner_approval() {
        let mut c = setup();
        let o = pay(&mut c, vendor(), 30, 1); // 3 NEAR > 2 threshold
        assert_eq!(o, Outcome::PendingApproval { id: 0 });
        assert_eq!(c.get_pending().len(), 1);
        assert_eq!(c.spent_today(agent()).0, 0);
        ctx(owner(), 2);
        let _ = c.approve(0);
        assert_eq!(c.get_pending().len(), 0);
        assert_eq!(c.spent_today(agent()).0, 3 * NEAR);
    }

    #[test]
    fn paused_agent_is_denied() {
        let mut c = setup();
        ctx(owner(), 0);
        c.set_paused(agent(), true);
        let o = pay(&mut c, vendor(), 10, 1);
        assert!(matches!(o, Outcome::Denied { reason } if reason.contains("paused")));
    }

    #[test]
    fn denied_attempts_are_logged() {
        let mut c = setup();
        let _ = pay(&mut c, scammer(), 10, 1);
        let log = c.get_activity(Some(10));
        assert_eq!(log.len(), 1);
        assert!(matches!(log[0].outcome, Outcome::Denied { .. }));
    }

    #[test]
    #[should_panic(expected = "only the owner")]
    fn agent_cannot_change_its_own_policy() {
        let mut c = setup();
        ctx(agent(), 0);
        c.set_paused(agent(), false);
    }
}
