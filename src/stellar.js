/**
 * stellar.js
 * All BaonGuard contract interactions via the Stellar SDK.
 *
 * Setup:
 *   1. Deploy the contract:  soroban contract deploy …
 *   2. Copy the returned contract ID into VITE_CONTRACT_ID in .env.local
 *   3. Copy the USDC token contract ID into VITE_USDC_TOKEN
 *
 * .env.local:
 *   VITE_CONTRACT_ID=C...
 *   VITE_USDC_TOKEN=C...
 */

import * as StellarSdk from "@stellar/stellar-sdk";

// ── Network config ────────────────────────────────────────────────────────────

export const CONFIG = {
  CONTRACT_ID:       import.meta.env.VITE_CONTRACT_ID  || "YOUR_CONTRACT_ID",
  USDC_TOKEN:        import.meta.env.VITE_USDC_TOKEN   || "YOUR_USDC_TOKEN_ID",
  RPC_URL:           "https://soroban-testnet.stellar.org",
  HORIZON_URL:       "https://horizon-testnet.stellar.org",
  NETWORK_PASSPHRASE: StellarSdk.Networks.TESTNET,
  MAX_FEE:           "1000000", // 0.1 XLM — comfortable ceiling for Soroban
};

// USDC on Stellar uses 7 decimal places (1 USDC = 10_000_000 stroops)
export const STROOP   = 10_000_000;
export const PHP_RATE = 58; // approx ₱ per 1 USDC — update as needed

export const stroopsToUsdc = (s) => Number(s) / STROOP;
export const usdcToStroops = (u) => BigInt(Math.round(u * STROOP));
export const usdcToPhp     = (u) => (u * PHP_RATE).toFixed(2);

// ── Freighter wallet ──────────────────────────────────────────────────────────

/** Returns the connected public key, or throws if Freighter isn't installed. */
export async function connectFreighter() {
  if (!window.freighter) {
    throw new Error(
      "Freighter wallet not found. " +
      "Install the Freighter browser extension from https://www.freighter.app"
    );
  }

  // Freighter v4+ exposes requestAccess(); older versions don't need it.
  await window.freighter.requestAccess?.();

  try {
    // Freighter >= 4.0 new API
    const { address } = await window.freighter.getAddress();
    return address;
  } catch {
    // Freighter < 4.0 legacy API
    return await window.freighter.getPublicKey();
  }
}

/** Sign a prepared transaction XDR with Freighter. Returns signed XDR string. */
async function freighterSign(xdr) {
  try {
    // New API (object argument)
    const { signedTxXdr } = await window.freighter.signTransaction({
      xdr,
      networkPassphrase: CONFIG.NETWORK_PASSPHRASE,
      network: "TESTNET",
    });
    return signedTxXdr;
  } catch {
    // Legacy API (string argument)
    return await window.freighter.signTransaction(xdr, {
      networkPassphrase: CONFIG.NETWORK_PASSPHRASE,
    });
  }
}

// ── Core transaction pipeline ─────────────────────────────────────────────────

/**
 * Build → prepareTransaction (fee bump + auth) → sign → send → poll.
 * Returns the confirmed transaction hash.
 */
async function buildAndSubmit(operation, publicKey) {
  const server  = new StellarSdk.SorobanRpc.Server(CONFIG.RPC_URL);
  const account = await server.getAccount(publicKey);

  const raw = new StellarSdk.TransactionBuilder(account, {
    fee: CONFIG.MAX_FEE,
    networkPassphrase: CONFIG.NETWORK_PASSPHRASE,
  })
    .addOperation(operation)
    .setTimeout(30)
    .build();

  // prepareTransaction adds the footprint (ledger access list) & simulates fees
  const prepared = await server.prepareTransaction(raw);

  const signedXdr = await freighterSign(prepared.toXDR());
  const signedTx  = StellarSdk.TransactionBuilder.fromXDR(
    signedXdr,
    CONFIG.NETWORK_PASSPHRASE
  );

  const sent = await server.sendTransaction(signedTx);
  if (sent.status === "ERROR") {
    throw new Error(sent.errorResult?.toString() ?? "Transaction submission failed");
  }

  // Poll until the transaction is finalised (usually 1–3 ledgers ≈ 5–15 s)
  let finalResult;
  do {
    await new Promise((r) => setTimeout(r, 2000));
    finalResult = await server.getTransaction(sent.hash);
  } while (finalResult.status === StellarSdk.SorobanRpc.Api.GetTransactionStatus.NOT_FOUND);

  if (finalResult.status !== StellarSdk.SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error("Transaction failed on-chain");
  }

  return sent.hash;
}

// ── Contract functions ────────────────────────────────────────────────────────

/**
 * Read the vault state with a simulated transaction (no gas, no signature).
 * Returns { student, dailyLimit, lastWithdrawal, balance } with human-readable values.
 */
export async function getVaultInfo(publicKey) {
  const server   = new StellarSdk.SorobanRpc.Server(CONFIG.RPC_URL);
  const contract = new StellarSdk.Contract(CONFIG.CONTRACT_ID);
  const account  = await server.getAccount(publicKey);

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: CONFIG.NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("get_vault_info"))
    .setTimeout(30)
    .build();

  const result = await server.simulateTransaction(tx);

  if (StellarSdk.SorobanRpc.Api.isSimulationError(result)) {
    throw new Error(result.error);
  }

  // scValToNative converts the Soroban struct to a plain JS object
  const raw = StellarSdk.scValToNative(result.result.retval);

  return {
    student:         raw.student.toString(),
    dailyLimit:      Number(raw.daily_limit),       // in stroops
    lastWithdrawal:  Number(raw.last_withdrawal_timestamp), // unix seconds
    balance:         Number(raw.current_balance),   // in stroops
  };
}

/**
 * Parent: deploy the vault rules once.
 * `dailyLimitUsdc` — human-friendly USDC amount, e.g. 0.20 for ₱11.60
 */
export async function initializeVault(publicKey, studentAddress, dailyLimitUsdc) {
  const contract = new StellarSdk.Contract(CONFIG.CONTRACT_ID);
  const limitStroops = usdcToStroops(dailyLimitUsdc);

  const op = contract.call(
    "initialize",
    StellarSdk.nativeToScVal(studentAddress,      { type: "address" }),
    StellarSdk.nativeToScVal(CONFIG.USDC_TOKEN,   { type: "address" }),
    StellarSdk.nativeToScVal(limitStroops,        { type: "i128"    })
  );

  return buildAndSubmit(op, publicKey);
}

/**
 * Parent: transfer USDC from their wallet into the contract.
 * Uses the USDC token contract's `transfer` function directly.
 */
export async function depositToVault(publicKey, amountUsdc) {
  const token = new StellarSdk.Contract(CONFIG.USDC_TOKEN);
  const amountStroops = usdcToStroops(amountUsdc);

  const op = token.call(
    "transfer",
    StellarSdk.nativeToScVal(publicKey,          { type: "address" }),
    StellarSdk.nativeToScVal(CONFIG.CONTRACT_ID, { type: "address" }),
    StellarSdk.nativeToScVal(amountStroops,      { type: "i128"    })
  );

  return buildAndSubmit(op, publicKey);
}

/**
 * Student: pull today's allowance out of the vault.
 * The contract will reject if < 24 h have elapsed or amount > daily_limit.
 */
export async function withdrawFromVault(publicKey, amountUsdc) {
  const contract     = new StellarSdk.Contract(CONFIG.CONTRACT_ID);
  const amountStroops = usdcToStroops(amountUsdc);

  const op = contract.call(
    "withdraw",
    StellarSdk.nativeToScVal(amountStroops, { type: "i128" })
  );

  return buildAndSubmit(op, publicKey);
}