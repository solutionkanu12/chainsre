-- ChainSRE Phase 4 — seed the ONE real enrollment.
--
-- Per the roadmap gate ("Seed protected enrollment only"): only the real
-- protected DemoVault is enrolled. The control vault
-- (0xF0Dd43FBbEA515f2fa8e2c0C0a2C60f5eFC6f3b5, `PHASE-2-RESULTS.md` §1) is
-- deliberately left unenrolled — that asymmetry is the entire point of the
-- protected/control comparison the product demonstrates.
--
-- Idempotent: re-running this migration (or applying it to an environment
-- where the row already exists) is a no-op via `on conflict do nothing`
-- against the (chain_id, contract_address, action_selector) uniqueness
-- constraint from 0002.

insert into public.enrollments (
  chain_id,
  contract_address,
  action_selector,
  policy_version,
  guardian_workflow_id,
  status
) values (
  84532,
  '0x429f2b842e5b0bcfd5f8359736acc444fb35fb4b', -- protected DemoVault (PHASE-2-RESULTS.md)
  '0xdd10f8ca', -- mintShares(bytes32,address,uint256) selector (PHASE-3-RESULTS.md)
  'v1',
  'hlf2xtixpndbm24dmj5kg', -- ChainSRE Guardian - Protected Vault (PHASE-3-RESULTS.md §2)
  'active'
)
on conflict (chain_id, contract_address, action_selector) do nothing;
