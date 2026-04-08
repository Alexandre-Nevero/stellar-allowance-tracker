# Bugfix Requirements Document

## Introduction

BaonGuard is a Soroban timelock vault on Stellar Testnet that releases a student's daily allowance in controlled installments. The app was previously built with AI assistance and is currently non-functional. The rebuild removes all off-chain AI/ML features (spend classifier, financial health grader) and replaces the current broken frontend-only architecture with a clean three-tier stack: Soroban contract (Rust) + FastAPI backend (Python) + React frontend.

The bugs span three layers: the React app cannot boot at all (missing entry point), the Vite build is misconfigured for the Stellar SDK's Node.js dependencies, the `.env` file is malformed so no environment variables are injected, and the overall architecture has no backend — meaning the frontend tries to call the Stellar RPC directly from the browser, which causes CORS failures and exposes the integration complexity to the client. The AI feature code is entangled throughout, adding dead weight that makes the codebase harder to reason about.

---

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the user runs `npm run dev` THEN the application fails to start because `src/main.jsx` does not exist and `index.html` references it as the module entry point.

1.2 WHEN Vite attempts to bundle `@stellar/stellar-sdk` THEN the build fails because the `buffer` polyfill alias in `vite.config.js` references the `buffer` package which is not listed in `package.json` dependencies.

1.3 WHEN the React app loads in the browser THEN `import.meta.env.VITE_CONTRACT_ID` resolves to `undefined` because `.env` contains only the raw contract address string with no variable name (`CBKFO3VGYBLNNS3VDTDOUXV2SIZCVVJLCSZFU5GIJWTO2O7E5PQDPY2E`) instead of a proper `KEY=VALUE` assignment.

1.4 WHEN `getVaultInfo` or any contract call is made directly from the browser THEN the Stellar RPC endpoint returns a CORS error because browser-originated requests to `https://soroban-testnet.stellar.org` are blocked without a server-side proxy.

1.5 WHEN the student connects Freighter and calls `withdraw` THEN the transaction simulation fails because `stellar.js` passes `amountStroops` as a `BigInt` to `nativeToScVal` with type `"i128"` but the SDK expects a `number` or `string` for that conversion path in v12.

1.6 WHEN the application is running THEN dead code paths for the off-chain AI spend classifier and financial health grader are referenced in comments and README, creating confusion about which parts of the codebase are active and which are not.

1.7 WHEN the parent attempts to initialize the vault THEN the call may fail silently because there is no FastAPI backend to validate inputs, proxy the RPC call, or return structured error responses — all error handling is ad-hoc in the React component.

### Expected Behavior (Correct)

2.1 WHEN the user runs `npm run dev` THEN the application SHALL start successfully because `src/main.jsx` exists and correctly mounts the React app into `#root`.

2.2 WHEN Vite bundles the project THEN the build SHALL succeed because `buffer` is listed as a dependency in `package.json` and the polyfill is correctly resolved.

2.3 WHEN the React app loads THEN `import.meta.env.VITE_CONTRACT_ID` SHALL resolve to `CBKFO3VGYBLNNS3VDTDOUXV2SIZCVVJLCSZFU5GIJWTO2O7E5PQDPY2E` because `.env` is formatted as `VITE_CONTRACT_ID=CBKFO3VGYBLNNS3VDTDOUXV2SIZCVVJLCSZFU5GIJWTO2O7E5PQDPY2E`.

2.4 WHEN the frontend needs vault data or submits a transaction THEN the request SHALL be routed through a FastAPI backend that proxies calls to the Stellar RPC, eliminating browser CORS restrictions.

2.5 WHEN the student submits a withdrawal THEN the FastAPI backend SHALL build and submit the Soroban transaction using `stellar-sdk` (Python), returning a structured JSON response with the transaction hash or a descriptive error.

2.6 WHEN the codebase is reviewed THEN there SHALL be no references to the AI spend classifier or financial health grader — all such code, comments, and configuration SHALL be removed.

2.7 WHEN any contract call fails THEN the FastAPI backend SHALL return a structured JSON error response with an HTTP status code and human-readable message, and the React frontend SHALL display it clearly to the user.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the parent calls `initialize` with a valid student address, USDC token address, and positive daily limit THEN the system SHALL CONTINUE TO store those values in the Soroban contract's instance storage exactly as the current `lib.rs` implements.

3.2 WHEN the student calls `withdraw` with an amount within the daily limit and after the 24-hour cooldown THEN the system SHALL CONTINUE TO transfer USDC from the contract to the student wallet and update `LAST_WITH` in contract storage.

3.3 WHEN the student calls `withdraw` before 24 hours have elapsed since the last withdrawal THEN the system SHALL CONTINUE TO reject the transaction with the "withdrawal too soon" panic from the contract.

3.4 WHEN the student calls `withdraw` with an amount exceeding the daily limit THEN the system SHALL CONTINUE TO reject the transaction with the "exceeds daily limit" panic from the contract.

3.5 WHEN a wallet other than the registered student address calls `withdraw` THEN the system SHALL CONTINUE TO reject the transaction via `require_auth()` in the contract.

3.6 WHEN `get_vault_info` is called THEN the system SHALL CONTINUE TO return the student address, daily limit in stroops, last withdrawal timestamp in Unix seconds, and current USDC balance in stroops.

3.7 WHEN the vault has never had a withdrawal (last_withdrawal_timestamp = 0) THEN the system SHALL CONTINUE TO allow the first withdrawal immediately without enforcing the 24-hour cooldown.

---

## Feature Requirements

### Parent Features

**FR-P1: Vault Initialization**
As a parent, I want to initialize the vault so that I can set up a controlled allowance for my student.

Acceptance Criteria:
- Given I provide a valid student wallet address, USDC token contract address, and a positive daily limit in stroops, when I submit the initialize form, then the vault is initialized via the Soroban contract and I receive a success confirmation.
- Given I omit any required field, when I submit the form, then the system returns a validation error before making any contract call.
- Given the vault is already initialized, when I attempt to initialize again, then the system returns an appropriate error message.

**FR-P2: USDC Deposit**
As a parent, I want to deposit USDC into the vault so that funds are available for the student to withdraw.

Acceptance Criteria:
- Given I have USDC in my wallet and the vault is initialized, when I deposit an amount, then the USDC is transferred to the vault contract and the balance is updated.
- Given the deposit transaction fails, when the error is returned, then the frontend displays a human-readable error message.

---

### Student Features

**FR-S1: Vault Dashboard**
As a student, I want to view my vault dashboard so that I know my current balance, daily limit, and when I can next withdraw.

Acceptance Criteria:
- Given the vault is initialized, when I load the dashboard, then I see the current USDC balance, daily limit in stroops, and the time remaining until the next withdrawal is available.
- Given the vault has never had a withdrawal, when I load the dashboard, then the "time until next withdrawal" shows as available immediately.
- Given the backend is unreachable, when the dashboard loads, then an error state is shown rather than blank or stale data.

**FR-S2: Withdrawal**
As a student, I want to withdraw up to my daily limit once every 24 hours so that I can access my allowance.

Acceptance Criteria:
- Given I am authenticated with Freighter and 24 hours have passed since my last withdrawal, when I request a withdrawal within the daily limit, then the transaction is submitted and I receive the transaction hash.
- Given I request a withdrawal before 24 hours have elapsed, when the transaction is submitted, then the system returns a clear error indicating the cooldown period has not passed.
- Given I request an amount exceeding the daily limit, when the transaction is submitted, then the system returns a clear error indicating the limit has been exceeded.

**FR-S3: Freighter Wallet Authentication**
As a student, I want to connect my Freighter wallet so that I can authenticate and sign transactions.

Acceptance Criteria:
- Given Freighter is installed, when I click "Connect Wallet", then my public key is retrieved and displayed in the UI.
- Given Freighter is not installed, when I click "Connect Wallet", then the UI shows a message directing me to install the Freighter extension.
- Given I am connected, when I disconnect, then the session is cleared and the UI returns to the unauthenticated state.

---

### System / API Features (FastAPI Backend)

**FR-A1: GET /vault-info**
As a frontend client, I want to retrieve the current vault state so that the dashboard can display accurate information.

Acceptance Criteria:
- Given the vault is initialized, when GET /vault-info is called, then the response is a JSON object containing `student_address`, `daily_limit`, `last_withdrawal_timestamp`, and `current_balance`.
- Given the contract call fails, when GET /vault-info is called, then the endpoint returns an appropriate HTTP error status with a human-readable `error` field in the JSON body.

**FR-A2: POST /initialize**
As a frontend client, I want to proxy the vault initialization call through the backend so that the Soroban contract is invoked without CORS issues.

Acceptance Criteria:
- Given a valid request body with `student_address`, `token_address`, and `daily_limit`, when POST /initialize is called, then the backend submits the transaction to the Soroban contract and returns the transaction hash.
- Given invalid or missing fields, when POST /initialize is called, then the endpoint returns HTTP 422 with a descriptive validation error.

**FR-A3: POST /withdraw**
As a frontend client, I want to proxy the withdrawal call through the backend so that the transaction is built, simulated, and submitted server-side.

Acceptance Criteria:
- Given a valid request with `student_address` and `amount`, when POST /withdraw is called, then the backend builds, simulates, and submits the Soroban withdrawal transaction and returns the transaction hash.
- Given the simulation or submission fails, when POST /withdraw is called, then the endpoint returns an appropriate HTTP error status with a human-readable `error` field.
- Given the contract rejects the transaction (cooldown or limit exceeded), when POST /withdraw is called, then the error message from the contract is surfaced in the response body.

**FR-A4: Structured Error Responses**
As a frontend client, I want all API errors to follow a consistent format so that the UI can display them reliably.

Acceptance Criteria:
- Given any endpoint encounters an error, when the response is returned, then it includes an HTTP status code appropriate to the error type (400, 422, 500, etc.) and a JSON body with at least an `error` string field containing a human-readable message.

---

## Constraints

- The system must target Stellar Testnet (not Mainnet) for this build.
- Daily limit and 24-hour cooldown must be enforced exclusively by the Soroban contract; the backend must never duplicate or override this logic.
- The FastAPI backend must not store, log, or transmit any private keys or secret keys.
- The deployed contract address (`CBKFO3VGYBLNNS3VDTDOUXV2SIZCVVJLCSZFU5GIJWTO2O7E5PQDPY2E`) must be used as-is; no redeployment unless contract logic changes.
- All Stellar RPC calls must be proxied through the FastAPI backend — the React frontend must not call the Stellar RPC directly.
- The Soroban contract source (`lib.rs`) must not be modified unless a contract-level bug is identified.
- No AI, ML, or off-chain classification features may be added.

---

## Non-Functional Requirements

- Security: The backend must validate all inputs before forwarding to the Stellar RPC; no raw user input should reach the contract unvalidated.
- Security: CORS on the FastAPI backend must be configured to allow only the frontend origin.
- Reliability: The frontend must handle and display all error states (network failure, contract rejection, wallet not connected) without crashing.
- Maintainability: Each layer (contract, backend, frontend) must be independently runnable and testable.
- Environment: All secrets and configuration (contract ID, RPC URL, network passphrase) must be managed via environment variables, never hardcoded.
- Observability: The FastAPI backend must log each incoming request and the Stellar RPC response status for debugging purposes.

---

## Glossary

- Baon: Filipino term for allowance or packed lunch money given to students.
- Stroops: The smallest unit of a Stellar token (1 USDC = 10,000,000 stroops for a 7-decimal token).
- Soroban: Stellar's smart contract platform built on WebAssembly.
- Vault: The deployed Soroban contract instance that holds the student's USDC and enforces withdrawal rules.
- Daily Limit: The maximum amount in stroops the student may withdraw within any 24-hour window, set by the parent at initialization.
- Cooldown: The 24-hour period that must elapse between withdrawals, enforced by `env.ledger().timestamp()` in the contract.
- Freighter: A browser extension wallet for Stellar that allows users to sign transactions.
- SEP-41: A Stellar Ecosystem Proposal defining the standard token interface used by USDC on Stellar.
- Testnet: Stellar's public test network where contracts and transactions have no real monetary value.
- RPC: Remote Procedure Call — the HTTP interface used to interact with the Stellar network (`soroban-testnet.stellar.org`).
- XLM: Stellar's native currency, used to pay gas fees for all network transactions.
