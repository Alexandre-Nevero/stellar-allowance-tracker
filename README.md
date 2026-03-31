# BaonGuard

> A Soroban timelock vault that releases a student's weekly allowance in daily installments — putting discipline on-chain so parents sleep easy and students stop going broke by Wednesday.

---
## Stellar Contract
Link: https://stellar.expert/explorer/testnet/contract/CBKFO3VGYBLNNS3VDTDOUXV2SIZCVVJLCSZFU5GIJWTO2O7E5PQDPY2E

Contract Address: CBKFO3VGYBLNNS3VDTDOUXV2SIZCVVJLCSZFU5GIJWTO2O7E5PQDPY2E

<img width="1920" height="1293" alt="Screenshot 2026-03-31 at 16-11-06 Contract CBKFO3VGYBLNNS3VDTDOUXV2SIZCVVJLCSZFU5GIJWTO2O7E5PQDPY2E StellarExpert" src="https://github.com/user-attachments/assets/4d81b424-d5a5-4722-af00-3ef94ac62488" />


## Problem

A college student in Pasig City receives their full weekly *baon* (allowance) digitally, burns through it by Wednesday on milk tea and digital goods, and has nothing left for jeepney rides or canteen meals for the rest of the week.

## Solution

The parent deposits the week's USDC into a BaonGuard Soroban contract. The student can only withdraw **≤ ₱200 equivalent per 24 hours** — enforced by `env.ledger().timestamp()`. No bank, no middleman, no "transfer fees for each installment." Just a contract that literally cannot hand over more than the daily limit before the clock says so.

---

## Stellar Features Used

| Feature | Role |
|---|---|
| **Soroban smart contracts** | Timelock controller + daily limit enforcement |
| **USDC (SEP-41 token)** | Allowance currency deposited by parent |
| **XLM** | Network gas fees |
| **`env.ledger().timestamp()`** | On-chain clock for the 24-hour cooldown |

---

## MVP Delivery Timeline (2–4 hours)

| Hour | Milestone |
|---|---|
| 0 – 0.5 | Scaffold repo, write `Cargo.toml`, confirm toolchain |
| 0.5 – 1.5 | Write and locally test `lib.rs` (initialize + withdraw + get_vault_info) |
| 1.5 – 2.5 | Write `test.rs` — all 5 tests passing with `cargo test` |
| 2.5 – 3.5 | Build Wasm, deploy to Testnet, invoke via Soroban CLI |
| 3.5 – 4.0 | Wire minimal web frontend (read-only vault dashboard) + demo recording |

---

## Prerequisites

- **Rust** ≥ 1.74 with `wasm32-unknown-unknown` target  
  ```
  rustup target add wasm32-unknown-unknown
  ```
- **Soroban CLI** ≥ 21.x  
  ```
  cargo install --locked soroban-cli
  ```
- **Stellar Testnet** account funded via [Friendbot](https://friendbot.stellar.org)

---

## Build

```bash
soroban contract build
# Output: target/wasm32-unknown-unknown/release/baonguard.wasm
```

---

## Test

```bash
cargo test
```

Expected output — all 5 tests pass:

```
test tests::test_happy_path_withdraw_succeeds_after_24h ... ok
test tests::test_withdraw_exceeds_daily_limit_panics    ... ok
test tests::test_withdraw_before_24h_panics             ... ok
test tests::test_state_correctly_updated_after_withdrawal ... ok
test tests::test_non_student_withdraw_panics            ... ok
```

---

## Deploy to Testnet

```bash
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/baonguard.wasm \
  --source-account YOUR_SECRET_KEY \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"
```

Save the returned `CONTRACT_ID` for subsequent invocations.

---

## CLI Invocations

### `initialize` — parent sets up the vault

```bash
soroban contract invoke \
  --id CONTRACT_ID \
  --source-account PARENT_SECRET_KEY \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- initialize \
  --student GBSTUDENT_WALLET_ADDRESS \
  --token USDC_TOKEN_CONTRACT_ID \
  --daily_limit 2000000   # 0.20 USDC in stroops (7-decimal token)
```

### `withdraw` — student pulls today's allowance

```bash
soroban contract invoke \
  --id CONTRACT_ID \
  --source-account STUDENT_SECRET_KEY \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- withdraw \
  --amount 2000000        # ≤ daily_limit
```

### `get_vault_info` — frontend read

```bash
soroban contract invoke \
  --id CONTRACT_ID \
  --source-account STUDENT_SECRET_KEY \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- get_vault_info
```

Sample response:

```json
{
  "student": "GBSTUDENT...",
  "daily_limit": 2000000,
  "last_withdrawal_timestamp": 1712000000,
  "current_balance": 12000000
}
```

---

## Optional AI Edge (Bonus)

An off-chain Python microservice reads Stellar transaction `memo` fields and classifies each spend as **Essential** (transport / canteen) or **Non-Essential** (milk tea / gaming). At week-end it emails the parent a **Financial Health Grade** (A–F) with a breakdown chart.

> No additional Soroban changes required — the classifier is purely off-chain and reads public ledger data.

---

## License

MIT © 2024 BaonGuard Contributors
