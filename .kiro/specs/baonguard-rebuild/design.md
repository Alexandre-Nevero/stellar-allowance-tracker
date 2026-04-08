# BaonGuard Rebuild — Bugfix Design

## Overview

BaonGuard is a Soroban timelock vault on Stellar Testnet. A parent initializes the vault with a
student's wallet address, a USDC token address, and a daily withdrawal limit (in stroops). The
student can then withdraw up to that limit once every 24 hours using their Freighter wallet.

The current codebase is non-functional due to seven bugs spanning all three layers. This design
formalizes the fault conditions, defines the expected correct behavior, and specifies the
three-tier architecture that replaces the broken frontend-only approach.

**Fix strategy**: Introduce a FastAPI backend that proxies all Stellar RPC calls, fix the React
entry point and build configuration, correct the `.env` format, and remove all dead AI/ML code.
The Soroban contract (`lib.rs`) is correct and must not be modified.

---

## Glossary

- **Bug_Condition (C)**: Any of the seven conditions that cause the application to fail — missing
  entry point, broken build, malformed env, CORS errors, type mismatch, dead code, missing backend.
- **Property (P)**: The desired behavior after the fix — the app boots, builds, reads env vars,
  routes all RPC calls through FastAPI, converts amounts correctly, has no AI references, and
  returns structured errors.
- **Preservation**: The Soroban contract's existing enforce-on-chain logic (daily limit, 24h
  cooldown, require_auth) must not change. All contract behavior from requirements section 3 must
  continue to work exactly as before.
- **Stroops**: The smallest unit of a Stellar token. 1 USDC = 10,000,000 stroops (7 decimal
  places). All amounts in the contract are stored and compared as `i128` stroops.
- **Soroban**: Stellar's WebAssembly smart contract platform. Contracts run deterministically
  on-chain and are invoked via the Stellar RPC.
- **Freighter**: A browser extension wallet for Stellar. It holds the user's private key locally
  and signs transactions without ever exposing the key to the web app.
- **SEP-41**: The Stellar token standard (similar to ERC-20 on Ethereum). The USDC contract on
  Stellar implements SEP-41, which is why the vault calls `token.transfer()`.
- **RPC**: The HTTP interface to the Stellar network. We use `soroban-testnet.stellar.org`.
- **Simulation**: Before submitting a Soroban transaction, you must simulate it first. Simulation
  returns the fee estimate and the auth entries the contract needs — without simulation the
  transaction will be rejected.
- **`require_auth()`**: A Soroban SDK function that asserts the given address has signed the
  transaction. If the signature is missing, the contract panics and the transaction fails.
- **`env.ledger().timestamp()`**: Returns the Unix timestamp of the current ledger (block). Used
  by the contract to enforce the 24-hour cooldown between withdrawals.
- **`isBugCondition(input)`**: Pseudocode function that returns true when an input triggers one
  of the seven bugs.
- **`expectedBehavior(result)`**: Pseudocode function that returns true when the system's output
  matches the correct specification.

---

## Bug Details

### Fault Condition

The application is broken across seven distinct fault conditions. Each maps to a specific layer
and a specific input that triggers it.

**Formal Specification:**

```
FUNCTION isBugCondition(input)
  INPUT: input — one of: npm command, Vite build, browser env read,
                         browser RPC call, withdrawal amount, codebase review,
                         contract call with no backend
  OUTPUT: boolean — true means this input triggers a bug

  -- Bug 1.1: The React entry point is missing entirely
  IF input.type == "npm_run_dev"
    AND NOT fileExists("src/main.jsx")
    THEN RETURN true   -- app cannot start, index.html has no module to load

  -- Bug 1.2: The buffer polyfill is aliased but the package isn't installed
  IF input.type == "vite_build"
    AND viteConfig.resolve.alias["buffer"] == "buffer"
    AND NOT packageJson.dependencies["buffer"] EXISTS
    THEN RETURN true   -- Vite can't resolve the alias, build crashes

  -- Bug 1.3: .env has a raw string instead of KEY=VALUE
  IF input.type == "browser_env_read"
    AND dotEnvContents == "CBKFO3VGYBLNNS3VDTDOUXV2SIZCVVJLCSZFU5GIJWTO2O7E5PQDPY2E"
    -- (no variable name, just the raw address)
    THEN RETURN true   -- Vite never injects it, import.meta.env.VITE_CONTRACT_ID == undefined

  -- Bug 1.4: Frontend calls Stellar RPC directly from the browser
  IF input.type == "browser_rpc_call"
    AND requestOrigin == "browser"
    AND targetUrl == "https://soroban-testnet.stellar.org"
    THEN RETURN true   -- browser is blocked by CORS, no server-side proxy exists

  -- Bug 1.5: BigInt passed where number/string is expected for i128 conversion
  IF input.type == "withdrawal_amount"
    AND typeof(input.amountStroops) == "bigint"
    AND sdkVersion >= 12
    THEN RETURN true   -- nativeToScVal("i128", BigInt) throws in stellar-sdk v12

  -- Bug 1.6: Dead AI/ML code is still referenced in the codebase
  IF input.type == "codebase_review"
    AND (codeContains("spendClassifier") OR codeContains("healthGrader"))
    THEN RETURN true   -- dead code creates confusion, violates the no-AI constraint

  -- Bug 1.7: No backend exists to handle contract call errors
  IF input.type == "contract_call"
    AND NOT backendExists()
    THEN RETURN true   -- errors are swallowed or displayed as raw exceptions in the UI

  RETURN false  -- none of the bug conditions matched
END FUNCTION
```

### Concrete Examples

- **Bug 1.1**: User runs `npm run dev`. Vite reads `index.html`, finds
  `<script type="module" src="/src/main.jsx">`, tries to load the file, gets a 404. Dev server
  crashes. Expected: `src/main.jsx` exists and mounts `<App />` into `#root`.

- **Bug 1.2**: User runs `npm run build`. Vite processes `vite.config.js`, sees
  `alias: { buffer: 'buffer/' }`, tries to resolve the `buffer` package, fails because it's not
  in `node_modules`. Expected: `"buffer": "^6.0.3"` in `package.json` so the alias resolves.

- **Bug 1.3**: `import.meta.env.VITE_CONTRACT_ID` logs `undefined` in the browser console.
  The `.env` file contains only `CBKFO3VGYBLNNS3VDTDOUXV2SIZCVVJLCSZFU5GIJWTO2O7E5PQDPY2E`
  with no key name. Expected: `.env` contains
  `VITE_CONTRACT_ID=CBKFO3VGYBLNNS3VDTDOUXV2SIZCVVJLCSZFU5GIJWTO2O7E5PQDPY2E`.

- **Bug 1.4**: `getVaultInfo()` in the browser fires a `fetch` to
  `https://soroban-testnet.stellar.org`. The browser blocks it with
  `Access-Control-Allow-Origin` missing. Expected: `fetch('/api/vault-info')` hits FastAPI,
  which calls the RPC server-side where CORS doesn't apply.

- **Bug 1.5**: `nativeToScVal(BigInt(5000000), { type: "i128" })` throws
  `TypeError: Cannot convert a BigInt value to a number`. Expected: pass
  `String(amountStroops)` or a plain `number` so the SDK can serialize it correctly.

- **Bug 1.6**: `src/stellar.js` has a comment block referencing `spendClassifier.predict()`.
  The function doesn't exist anywhere. Expected: all AI/ML references removed.

- **Bug 1.7**: Parent calls `initialize`. The React component catches the error and logs it to
  the console, but the UI shows nothing. Expected: FastAPI returns
  `{ "error": "Vault already initialized" }` with HTTP 400, and the UI renders that message.

---

## Expected Behavior

### Preservation Requirements

The Soroban contract (`lib.rs`) is correct. These behaviors must not change after the fix:

**Unchanged Behaviors:**
- `initialize(student, token, daily_limit)` stores all three values in contract instance storage
  and can only be called once (subsequent calls panic).
- `withdraw(student, amount)` transfers USDC from the contract to the student wallet when
  `amount <= daily_limit` AND `now >= last_withdrawal + 86400 seconds`.
- `withdraw` panics with `"withdrawal too soon"` when called before 24 hours have elapsed.
- `withdraw` panics with `"exceeds daily limit"` when `amount > daily_limit`.
- `withdraw` fails auth when the caller is not the registered student address.
- `get_vault_info()` returns `(student_address, daily_limit, last_withdrawal_timestamp, balance)`.
- First withdrawal (when `last_withdrawal_timestamp == 0`) is always allowed immediately.

**Scope of the Fix:**
All inputs that do NOT trigger one of the seven bug conditions above must be completely
unaffected. This includes:
- Any valid contract call that was already working in isolation (e.g., direct `soroban-cli` calls)
- The contract's on-chain enforcement logic (limit, cooldown, auth)
- The Freighter signing flow (Freighter itself is not broken)

---

## Hypothesized Root Cause

1. **Missing Entry Point (Bug 1.1)**: The original project was scaffolded without `main.jsx`.
   The AI-generated code may have assumed a different entry point name or skipped the file
   entirely. `index.html` was written to reference it but the file was never created.

2. **Incomplete Dependency Declaration (Bug 1.2)**: The `vite.config.js` was copied from a
   working project that had `buffer` installed, but `package.json` was not updated to match.
   The polyfill is needed because `@stellar/stellar-sdk` uses Node.js `Buffer` internally, which
   doesn't exist in browsers — Vite needs to substitute it with the npm `buffer` package.

3. **Malformed Environment File (Bug 1.3)**: The `.env` file was likely created by pasting the
   contract address directly without the `KEY=` prefix. Vite's env injection requires strict
   `KEY=VALUE` format and only exposes variables prefixed with `VITE_` to the browser.

4. **No Backend Proxy (Bug 1.4)**: The original design had the frontend call the Stellar RPC
   directly. This works in Node.js (e.g., scripts, tests) but browsers enforce CORS. The Stellar
   testnet RPC does not send `Access-Control-Allow-Origin: *` headers, so all browser requests
   are blocked. The fix is a FastAPI server that makes the RPC call server-side.

5. **SDK Version Type Mismatch (Bug 1.5)**: `stellar-sdk` v12 changed how `nativeToScVal`
   handles `i128`. In earlier versions, passing a `BigInt` worked. In v12, the function expects
   a `number` or `string` for the `i128` path. The fix is to convert to `String()` before
   passing, or to move the conversion to the Python backend where the stellar-sdk (Python) handles
   it correctly.

6. **AI Code Residue (Bug 1.6)**: The previous AI-assisted build included a spend classifier
   and financial health grader. These were removed from the logic but references remain in
   comments and variable names, creating dead code paths that confuse the reader.

7. **Missing Error Handling Layer (Bug 1.7)**: Without a backend, the React component was
   directly catching raw Stellar SDK errors (which are verbose and technical) and had no
   consistent way to surface them. The fix is FastAPI's exception handlers, which catch all
   errors and return `{ "error": "..." }` JSON with appropriate HTTP status codes.

---

## Correctness Properties

Property 1: Fault Condition — Application Boots and Builds Successfully

_For any_ developer environment where the seven bug conditions are fixed (main.jsx exists,
buffer is in package.json, .env is correctly formatted, FastAPI proxy is running, amounts are
strings not BigInts, AI code is removed, backend exists), the application SHALL start with
`npm run dev`, build with `npm run build`, and load in the browser without console errors.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7**

Property 2: Preservation — Contract Enforcement Unchanged

_For any_ input where the bug condition does NOT hold (i.e., the contract is called with valid
or invalid parameters through the new FastAPI proxy), the Soroban contract SHALL produce
exactly the same result as it did before the fix — accepting valid withdrawals, rejecting
over-limit amounts, rejecting early withdrawals, and rejecting unauthorized callers.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7**

Property 3: Fault Condition — All RPC Calls Proxied Through FastAPI

_For any_ Stellar RPC call triggered by a user action in the browser, the HTTP request SHALL
originate from the FastAPI server (not the browser), so that CORS restrictions never apply and
the browser never has direct access to the Stellar network.

**Validates: Requirements 2.4, FR-A1, FR-A2, FR-A3**

Property 4: Fault Condition — Structured Error Responses

_For any_ contract call that fails (cooldown not elapsed, limit exceeded, auth failure, network
error), the FastAPI backend SHALL return a JSON response with an `error` string field and an
appropriate HTTP status code (400, 422, or 500), and the React frontend SHALL display that
message without crashing.

**Validates: Requirements 2.7, FR-A4**

Property 5: Preservation — Vault Info Consistency

_For any_ contract state, the value returned by `GET /vault-info` SHALL exactly match the
values stored in the Soroban contract's instance storage — `current_balance` is never negative,
`daily_limit` matches what was set at initialization, and `last_withdrawal_timestamp` matches
the ledger timestamp of the most recent successful withdrawal.

**Validates: Requirements 3.6, FR-A1**

---

## System Architecture Overview

### High-Level Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  BROWSER                                                            │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  React App (Vite)                                            │  │
│  │                                                              │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐   │  │
│  │  │VaultDashboard│  │WithdrawForm  │  │InitializeForm    │   │  │
│  │  └──────┬──────┘  └──────┬───────┘  └────────┬─────────┘   │  │
│  │         │                │                    │             │  │
│  │         └────────────────┴────────────────────┘             │  │
│  │                          │                                  │  │
│  │                    api.js (fetch)                           │  │
│  │                          │                                  │  │
│  │                    wallet.js (Freighter)                    │  │
│  └──────────────────────────┼──────────────────────────────────┘  │
│                             │  HTTP (JSON)                         │
└─────────────────────────────┼───────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  FASTAPI BACKEND  (Python 3.11+)                                    │
│                                                                     │
│  main.py                                                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │GET /vault-info│  │POST /initialize│  │POST /withdraw           │  │
│  └──────┬───────┘  └──────┬───────┘  └────────────┬─────────────┘  │
│         │                 │                        │               │
│         └─────────────────┴────────────────────────┘               │
│                           │                                        │
│                   stellar_client.py                                │
│                   (stellar-sdk Python wrapper)                     │
│                           │                                        │
└───────────────────────────┼─────────────────────────────────────────┘
                            │  HTTPS (JSON-RPC)
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STELLAR TESTNET RPC                                                │
│  https://soroban-testnet.stellar.org                                │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  Soroban Contract  CBKFO3VGYBLNNS3VDTDOUXV2SIZCVVJLCSZFU5G  │  │
│  │                                                              │  │
│  │  initialize()   withdraw()   get_vault_info()               │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Layer Responsibilities

**React Frontend** — What the user sees and interacts with. It knows nothing about Stellar
internals. It only knows: "call this URL, get JSON back, show it." It uses Freighter to sign
transactions (the private key never leaves the browser extension), but it never talks to the
Stellar RPC directly.

**FastAPI Backend** — The bridge between the browser and the blockchain. It validates inputs,
builds Soroban transactions, calls the Stellar RPC, and returns clean JSON. It runs on the
server where CORS doesn't apply. Think of it as a translator: React speaks HTTP/JSON, Stellar
speaks XDR/JSON-RPC, and FastAPI speaks both.

**Stellar RPC + Soroban Contract** — The source of truth. The contract enforces all business
rules (daily limit, cooldown, auth) on-chain. No amount of frontend or backend trickery can
bypass it — the contract code runs deterministically on every Stellar validator node.

### Why We Need a Backend Proxy

Three reasons:

1. **CORS**: Browsers enforce the Same-Origin Policy. When your React app at `localhost:5173`
   tries to fetch `https://soroban-testnet.stellar.org`, the browser checks if the RPC server
   sends an `Access-Control-Allow-Origin` header. It doesn't. The request is blocked before it
   even leaves the browser. A server-side proxy doesn't have this restriction — servers can call
   any URL freely.

2. **Key Management**: The backend holds the network passphrase and RPC URL in environment
   variables. The frontend never needs to know these. This is separation of concerns — the
   browser only needs to know the FastAPI URL.

3. **Error Handling**: Raw Stellar SDK errors are verbose and technical. FastAPI catches them
   and returns clean `{ "error": "Withdrawal too soon" }` JSON that the UI can display directly.

---

## Tech Stack with Versions

```
CONTRACT LAYER
  Language:     Rust (stable, 2021 edition)
  SDK:          soroban-sdk = "21.0.0"   -- Soroban smart contract SDK
  Build:        cargo build --target wasm32-unknown-unknown --release
  Deploy:       soroban-cli (already deployed, do not redeploy)

BACKEND LAYER
  Language:     Python 3.11+
  Framework:    FastAPI 0.111+           -- async HTTP framework
  Stellar SDK:  stellar-sdk 11.x         -- Python Stellar/Soroban SDK
  Server:       uvicorn 0.29+            -- ASGI server for FastAPI
  Validation:   pydantic v2              -- request/response models (built into FastAPI)
  Config:       python-dotenv 1.0+       -- loads .env into os.environ

FRONTEND LAYER
  Language:     JavaScript (ES2022)
  Framework:    React 18.3+
  Bundler:      Vite 5.x
  Stellar SDK:  @stellar/stellar-sdk 12.x  -- JS Stellar SDK (for XDR types)
  Wallet:       @stellar/freighter-api 2.x -- Freighter browser extension API
  Polyfill:     buffer 6.0.3              -- Node.js Buffer for browser (fixes bug 1.2)

ENVIRONMENT
  Frontend:     .env (Vite reads VITE_* vars at build time)
  Backend:      backend/.env (python-dotenv reads at startup)
  Never:        hardcode contract IDs, RPC URLs, or passphrases in source code
```

---

## Project Folder Structure

```
baonguard/
│
├── src/                          # Rust Soroban contract source
│   ├── lib.rs                    # Contract entry point — DO NOT MODIFY
│   └── test.rs                   # Contract unit tests (Rust)
│
├── Cargo.toml                    # Rust dependencies (soroban-sdk)
├── Cargo.lock                    # Locked dependency versions
│
├── backend/                      # FastAPI Python backend
│   ├── main.py                   # FastAPI app, route definitions, CORS config
│   ├── stellar_client.py         # Wraps stellar-sdk: build/simulate/submit txns
│   ├── requirements.txt          # Python dependencies (fastapi, stellar-sdk, etc.)
│   └── .env                      # Backend secrets: CONTRACT_ID, RPC_URL, PASSPHRASE
│
├── src/                          # React frontend source (Vite project root)
│   ├── main.jsx                  # NEW — React entry point, mounts <App /> (fixes bug 1.1)
│   ├── App.jsx                   # Root component, manages wallet state
│   ├── api.js                    # fetch() wrapper for all FastAPI calls
│   ├── wallet.js                 # Freighter wallet connect/disconnect/sign helpers
│   └── components/
│       ├── VaultDashboard.jsx    # Shows balance, daily limit, cooldown timer
│       ├── WithdrawForm.jsx      # Student withdrawal form
│       └── InitializeForm.jsx    # Parent vault initialization form
│
├── index.html                    # Vite HTML entry — references /src/main.jsx
├── vite.config.js                # Vite config with buffer polyfill (fixed)
├── package.json                  # npm deps including "buffer" (fixes bug 1.2)
└── .env                          # Frontend env vars in KEY=VALUE format (fixes bug 1.3)
```

> Note: The Rust `src/` and the React `src/` are the same directory. In a real project you'd
> separate them (e.g., `contract/src/` and `frontend/src/`), but we're keeping the existing
> structure to minimize changes.

---

## Soroban Contract Design (lib.rs)

The contract is already deployed and correct. This section explains how it works so you
understand what the backend is calling.

### Storage Keys

The contract stores five values in Soroban's instance storage (think of it as a key-value
store that lives on-chain, attached to this specific contract instance):

```
STUDENT    → Address   -- The student's Stellar wallet address.
                          Only this address can call withdraw().

TOKEN      → Address   -- The USDC token contract address (SEP-41).
                          The vault calls token.transfer() to move funds.

DAILY_LIM  → i128      -- Maximum stroops the student can withdraw per 24h.
                          Set by the parent at initialization. Never changes.

LAST_WITH  → u64       -- Unix timestamp (seconds) of the last successful withdrawal.
                          Updated every time withdraw() succeeds.
                          Starts at 0 — meaning "never withdrawn".

BALANCE    → i128      -- Current USDC balance held by the vault in stroops.
                          Decreases on each withdrawal.
```

### How env.ledger().timestamp() Works

```
-- In Soroban, you can't use system time (there is no system).
-- Instead, you read the timestamp of the current ledger (block).
-- Each Stellar ledger closes roughly every 5 seconds.
-- The timestamp is a Unix epoch in seconds, agreed upon by all validators.

-- This is how the 24-hour cooldown is enforced:
current_time = env.ledger().timestamp()   -- e.g., 1720000000
last_with    = env.storage().get(LAST_WITH) -- e.g., 1719913600

IF current_time < last_with + 86400       -- 86400 = 24 * 60 * 60 seconds
  THEN panic("withdrawal too soon")        -- reject the transaction
```

### Annotated Pseudocode

```
-- ─────────────────────────────────────────────────────────────────
-- initialize(env, student, token, daily_limit)
-- Called once by the parent to set up the vault.
-- ─────────────────────────────────────────────────────────────────
FUNCTION initialize(env, student: Address, token: Address, daily_limit: i128)

  -- Soroban instance storage is a key-value map on-chain.
  -- We store all five values here so they persist between transactions.
  env.storage().instance().set(STUDENT,   student)
  env.storage().instance().set(TOKEN,     token)
  env.storage().instance().set(DAILY_LIM, daily_limit)
  env.storage().instance().set(LAST_WITH, 0u64)   -- 0 = never withdrawn
  env.storage().instance().set(BALANCE,   0i128)  -- starts empty

  -- Extend the contract's TTL (time-to-live) so it doesn't expire.
  -- Soroban contracts are archived if not touched for ~30 days.
  env.storage().instance().extend_ttl(100, 100)

END FUNCTION


-- ─────────────────────────────────────────────────────────────────
-- withdraw(env, student, amount)
-- Called by the student to pull funds from the vault.
-- ─────────────────────────────────────────────────────────────────
FUNCTION withdraw(env, student: Address, amount: i128)

  -- require_auth() checks that the transaction was signed by `student`.
  -- If the signature is missing or wrong, the entire transaction fails here.
  -- This is Soroban's built-in authorization system — no passwords needed.
  student.require_auth()

  -- Load the stored values from on-chain storage.
  stored_student = env.storage().instance().get(STUDENT)
  daily_limit    = env.storage().instance().get(DAILY_LIM)
  last_with      = env.storage().instance().get(LAST_WITH)
  balance        = env.storage().instance().get(BALANCE)
  token          = env.storage().instance().get(TOKEN)

  -- Verify the caller is the registered student (belt-and-suspenders with require_auth).
  IF student != stored_student
    THEN panic("unauthorized")

  -- Enforce the daily limit. amount is in stroops (i128).
  IF amount > daily_limit
    THEN panic("exceeds daily limit")

  -- Enforce the 24-hour cooldown.
  -- last_with == 0 means first withdrawal — skip the cooldown check.
  current_time = env.ledger().timestamp()
  IF last_with != 0 AND current_time < last_with + 86400
    THEN panic("withdrawal too soon")

  -- Enforce solvency — can't withdraw more than the vault holds.
  IF amount > balance
    THEN panic("insufficient balance")

  -- Update state BEFORE the transfer (checks-effects-interactions pattern).
  -- This prevents reentrancy attacks.
  env.storage().instance().set(LAST_WITH, current_time)
  env.storage().instance().set(BALANCE,   balance - amount)

  -- Call the USDC token contract's transfer function.
  -- This moves `amount` stroops from the vault's address to the student's address.
  -- The token contract is a separate Soroban contract (SEP-41 standard).
  token_client = TokenClient::new(env, token)
  token_client.transfer(env.current_contract_address(), student, amount)

  env.storage().instance().extend_ttl(100, 100)

END FUNCTION


-- ─────────────────────────────────────────────────────────────────
-- get_vault_info(env) → (Address, i128, u64, i128)
-- Read-only view function. Returns current vault state.
-- ─────────────────────────────────────────────────────────────────
FUNCTION get_vault_info(env) → (student, daily_limit, last_withdrawal, balance)

  -- This is a "view" call — it reads state but doesn't change anything.
  -- No auth required, no fees (simulation only), no ledger write.
  RETURN (
    env.storage().instance().get(STUDENT),    -- student address
    env.storage().instance().get(DAILY_LIM),  -- daily limit in stroops
    env.storage().instance().get(LAST_WITH),  -- last withdrawal Unix timestamp
    env.storage().instance().get(BALANCE)     -- current balance in stroops
  )

END FUNCTION
```

### What Are Stroops and Why i128?

```
-- 1 XLM  = 10,000,000 stroops  (7 decimal places)
-- 1 USDC = 10,000,000 stroops  (USDC on Stellar also uses 7 decimals)

-- So if the daily limit is $5.00 USDC:
daily_limit = 5 * 10_000_000 = 50_000_000 stroops

-- Why i128? Because i64 (max ~9.2 × 10^18) could overflow for large amounts
-- when multiplied by 10^7. i128 gives us ~1.7 × 10^38, which is safe.
-- Soroban uses i128 for all token amounts by convention.
```

---

## FastAPI Backend Design

### Pydantic Request/Response Models

```python
# backend/main.py — Pydantic models define the shape of JSON in and out.
# FastAPI uses these for automatic validation AND documentation.

from pydantic import BaseModel, Field
from typing import Optional

# ── Request body for POST /initialize ──────────────────────────────────────
class InitializeRequest(BaseModel):
    student_address: str = Field(
        ...,                          # "..." means required (no default)
        description="Stellar G-address of the student wallet",
        example="GABC...XYZ"
    )
    token_address: str = Field(
        ...,
        description="Stellar contract address of the USDC token (C-address)",
        example="CBKFO3..."
    )
    daily_limit: int = Field(
        ...,
        gt=0,                         # must be greater than 0
        description="Maximum stroops the student can withdraw per 24h"
    )

# ── Request body for POST /withdraw ────────────────────────────────────────
class WithdrawRequest(BaseModel):
    student_address: str = Field(
        ...,
        description="Must match the address registered at initialization"
    )
    amount: int = Field(
        ...,
        gt=0,
        description="Amount in stroops to withdraw (must be <= daily_limit)"
    )

# ── Response body for GET /vault-info ──────────────────────────────────────
class VaultInfoResponse(BaseModel):
    student_address: str             # The registered student G-address
    daily_limit: int                 # Daily limit in stroops
    last_withdrawal_timestamp: int   # Unix seconds, 0 if never withdrawn
    current_balance: int             # Current vault balance in stroops

# ── Generic error response (used by all endpoints on failure) ──────────────
class ErrorResponse(BaseModel):
    error: str                       # Human-readable error message
    detail: Optional[str] = None     # Optional technical detail for debugging
```

### Endpoint Pseudocode

```python
# backend/main.py

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import os
from stellar_client import StellarClient

app = FastAPI(title="BaonGuard API")

# ── CORS Configuration ──────────────────────────────────────────────────────
# CORS (Cross-Origin Resource Sharing) is a browser security feature.
# When your React app at localhost:5173 calls localhost:8000, the browser
# checks if the server allows it. We must explicitly list allowed origins.
# In production, replace "*" with your actual frontend domain.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Only allow our React dev server
    allow_methods=["GET", "POST"],            # Only the methods we use
    allow_headers=["Content-Type"],           # Only the headers we need
)

# ── Startup: load config from environment variables ─────────────────────────
# python-dotenv loads backend/.env into os.environ at startup.
# We never hardcode these values — they change between environments.
CONTRACT_ID = os.environ["CONTRACT_ID"]           # The deployed contract address
STELLAR_RPC_URL = os.environ["STELLAR_RPC_URL"]   # Testnet RPC endpoint
NETWORK_PASSPHRASE = os.environ["NETWORK_PASSPHRASE"]  # Identifies the network

# Create one shared StellarClient instance (reused across requests)
client = StellarClient(CONTRACT_ID, STELLAR_RPC_URL, NETWORK_PASSPHRASE)


# ── GET /vault-info ─────────────────────────────────────────────────────────
# Returns the current state of the vault by calling get_vault_info() on-chain.
# This is a read-only call — no transaction, no fee, no signing required.
@app.get("/vault-info", response_model=VaultInfoResponse)
async def get_vault_info():
    try:
        # Call the contract's get_vault_info() function via simulation.
        # Simulation = "run the contract but don't write to the ledger".
        # It's free and instant — perfect for read-only queries.
        result = await client.call_contract_view("get_vault_info", args=[])

        # The contract returns a tuple: (student, daily_limit, last_with, balance)
        # We unpack it and return as JSON.
        return VaultInfoResponse(
            student_address=result[0],
            daily_limit=result[1],
            last_withdrawal_timestamp=result[2],
            current_balance=result[3]
        )
    except Exception as e:
        # If anything goes wrong (contract not initialized, RPC down, etc.),
        # return a structured error instead of a raw Python traceback.
        raise HTTPException(status_code=500, detail={"error": str(e)})


# ── POST /initialize ────────────────────────────────────────────────────────
# Initializes the vault. Called once by the parent.
# FastAPI automatically validates the request body against InitializeRequest.
# If validation fails (missing field, wrong type), FastAPI returns HTTP 422
# before our code even runs — no manual validation needed.
@app.post("/initialize")
async def initialize_vault(body: InitializeRequest):
    try:
        # Build and submit the initialize() transaction.
        # This writes to the ledger, so it costs XLM gas and requires signing.
        # The backend signs with the contract's admin keypair (from env vars).
        tx_hash = await client.invoke_contract(
            function_name="initialize",
            args=[
                body.student_address,   # Stellar Address type
                body.token_address,     # Stellar Address type
                body.daily_limit        # i128 — the SDK handles the conversion
            ]
        )
        return {"transaction_hash": tx_hash, "status": "success"}
    except Exception as e:
        raise HTTPException(status_code=400, detail={"error": str(e)})


# ── POST /withdraw ──────────────────────────────────────────────────────────
# Submits a withdrawal transaction. Called by the student.
# The student's Freighter wallet signs the transaction in the browser,
# then the signed XDR is sent here for submission.
@app.post("/withdraw")
async def withdraw(body: WithdrawRequest):
    try:
        # Build the transaction (unsigned) and simulate it first.
        # Simulation tells us: (1) the fee, (2) the auth entries needed,
        # (3) whether the contract will accept or reject the call.
        # If simulation fails (e.g., "withdrawal too soon"), we return the
        # error immediately without wasting a real transaction submission.
        tx_hash = await client.invoke_contract(
            function_name="withdraw",
            args=[
                body.student_address,
                body.amount             # int in Python → i128 in Soroban
            ]
        )
        return {"transaction_hash": tx_hash, "status": "success"}
    except Exception as e:
        # Surface the contract's panic message (e.g., "withdrawal too soon")
        # as a human-readable error in the JSON response.
        raise HTTPException(status_code=400, detail={"error": str(e)})
```

### stellar_client.py — Stellar SDK Wrapper

```python
# backend/stellar_client.py
# This module wraps the Python stellar-sdk to hide the complexity of
# building, simulating, and submitting Soroban transactions.

from stellar_sdk import SorobanServer, Keypair, TransactionBuilder, Network
from stellar_sdk.soroban_rpc import GetTransactionStatus

class StellarClient:
    def __init__(self, contract_id: str, rpc_url: str, network_passphrase: str):
        # SorobanServer is the Python stellar-sdk's interface to the RPC.
        # It handles HTTP connection pooling and JSON-RPC serialization.
        self.server = SorobanServer(rpc_url)
        self.contract_id = contract_id
        self.network_passphrase = network_passphrase

    async def call_contract_view(self, function_name: str, args: list):
        """
        Call a read-only contract function via simulation.
        No transaction is submitted — this is free and instant.
        Used for get_vault_info().
        """
        # Build a transaction that calls the contract function.
        # Even for view calls, Soroban requires a transaction envelope.
        # We use a dummy source account (doesn't need to exist on-chain for simulation).
        source = Keypair.random()
        source_account = self.server.load_account(source.public_key)

        # TransactionBuilder assembles the XDR transaction structure.
        # XDR (External Data Representation) is Stellar's binary encoding format.
        tx = (
            TransactionBuilder(
                source_account=source_account,
                network_passphrase=self.network_passphrase,
                base_fee=100  # minimum fee in stroops (0.00001 XLM)
            )
            .append_invoke_contract_function_op(
                contract_id=self.contract_id,
                function_name=function_name,
                parameters=args  # SDK converts Python types to Soroban ScVal types
            )
            .build()
        )

        # simulate_transaction() runs the contract on the RPC node without
        # writing to the ledger. Returns the result and fee estimate.
        response = self.server.simulate_transaction(tx)

        if response.error:
            raise Exception(f"Simulation failed: {response.error}")

        # Parse the ScVal result back into Python types.
        # ScVal is Soroban's typed value format (like a union type in Rust).
        return self._parse_result(response.results[0].xdr)

    async def invoke_contract(self, function_name: str, args: list) -> str:
        """
        Build, simulate, and submit a state-changing contract transaction.
        Returns the transaction hash on success.

        The Stellar transaction lifecycle:
        1. BUILD   — assemble the transaction with the contract call
        2. SIMULATE — run it on the RPC to get fee + auth entries
        3. PREPARE — apply the simulation results (fee, footprint, auth)
        4. SIGN    — sign with the source account keypair
        5. SUBMIT  — broadcast to the network
        6. POLL    — wait for the transaction to be included in a ledger
        """
        # Step 1: BUILD
        # Load the source account to get the current sequence number.
        # Sequence numbers prevent replay attacks — each transaction must
        # have a sequence number exactly one higher than the last.
        source_keypair = Keypair.from_secret(os.environ["ADMIN_SECRET_KEY"])
        source_account = self.server.load_account(source_keypair.public_key)

        tx = (
            TransactionBuilder(
                source_account=source_account,
                network_passphrase=self.network_passphrase,
                base_fee=100
            )
            .append_invoke_contract_function_op(
                contract_id=self.contract_id,
                function_name=function_name,
                parameters=args
            )
            .set_timeout(30)  # transaction expires after 30 seconds
            .build()
        )

        # Step 2 & 3: SIMULATE + PREPARE
        # prepare_transaction() calls simulate internally, then applies the
        # simulation results to the transaction (sets the fee, adds the
        # contract's storage footprint, and attaches auth entries).
        # Without this step, the transaction will be rejected by the network.
        prepared_tx = self.server.prepare_transaction(tx)

        # Step 4: SIGN
        # Sign with the admin keypair. For withdraw(), the student also needs
        # to sign — their signature comes from Freighter in the browser.
        prepared_tx.sign(source_keypair)

        # Step 5: SUBMIT
        response = self.server.send_transaction(prepared_tx)

        if response.status == "ERROR":
            raise Exception(f"Submission failed: {response.error_result_xdr}")

        # Step 6: POLL
        # Transactions are not immediately confirmed. We poll until the
        # transaction is included in a ledger (usually 5-10 seconds).
        tx_hash = response.hash
        while True:
            result = self.server.get_transaction(tx_hash)
            if result.status == GetTransactionStatus.SUCCESS:
                return tx_hash
            elif result.status == GetTransactionStatus.FAILED:
                raise Exception(f"Transaction failed: {result.result_xdr}")
            # Still pending — wait one ledger close (~5 seconds) and retry
            await asyncio.sleep(5)

    def _parse_result(self, xdr: str):
        """Convert Soroban ScVal XDR back to Python types."""
        # ScVal is Soroban's typed value system. Each value has a type tag
        # (e.g., ScValType.ADDRESS, ScValType.I128) and a value.
        # The SDK provides helpers to decode these back to Python primitives.
        from stellar_sdk.xdr import SCVal
        val = SCVal.from_xdr(xdr)
        # ... type-specific parsing based on val.type
        return val
```

---

## React Frontend Design

### Component Tree

```
App.jsx                          ← manages walletAddress state
├── ConnectWalletButton          ← calls wallet.js → Freighter
├── VaultDashboard.jsx           ← calls GET /vault-info on mount
│   └── CooldownTimer            ← derived from last_withdrawal_timestamp
├── WithdrawForm.jsx             ← calls POST /withdraw
└── InitializeForm.jsx           ← calls POST /initialize
```

### wallet.js — Freighter Integration

```javascript
// src/wallet.js
// Freighter is a browser extension that manages the user's Stellar private key.
// We never see the private key — we only ask Freighter to sign things for us.

import {
  isConnected,          // checks if Freighter extension is installed
  getPublicKey,         // returns the user's G-address (public key)
  signTransaction,      // asks Freighter to sign a transaction XDR
} from "@stellar/freighter-api";

// ── Connect wallet ──────────────────────────────────────────────────────────
export async function connectWallet() {
  // First check if the extension is installed at all.
  // If not, we can't do anything — show a "install Freighter" message.
  const connected = await isConnected();
  if (!connected) {
    throw new Error("Freighter is not installed. Please install the extension.");
  }

  // getPublicKey() opens the Freighter popup asking the user to approve.
  // Returns a G-address like "GABC...XYZ" — this is the public key only.
  // The private key stays inside Freighter, we never see it.
  const publicKey = await getPublicKey();
  return publicKey;  // store this in React state as walletAddress
}

// ── Sign a transaction ──────────────────────────────────────────────────────
export async function signTx(transactionXDR, networkPassphrase) {
  // The backend builds the transaction and returns it as XDR (base64 string).
  // We pass it to Freighter, which shows the user what they're signing.
  // Freighter returns the signed XDR — still base64, but now with a signature.
  const signedXDR = await signTransaction(transactionXDR, {
    networkPassphrase,  // tells Freighter which network this is for
  });
  return signedXDR;
}
```

### api.js — FastAPI Fetch Wrapper

```javascript
// src/api.js
// All communication with the backend goes through this file.
// The React components never use fetch() directly — they call these functions.
// This makes it easy to change the API URL or add auth headers in one place.

// Read the API URL from the environment variable injected by Vite.
// VITE_API_URL is defined in .env as "http://localhost:8000".
const API_URL = import.meta.env.VITE_API_URL;

// ── GET /vault-info ─────────────────────────────────────────────────────────
export async function getVaultInfo() {
  // Simple GET request — no body, no auth.
  // FastAPI calls the Soroban contract and returns JSON.
  const response = await fetch(`${API_URL}/vault-info`);

  if (!response.ok) {
    // Parse the error JSON and throw it so the component can display it.
    const err = await response.json();
    throw new Error(err.detail?.error || "Failed to load vault info");
  }

  return response.json();
  // Returns: { student_address, daily_limit, last_withdrawal_timestamp, current_balance }
}

// ── POST /initialize ────────────────────────────────────────────────────────
export async function initializeVault(studentAddress, tokenAddress, dailyLimit) {
  const response = await fetch(`${API_URL}/initialize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      student_address: studentAddress,
      token_address: tokenAddress,
      daily_limit: dailyLimit,  // number (int), not BigInt — fixes bug 1.5
    }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.detail?.error || "Initialization failed");
  }

  return response.json();
  // Returns: { transaction_hash: "abc...", status: "success" }
}

// ── POST /withdraw ──────────────────────────────────────────────────────────
export async function withdraw(studentAddress, amount) {
  // amount is a plain JavaScript number (not BigInt).
  // The Python backend converts it to i128 for the contract call.
  // This avoids the BigInt serialization bug (bug 1.5).
  const response = await fetch(`${API_URL}/withdraw`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      student_address: studentAddress,
      amount: Number(amount),  // ensure it's a number, not BigInt
    }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(err.detail?.error || "Withdrawal failed");
  }

  return response.json();
  // Returns: { transaction_hash: "abc...", status: "success" }
}
```

### VaultDashboard.jsx — Data Flow

```jsx
// src/components/VaultDashboard.jsx
// Shows the student's current balance, daily limit, and cooldown timer.

import { useState, useEffect } from "react";
import { getVaultInfo } from "../api";

export default function VaultDashboard() {
  // React state: null = loading, object = loaded, string = error
  const [vaultInfo, setVaultInfo] = useState(null);
  const [error, setError] = useState(null);

  // useEffect with [] runs once when the component mounts (appears on screen).
  // This is where we fetch the initial vault data.
  useEffect(() => {
    async function loadVaultInfo() {
      try {
        // Call GET /vault-info through our api.js wrapper.
        // FastAPI calls the Soroban contract and returns JSON.
        const data = await getVaultInfo();
        setVaultInfo(data);
      } catch (err) {
        // If the backend is down or the contract isn't initialized,
        // show the error message instead of crashing.
        setError(err.message);
      }
    }
    loadVaultInfo();
  }, []); // [] = run once on mount, not on every re-render

  // ── Render states ──────────────────────────────────────────────────────
  if (error) return <div className="error">Error: {error}</div>;
  if (!vaultInfo) return <div>Loading vault info...</div>;

  // Calculate time until next withdrawal is available.
  // last_withdrawal_timestamp is Unix seconds from the contract.
  const now = Math.floor(Date.now() / 1000);  // current time in seconds
  const nextWithdrawal = vaultInfo.last_withdrawal_timestamp + 86400;
  const secondsRemaining = Math.max(0, nextWithdrawal - now);
  const canWithdraw = vaultInfo.last_withdrawal_timestamp === 0 || secondsRemaining === 0;

  // Convert stroops to USDC for display (divide by 10,000,000)
  const balanceUSDC = (vaultInfo.current_balance / 10_000_000).toFixed(2);
  const limitUSDC = (vaultInfo.daily_limit / 10_000_000).toFixed(2);

  return (
    <div>
      <p>Balance: {balanceUSDC} USDC</p>
      <p>Daily Limit: {limitUSDC} USDC</p>
      <p>{canWithdraw ? "Available now" : `Available in ${secondsRemaining}s`}</p>
    </div>
  );
}
```

### WithdrawForm.jsx — Withdrawal Flow

```jsx
// src/components/WithdrawForm.jsx
// Annotated pseudocode for the withdrawal flow.

FUNCTION handleWithdraw(event)
  event.preventDefault()

  -- 1. Get the amount from the form input (user typed a USDC amount)
  amountUSDC = parseFloat(amountInput)

  -- 2. Convert to stroops for the contract (multiply by 10,000,000)
  --    Use Math.round() to avoid floating-point precision issues.
  amountStroops = Math.round(amountUSDC * 10_000_000)

  -- 3. Call POST /withdraw via api.js
  --    The backend builds the transaction, simulates it, and submits it.
  --    If the contract rejects it (cooldown, limit), the error is returned here.
  TRY
    result = await withdraw(walletAddress, amountStroops)
    setTxHash(result.transaction_hash)   -- show success with tx hash
    setError(null)
  CATCH err
    setError(err.message)                -- show the contract's error message
    setTxHash(null)
  END TRY

END FUNCTION
```

---

## Environment Configuration

### Frontend .env (fixes bug 1.3)

```bash
# .env  (in the project root, next to package.json)
#
# Vite reads this file at build time and replaces import.meta.env.VITE_*
# with the actual values. ONLY variables prefixed with VITE_ are exposed
# to the browser — this prevents accidentally leaking backend secrets.
#
# WRONG (bug 1.3):
#   CBKFO3VGYBLNNS3VDTDOUXV2SIZCVVJLCSZFU5GIJWTO2O7E5PQDPY2E
#
# CORRECT:
VITE_CONTRACT_ID=CBKFO3VGYBLNNS3VDTDOUXV2SIZCVVJLCSZFU5GIJWTO2O7E5PQDPY2E
# ^ The deployed Soroban contract address. Used by the frontend to display
#   the contract ID in the UI (not for direct RPC calls — those go through FastAPI).

VITE_API_URL=http://localhost:8000
# ^ The FastAPI backend URL. All fetch() calls in api.js use this base URL.
#   In production, change this to your deployed backend URL.
```

### Backend .env

```bash
# backend/.env
# Loaded by python-dotenv at FastAPI startup.
# NEVER commit this file to git — add it to .gitignore.

CONTRACT_ID=CBKFO3VGYBLNNS3VDTDOUXV2SIZCVVJLCSZFU5GIJWTO2O7E5PQDPY2E
# ^ Same contract address as the frontend, but used server-side for RPC calls.

STELLAR_RPC_URL=https://soroban-testnet.stellar.org
# ^ The Stellar Testnet RPC endpoint. All contract calls go here.
#   For Mainnet, this would be https://soroban-mainnet.stellar.org.

NETWORK_PASSPHRASE=Test SDF Network ; September 2015
# ^ A string that uniquely identifies the Stellar network.
#   Every transaction is signed with this passphrase included in the hash.
#   This prevents a transaction signed for Testnet from being replayed on Mainnet.
#   Mainnet passphrase: "Public Global Stellar Network ; September 2015"

ADMIN_SECRET_KEY=S...
# ^ The secret key of the account that pays gas fees for contract calls.
#   This is NOT the student's key — it's a dedicated "fee payer" account.
#   NEVER log this, never return it in API responses, never commit it to git.
```

---

## Bug Fix Implementation Notes

### Bug 1.1 — Missing src/main.jsx

**File**: `src/main.jsx` (create new file)

**Why it fixes it**: `index.html` has `<script type="module" src="/src/main.jsx">`. Vite
resolves this path at dev-server startup. If the file doesn't exist, the server crashes.
Creating it with the standard React mount pattern is all that's needed.

```jsx
// BEFORE: file does not exist → Vite crashes with "file not found"

// AFTER: src/main.jsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

// ReactDOM.createRoot() is the React 18 API for mounting the app.
// It targets the <div id="root"> in index.html.
// StrictMode runs each component twice in development to catch side effects.
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

---

### Bug 1.2 — Missing buffer dependency

**File**: `package.json`

**Why it fixes it**: `vite.config.js` has `resolve: { alias: { buffer: "buffer/" } }`. This
tells Vite "whenever code imports 'buffer', use the npm package named 'buffer' instead." But
if that package isn't in `node_modules`, Vite can't resolve the alias and the build fails.
The `@stellar/stellar-sdk` uses Node.js `Buffer` internally, which doesn't exist in browsers.
The `buffer` npm package is a browser-compatible polyfill.

```json
// BEFORE: package.json dependencies
{
  "dependencies": {
    "react": "^18.3.0",
    "@stellar/stellar-sdk": "^12.0.0"
    // "buffer" is missing — vite.config.js alias can't resolve
  }
}

// AFTER: package.json dependencies
{
  "dependencies": {
    "react": "^18.3.0",
    "@stellar/stellar-sdk": "^12.0.0",
    "buffer": "^6.0.3"   // ← added: browser-compatible Buffer polyfill
  }
}
```

**Also verify vite.config.js has**:
```javascript
// vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { Buffer } from "buffer";  // import for the define block

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // When stellar-sdk imports 'buffer', use the npm package instead
      // of trying to find a Node.js built-in (which doesn't exist in browsers)
      buffer: "buffer/",
    },
  },
  define: {
    // Make Buffer available as a global variable in the browser bundle.
    // stellar-sdk accesses it as a global, not just as an import.
    global: {},
  },
});
```

---

### Bug 1.3 — Malformed .env file

**File**: `.env`

**Why it fixes it**: Vite's env injection requires strict `KEY=VALUE` format. It reads the
file line by line, splits on `=`, and injects `VITE_*` variables into `import.meta.env`.
A line with no `=` is silently ignored — no error, just `undefined` at runtime.

```bash
# BEFORE: .env (broken — raw string, no key name)
CBKFO3VGYBLNNS3VDTDOUXV2SIZCVVJLCSZFU5GIJWTO2O7E5PQDPY2E

# AFTER: .env (correct KEY=VALUE format)
VITE_CONTRACT_ID=CBKFO3VGYBLNNS3VDTDOUXV2SIZCVVJLCSZFU5GIJWTO2O7E5PQDPY2E
VITE_API_URL=http://localhost:8000
```

In React code:
```javascript
// BEFORE: always undefined because .env was malformed
const contractId = import.meta.env.VITE_CONTRACT_ID;  // → undefined

// AFTER: correctly resolves to the contract address string
const contractId = import.meta.env.VITE_CONTRACT_ID;
// → "CBKFO3VGYBLNNS3VDTDOUXV2SIZCVVJLCSZFU5GIJWTO2O7E5PQDPY2E"
```

---

### Bug 1.4 — CORS: Direct browser RPC calls

**Files**: `src/api.js` (new), `backend/main.py` (new), `backend/stellar_client.py` (new)

**Why it fixes it**: Move all Stellar RPC calls from the browser to the FastAPI server.
The browser only calls `http://localhost:8000` (our own server), which we control and can
configure CORS for. The server calls `https://soroban-testnet.stellar.org` — servers don't
have CORS restrictions.

```javascript
// BEFORE: src/stellar.js — calls RPC directly from browser (CORS error)
import { SorobanRpc } from "@stellar/stellar-sdk";
const server = new SorobanRpc.Server("https://soroban-testnet.stellar.org");
// ↑ This throws: "Access to fetch at 'https://soroban-testnet.stellar.org'
//   from origin 'http://localhost:5173' has been blocked by CORS policy"

// AFTER: src/api.js — calls our FastAPI backend instead
const response = await fetch("http://localhost:8000/vault-info");
// ↑ This works: same-origin-ish call to our own server, no CORS issue
```

---

### Bug 1.5 — BigInt type mismatch in nativeToScVal

**File**: `src/api.js` (and removed from `src/stellar.js`)

**Why it fixes it**: By moving transaction building to the Python backend, the JS frontend
never calls `nativeToScVal` at all. The Python `stellar-sdk` handles the `i128` conversion
correctly from a plain Python `int`. In the frontend, amounts are sent as JSON numbers.

```javascript
// BEFORE: src/stellar.js — BigInt passed to nativeToScVal (throws in SDK v12)
const amountStroops = BigInt(amount * 10_000_000);
// nativeToScVal(amountStroops, { type: "i128" })
// ↑ TypeError: Cannot convert a BigInt value to a number

// AFTER: src/api.js — plain number sent to FastAPI as JSON
const amountStroops = Math.round(amount * 10_000_000);  // plain number
await fetch("/withdraw", {
  body: JSON.stringify({ amount: amountStroops })  // JSON number, not BigInt
  // JSON.stringify(BigInt) would throw anyway — another reason to avoid BigInt here
});
// FastAPI receives it as Python int, stellar-sdk converts to i128 correctly
```

---

### Bug 1.6 — Dead AI/ML code references

**Files**: All files containing references to `spendClassifier`, `healthGrader`,
`classifySpend`, `financialHealth`, or similar AI/ML identifiers.

**Why it fixes it**: Remove the dead code entirely. No stubs, no comments, no imports.

```javascript
// BEFORE: src/stellar.js (example dead code block)
// TODO: integrate with spendClassifier.predict(amount, category)
// const healthScore = financialHealthGrader.grade(withdrawalHistory);
// These functions don't exist — they were from the AI-assisted version

// AFTER: those lines are deleted entirely
// No reference to AI/ML anywhere in the codebase
```

---

### Bug 1.7 — No backend for structured error handling

**Files**: `backend/main.py` (new), all React components updated to use `api.js`

**Why it fixes it**: FastAPI's exception handlers catch all errors and return consistent
`{ "error": "..." }` JSON. React components read `err.message` from the thrown error and
display it in the UI.

```python
# BEFORE: no backend — React catches raw SDK errors
# try { await contract.initialize(...) } catch(e) { console.log(e) }
# User sees nothing, developer sees a 500-line stack trace in the console

# AFTER: backend/main.py — structured error responses
@app.post("/initialize")
async def initialize_vault(body: InitializeRequest):
    try:
        tx_hash = await client.invoke_contract("initialize", [...])
        return {"transaction_hash": tx_hash}
    except Exception as e:
        # Contract errors (already initialized, invalid address, etc.)
        # are caught here and returned as clean JSON with HTTP 400.
        raise HTTPException(
            status_code=400,
            detail={"error": str(e)}  # e.g., "Vault already initialized"
        )
```

```jsx
// AFTER: React component displays the error message from FastAPI
try {
  const result = await initializeVault(student, token, limit);
  setSuccess(`Vault initialized! TX: ${result.transaction_hash}`);
} catch (err) {
  // err.message is the "error" string from FastAPI's JSON response
  setError(err.message);  // e.g., "Vault already initialized"
}
```

---

## Data Flow Diagrams

### Dashboard Load Flow

```
1. VaultDashboard mounts (useEffect runs)
   │
   ▼
2. api.js: fetch("http://localhost:8000/vault-info")
   │  [HTTP GET, no body]
   │
   ▼
3. FastAPI: GET /vault-info handler runs
   │
   ▼
4. stellar_client.py: build simulation transaction for get_vault_info()
   │  [XDR transaction envelope, no signing needed for view calls]
   │
   ▼
5. Stellar RPC: simulate_transaction(tx)
   │  [runs contract code on-chain, returns result without writing]
   │
   ▼
6. Soroban Contract: get_vault_info() reads instance storage
   │  returns (student_address, daily_limit, last_withdrawal, balance)
   │
   ▼
7. stellar_client.py: parse ScVal XDR → Python dict
   │
   ▼
8. FastAPI: return VaultInfoResponse JSON
   │  { student_address, daily_limit, last_withdrawal_timestamp, current_balance }
   │
   ▼
9. api.js: response.json() → JavaScript object
   │
   ▼
10. VaultDashboard: setVaultInfo(data) → React re-renders with balance/limit/timer
```

### Withdrawal Flow

```
1. Student types amount (e.g., "5.00 USDC") and clicks Withdraw
   │
   ▼
2. WithdrawForm: convert to stroops → Math.round(5.00 * 10_000_000) = 50_000_000
   │
   ▼
3. api.js: fetch("http://localhost:8000/withdraw", { method: "POST",
   │        body: { student_address: "GABC...", amount: 50000000 } })
   │
   ▼
4. FastAPI: POST /withdraw validates body (Pydantic)
   │  → amount > 0 ✓, student_address is a string ✓
   │
   ▼
5. stellar_client.py: load source account (get sequence number)
   │
   ▼
6. stellar_client.py: build transaction (invoke withdraw(student, 50000000))
   │
   ▼
7. Stellar RPC: prepare_transaction (simulate + apply footprint + fee)
   │  → if contract would reject (cooldown, limit), error returned HERE
   │  → if simulation passes, returns prepared XDR with fee set
   │
   ▼
8. stellar_client.py: sign with admin keypair (pays gas)
   │  [student's auth is handled by require_auth() — Freighter signs in browser
   │   for the student's portion; admin signs for the fee payment]
   │
   ▼
9. Stellar RPC: send_transaction(signed_tx)
   │
   ▼
10. Stellar RPC: poll get_transaction(hash) until SUCCESS or FAILED
    │
    ▼
11. Soroban Contract: withdraw() executes on-chain
    │  → checks require_auth(student) ✓
    │  → checks amount <= daily_limit ✓
    │  → checks cooldown elapsed ✓
    │  → updates LAST_WITH and BALANCE in storage
    │  → calls token.transfer(contract_addr, student, amount)
    │
    ▼
12. FastAPI: return { transaction_hash: "abc...", status: "success" }
    │
    ▼
13. api.js: response.json() → { transaction_hash, status }
    │
    ▼
14. WithdrawForm: setTxHash(result.transaction_hash) → UI shows "Success! TX: abc..."
    │
    ▼
15. VaultDashboard: re-fetches GET /vault-info to show updated balance
```

---

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that
demonstrate each bug on the unfixed code, then verify the fix works correctly and preserves
existing contract behavior.

### Exploratory Fault Condition Checking

**Goal**: Confirm each bug is reproducible before fixing it. This prevents "fixing" something
that wasn't actually broken and ensures we understand the root cause.

**Test Cases**:
1. **Boot Test**: Run `npm run dev` without `src/main.jsx` → confirm crash (bug 1.1)
2. **Build Test**: Run `npm run build` without `buffer` in `package.json` → confirm build error (bug 1.2)
3. **Env Test**: Load app with malformed `.env` → confirm `import.meta.env.VITE_CONTRACT_ID === undefined` (bug 1.3)
4. **CORS Test**: Call Stellar RPC directly from browser fetch → confirm CORS error in console (bug 1.4)
5. **BigInt Test**: Call `nativeToScVal(BigInt(5000000), { type: "i128" })` in browser console → confirm TypeError (bug 1.5)
6. **Dead Code Test**: Grep codebase for `spendClassifier` → confirm references exist (bug 1.6)
7. **Error Test**: Call `POST /initialize` with no backend → confirm unhandled error in UI (bug 1.7)

**Expected Counterexamples**:
- `npm run dev` exits with "Cannot find module '/src/main.jsx'"
- `npm run build` exits with "Cannot resolve 'buffer'"
- `console.log(import.meta.env.VITE_CONTRACT_ID)` prints `undefined`
- Browser console shows `Access-Control-Allow-Origin` CORS error
- `nativeToScVal` throws `TypeError: Cannot convert a BigInt value to a number`

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed system produces
the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := fixedSystem(input)
  ASSERT expectedBehavior(result)
END FOR

-- Concretely:
ASSERT npm_run_dev() succeeds after creating src/main.jsx
ASSERT npm_run_build() succeeds after adding buffer to package.json
ASSERT import.meta.env.VITE_CONTRACT_ID == "CBKFO3..." after fixing .env
ASSERT GET /vault-info returns JSON (not CORS error) after adding FastAPI proxy
ASSERT POST /withdraw with amount=50000000 succeeds (no BigInt error)
ASSERT grep(codebase, "spendClassifier") returns no results
ASSERT POST /initialize returns { error: "..." } JSON on failure
```

### Preservation Checking

**Goal**: Verify that the Soroban contract's existing behavior is unchanged.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT contract_original(input) == contract_fixed(input)
END FOR

-- Concretely (contract behavior must not change):
ASSERT withdraw(amount > daily_limit) PANICS "exceeds daily limit"
ASSERT withdraw(before 24h cooldown) PANICS "withdrawal too soon"
ASSERT withdraw(unauthorized caller) FAILS require_auth
ASSERT withdraw(valid amount, after cooldown) SUCCEEDS and updates LAST_WITH
ASSERT get_vault_info() returns non-negative balance
ASSERT initialize(valid args) stores all values in instance storage
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain
- It catches edge cases (e.g., amount = daily_limit exactly, timestamp = last_with + 86400 exactly)
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs

### Unit Tests

- Test `src/main.jsx` renders `<App />` into `#root` without errors
- Test `api.js` `getVaultInfo()` calls the correct URL and parses the response
- Test `api.js` `withdraw()` sends `amount` as a number (not BigInt) in the JSON body
- Test FastAPI `/vault-info` returns correct JSON shape
- Test FastAPI `/initialize` returns HTTP 422 when `daily_limit` is missing
- Test FastAPI `/withdraw` returns HTTP 400 when contract rejects (mocked)
- Test `stellar_client.py` `invoke_contract()` calls `prepare_transaction` before `send_transaction`

### Property-Based Tests

- **P1**: For any `amount > daily_limit`, `POST /withdraw` always returns HTTP 400 with
  an error containing "exceeds daily limit"
- **P2**: For any `timestamp < last_withdrawal + 86400`, `POST /withdraw` always returns
  HTTP 400 with an error containing "withdrawal too soon"
- **P3**: For any contract state, `GET /vault-info` always returns `current_balance >= 0`
- **P4**: For any `student_address != registered_student`, `POST /withdraw` always fails
  (contract rejects via `require_auth`)
- **P5**: For any contract state, `GET /vault-info` response matches the values stored in
  contract instance storage (no drift between backend cache and on-chain state)

### Integration Tests

- Full initialization flow: `POST /initialize` → `GET /vault-info` shows correct values
- Full withdrawal flow: `POST /withdraw` → `GET /vault-info` shows reduced balance
- Cooldown enforcement: two `POST /withdraw` calls in quick succession → second returns error
- Wallet connection: Freighter connect → public key displayed in UI
- Error display: backend returns `{ error: "..." }` → UI renders the message without crashing
