# BaonGuard Rebuild — Implementation Tasks

## Overview

Tasks are ordered so each one builds on the previous. Complete them in sequence.
Bug fixes come first (tasks 1–7), then the backend (8–10), then the frontend (11–16),
then testing (17–19).

- `[ ]` = not started
- `[-]` = in progress
- `[x]` = complete
- Tasks marked with `*` are optional

---

## Phase 1: Confirm the Bugs (Exploration)

- [x] 1. Write bug condition exploration tests
  - [x] 1.1 Confirm Bug 1.1: verify `src/main.jsx` does not exist and `npm run dev` fails
  - [x] 1.2 Confirm Bug 1.2: verify `buffer` is missing from `package.json` and `npm run build` fails
  - [x] 1.3 Confirm Bug 1.3: verify `.env` has no `KEY=VALUE` format and `VITE_CONTRACT_ID` is undefined
  - [x] 1.4 Confirm Bug 1.4: verify no FastAPI backend exists and direct RPC calls would hit CORS
  - [x] 1.5 Confirm Bug 1.5: verify `stellar.js` uses `BigInt` with `nativeToScVal` type `"i128"`
  - [x] 1.6 Confirm Bug 1.6: verify AI/ML references exist in the codebase (`spendClassifier`, `healthGrader`)
  - [x] 1.7 Confirm Bug 1.7: verify no structured error handling exists in the React components

---

## Phase 2: Fix the Bugs

- [x] 2. Fix Bug 1.1 — Create `src/main.jsx` (React entry point)
  - [x] 2.1 Create `src/main.jsx` that imports React, ReactDOM, and `App.jsx`
  - [x] 2.2 Mount `<App />` into `document.getElementById("root")` using `ReactDOM.createRoot`
  - [x] 2.3 Wrap in `<React.StrictMode>`
  - [x] 2.4 Verify `npm run dev` starts without "Cannot find module" error

- [x] 3. Fix Bug 1.2 — Add `buffer` polyfill dependency
  - [x] 3.1 Add `"buffer": "^6.0.3"` to `dependencies` in `package.json`
  - [x] 3.2 Verify `vite.config.js` has `resolve.alias: { buffer: "buffer/" }` and `define: { global: {} }`
  - [x] 3.3 Run `npm install` and verify `npm run build` succeeds

- [x] 4. Fix Bug 1.3 — Fix `.env` format
  - [x] 4.1 Replace the raw contract address in `.env` with `VITE_CONTRACT_ID=CBKFO3VGYBLNNS3VDTDOUXV2SIZCVVJLCSZFU5GIJWTO2O7E5PQDPY2E`
  - [x] 4.2 Add `VITE_API_URL=http://localhost:8000` to `.env`
  - [x] 4.3 Verify `import.meta.env.VITE_CONTRACT_ID` resolves correctly in the browser

- [x] 5. Fix Bug 1.6 — Remove all AI/ML dead code
  - [x] 5.1 Search codebase for `spendClassifier`, `healthGrader`, `classifySpend`, `financialHealth`
  - [x] 5.2 Delete all references, comments, and imports related to AI/ML features
  - [x] 5.3 Verify no AI/ML references remain with a grep check

---

## Phase 3: Build the FastAPI Backend (Fixes Bugs 1.4 and 1.7)

- [x] 6. Set up the backend project structure
  - [x] 6.1 Create `backend/` directory
  - [x] 6.2 Create `backend/requirements.txt` with: `fastapi`, `uvicorn`, `stellar-sdk`, `python-dotenv`, `pydantic`
  - [x] 6.3 Create `backend/.env` with `CONTRACT_ID`, `STELLAR_RPC_URL`, `NETWORK_PASSPHRASE`, `ADMIN_SECRET_KEY`
  - [x] 6.4 Add `backend/.env` to `.gitignore`

- [x] 7. Create `backend/stellar_client.py` — Stellar SDK wrapper
  - [x] 7.1 Implement `StellarClient.__init__` loading config from env vars
  - [x] 7.2 Implement `call_contract_view(function_name, args)` for read-only simulation calls
  - [x] 7.3 Implement `invoke_contract(function_name, args)` with the full build→simulate→prepare→sign→submit→poll lifecycle
  - [x] 7.4 Implement `_parse_result(xdr)` to convert ScVal XDR back to Python types
  - [x] 7.5 Add logging for each RPC call and response status

- [-] 8. Create `backend/main.py` — FastAPI app
  - [ ] 8.1 Initialize FastAPI app with CORS middleware (allow only `http://localhost:5173`)
  - [x] 8.2 Define Pydantic models: `InitializeRequest`, `WithdrawRequest`, `VaultInfoResponse`, `ErrorResponse`
  - [x] 8.3 Implement `GET /vault-info` — calls `stellar_client.call_contract_view("get_vault_info")`
  - [x] 8.4 Implement `POST /initialize` — validates body, calls `stellar_client.invoke_contract("initialize")`
  - [x] 8.5 Implement `POST /withdraw` — validates body, calls `stellar_client.invoke_contract("withdraw")`
  - [x] 8.6 Add global exception handler that returns `{ "error": "..." }` JSON for all unhandled errors
  - [-] 8.7 Verify FastAPI starts with `uvicorn backend.main:app --reload` and `/docs` loads

---

## Phase 4: Build the React Frontend (Fixes Bug 1.5)

- [~] 9. Create `src/wallet.js` — Freighter wallet integration
  - [~] 9.1 Implement `connectWallet()` using `@stellar/freighter-api` `isConnected` and `getPublicKey`
  - [~] 9.2 Implement `signTx(transactionXDR, networkPassphrase)` using `signTransaction`
  - [~] 9.3 Handle the "Freighter not installed" case with a clear error message
  - [~] 9.4 Export `disconnectWallet()` that clears the stored public key

- [~] 10. Create `src/api.js` — FastAPI fetch wrapper (fixes Bug 1.5)
  - [~] 10.1 Read `VITE_API_URL` from `import.meta.env`
  - [~] 10.2 Implement `getVaultInfo()` — `GET /vault-info`, returns parsed JSON
  - [~] 10.3 Implement `initializeVault(studentAddress, tokenAddress, dailyLimit)` — `POST /initialize`
  - [~] 10.4 Implement `withdraw(studentAddress, amount)` — `POST /withdraw`, sends `amount` as `Number` (not BigInt)
  - [~] 10.5 All functions throw `Error(err.detail.error)` on non-OK responses

- [~] 11. Create `src/components/VaultDashboard.jsx`
  - [~] 11.1 On mount, call `getVaultInfo()` from `api.js`
  - [~] 11.2 Display current balance in USDC (divide stroops by 10,000,000)
  - [~] 11.3 Display daily limit in USDC
  - [~] 11.4 Calculate and display time remaining until next withdrawal (or "Available now")
  - [~] 11.5 Show loading state while fetching, error state if fetch fails

- [~] 12. Create `src/components/WithdrawForm.jsx`
  - [~] 12.1 Input field for USDC amount
  - [~] 12.2 On submit: convert USDC to stroops with `Math.round(amount * 10_000_000)`
  - [~] 12.3 Call `withdraw(walletAddress, amountStroops)` from `api.js`
  - [~] 12.4 Display transaction hash on success
  - [~] 12.5 Display error message from FastAPI on failure (cooldown, limit exceeded, etc.)

- [~] 13. Create `src/components/InitializeForm.jsx`
  - [~] 13.1 Input fields for student address, token address, daily limit (USDC)
  - [~] 13.2 Convert daily limit to stroops before sending
  - [~] 13.3 Call `initializeVault(...)` from `api.js`
  - [~] 13.4 Display success confirmation with transaction hash
  - [~] 13.5 Display error message on failure (already initialized, invalid address, etc.)

- [~] 14. Update `src/App.jsx` — wire everything together
  - [~] 14.1 Manage `walletAddress` state (null = not connected)
  - [~] 14.2 Render "Connect Wallet" button when not connected, calling `connectWallet()`
  - [~] 14.3 Render `VaultDashboard`, `WithdrawForm`, and `InitializeForm` when connected
  - [~] 14.4 Pass `walletAddress` as prop to child components that need it
  - [~] 14.5 Handle wallet disconnect — clear state and return to unauthenticated view

---

## Phase 5: Testing

- [~] 15. Write fix-checking tests — verify all 7 bugs are resolved
  - [~] 15.1 `src/main.jsx` exists and renders `<App />` without errors
  - [~] 15.2 `npm run build` completes successfully (buffer polyfill resolves)
  - [~] 15.3 `import.meta.env.VITE_CONTRACT_ID` equals the correct contract address
  - [~] 15.4 `GET /vault-info` returns JSON (not a CORS error)
  - [~] 15.5 `POST /withdraw` with `amount: 50000000` (Number) succeeds without TypeError
  - [~] 15.6 Grep for `spendClassifier` returns zero results
  - [~] 15.7 `POST /initialize` with missing field returns HTTP 422 with `{ "error": "..." }`

- [~] 16. Write preservation tests — verify contract behavior is unchanged
  - [~] 16.1 `withdraw(amount > daily_limit)` returns HTTP 400 with "exceeds daily limit"
  - [~] 16.2 `withdraw(before 24h cooldown)` returns HTTP 400 with "withdrawal too soon"
  - [~] 16.3 `withdraw(unauthorized caller)` fails auth check
  - [~] 16.4 `withdraw(valid amount, after cooldown)` succeeds and returns transaction hash
  - [~] 16.5 `get_vault_info()` returns non-negative `current_balance`
  - [~] 16.6 First withdrawal (last_withdrawal_timestamp = 0) is allowed immediately

- [~] 17. Write property-based tests for the 5 correctness properties
  - [~] 17.1 P1: For any `amount > daily_limit`, `POST /withdraw` always returns HTTP 400
  - [~] 17.2 P2: For any `timestamp < last_withdrawal + 86400`, `POST /withdraw` always returns HTTP 400
  - [~] 17.3 P3: For any contract state, `GET /vault-info` always returns `current_balance >= 0`
  - [~] 17.4 P4: For any `student_address != registered_student`, `POST /withdraw` always fails
  - [~] 17.5 P5: `GET /vault-info` response always matches on-chain contract storage values

---

## Phase 6: Final Verification

- [~] 18. End-to-end smoke test
  - [~] 18.1 Start FastAPI backend: `uvicorn backend.main:app --reload`
  - [~] 18.2 Start React frontend: `npm run dev`
  - [~] 18.3 Connect Freighter wallet in the browser
  - [~] 18.4 Load vault dashboard — verify balance, limit, and cooldown display correctly
  - [~] 18.5 Attempt a withdrawal — verify transaction hash appears or correct error is shown
  - [~] 18.6 Verify no console errors in the browser and no unhandled exceptions in FastAPI logs
