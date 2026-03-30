/**
 * App.jsx
 * BaonGuard — Parent Dashboard + Student Wallet
 *
 * Views:
 *   landing      — role selector
 *   parent        — vault setup, deposit, vault status
 *   student       — vault info, countdown timer, withdraw
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  connectFreighter,
  getVaultInfo,
  initializeVault,
  depositToVault,
  withdrawFromVault,
  stroopsToUsdc,
  usdcToPhp,
  CONFIG,
} from "./stellar.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

const shortAddr = (addr) =>
  addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "—";

const copyToClipboard = (text) => navigator.clipboard?.writeText(text);

function useCountdown(lastWithdrawalTs) {
  const [msLeft, setMsLeft] = useState(0);

  useEffect(() => {
    if (!lastWithdrawalTs) return;
    const nextMs = (lastWithdrawalTs + 86_400) * 1000;
    const tick = () => setMsLeft(Math.max(0, nextMs - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lastWithdrawalTs]);

  const h = Math.floor(msLeft / 3_600_000);
  const m = Math.floor((msLeft % 3_600_000) / 60_000);
  const s = Math.floor((msLeft % 60_000) / 1_000);
  const canWithdraw = msLeft === 0 || lastWithdrawalTs === 0;
  const pctElapsed = lastWithdrawalTs === 0 ? 100
    : Math.min(100, ((Date.now() / 1000 - lastWithdrawalTs) / 86_400) * 100);

  return { h, m, s, canWithdraw, pctElapsed };
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Spinner({ light = false }) {
  return <span className={`spinner ${light ? "spinner-light" : ""}`} />;
}

function TxFeedback({ result, onDismiss }) {
  if (!result) return null;
  const isErr = result.type === "error";
  const isPending = result.type === "pending";
  return (
    <div className={`tx-box ${isPending ? "pending" : isErr ? "error" : "success"}`}>
      <span style={{ fontSize: "1.1rem", flexShrink: 0 }}>
        {isPending ? "⏳" : isErr ? "✗" : "✓"}
      </span>
      <div style={{ flex: 1 }}>
        <div>{result.message}</div>
        {result.hash && (
          <div className="tx-hash">
            <a
              href={`https://stellar.expert/explorer/testnet/tx/${result.hash}`}
              target="_blank"
              rel="noreferrer"
              style={{ color: "inherit" }}
            >
              {result.hash}
            </a>
          </div>
        )}
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          style={{ background: "none", border: "none", cursor: "pointer", color: "inherit", opacity: 0.6, fontSize: "1rem" }}
        >
          ✕
        </button>
      )}
    </div>
  );
}

function AddressPill({ address }) {
  const [copied, setCopied] = useState(false);
  const handle = async () => {
    await copyToClipboard(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <span className="address-pill" onClick={handle} title="Click to copy">
      {copied ? "✓ Copied!" : shortAddr(address)}
    </span>
  );
}

// ── Vault Hero card (shared) ──────────────────────────────────────────────────

function VaultHero({ vaultInfo }) {
  const usdc = stroopsToUsdc(vaultInfo.balance);
  const limitUsdc = stroopsToUsdc(vaultInfo.dailyLimit);
  const pctFull = Math.min(100, (usdc / (usdc + 1)) * 100); // visual only

  return (
    <div className="vault-hero animate-in">
      <div className="balance-label">Vault Balance</div>
      <div className="balance-usdc">{usdc.toFixed(7)} <span style={{ fontSize: "1.2rem", color: "#94a3b8" }}>USDC</span></div>
      <div className="balance-php">≈ ₱{usdcToPhp(usdc)}</div>

      <div className="progress-wrap" style={{ marginTop: "1.2rem" }}>
        <div className="progress-label">
          <span>Vault funds</span>
          <span>{usdc.toFixed(4)} / ∞ USDC</span>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${Math.min(95, usdc * 10)}%` }} />
        </div>
      </div>

      <div className="stat-row">
        <div className="stat">
          <span className="stat-label">Daily Limit</span>
          <span className="stat-value gold">{limitUsdc.toFixed(4)} USDC ≈ ₱{usdcToPhp(limitUsdc)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Student Wallet</span>
          <span className="stat-value"><AddressPill address={vaultInfo.student} /></span>
        </div>
        <div className="stat">
          <span className="stat-label">Last Withdrawal</span>
          <span className="stat-value">
            {vaultInfo.lastWithdrawal === 0
              ? "Never"
              : new Date(vaultInfo.lastWithdrawal * 1000).toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Countdown Timer ───────────────────────────────────────────────────────────

function CountdownTimer({ lastWithdrawal }) {
  const { h, m, s, canWithdraw, pctElapsed } = useCountdown(lastWithdrawal);

  return (
    <div className="timer-card animate-in">
      <div className="stat-label" style={{ marginBottom: "0.75rem" }}>Time Until Next Withdrawal</div>

      {canWithdraw ? (
        <div className="timer-ready">
          <span>✓</span> Ready to Withdraw!
        </div>
      ) : (
        <div className="timer-display">
          {[{ v: h, l: "HRS" }, { v: m, l: "MIN" }, { v: s, l: "SEC" }].map((u, i) => (
            <div key={u.l} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              {i > 0 && <span className="timer-sep">:</span>}
              <div className="timer-unit">
                <div className="timer-digits">{String(u.v).padStart(2, "0")}</div>
                <div className="timer-label-unit">{u.l}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="progress-wrap" style={{ marginTop: "1rem" }}>
        <div className="progress-label">
          <span>24-hour cooldown</span>
          <span>{pctElapsed.toFixed(0)}% elapsed</span>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${pctElapsed}%` }} />
        </div>
      </div>

      <div className="timer-subtext">
        {canWithdraw
          ? "The contract will approve your next withdrawal."
          : "The Soroban contract enforces this cooldown on-chain."}
      </div>
    </div>
  );
}

// ── Parent Dashboard ──────────────────────────────────────────────────────────

function ParentDashboard({ wallet, onVaultLoad }) {
  const [vaultInfo, setVaultInfo]     = useState(null);
  const [loading, setLoading]         = useState(false);
  const [txResult, setTxResult]       = useState(null);

  // Initialize form
  const [studentAddr, setStudentAddr] = useState("");
  const [dailyLimit, setDailyLimit]   = useState("0.20");

  // Deposit form
  const [depositAmt, setDepositAmt]   = useState("");

  const clearTx = () => setTxResult(null);

  const fetchVault = useCallback(async () => {
    try {
      setLoading(true);
      const info = await getVaultInfo(wallet);
      setVaultInfo(info);
      onVaultLoad?.(info);
    } catch (err) {
      setTxResult({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  }, [wallet, onVaultLoad]);

  const handleInitialize = async (e) => {
    e.preventDefault();
    clearTx();
    if (!studentAddr.trim()) return;
    try {
      setLoading(true);
      setTxResult({ type: "pending", message: "Submitting initialize transaction…" });
      const hash = await initializeVault(wallet, studentAddr.trim(), parseFloat(dailyLimit));
      setTxResult({ type: "success", message: "Vault initialized successfully!", hash });
      await fetchVault();
    } catch (err) {
      setTxResult({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  };

  const handleDeposit = async (e) => {
    e.preventDefault();
    clearTx();
    const amt = parseFloat(depositAmt);
    if (!amt || amt <= 0) return;
    try {
      setLoading(true);
      setTxResult({ type: "pending", message: `Depositing ${amt} USDC to vault…` });
      const hash = await depositToVault(wallet, amt);
      setTxResult({ type: "success", message: `Deposited ${amt} USDC — vault funded!`, hash });
      setDepositAmt("");
      await fetchVault();
    } catch (err) {
      setTxResult({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="animate-in" style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

      {/* Vault Status */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.4rem", fontWeight: 800 }}>
          Parent Dashboard
        </h2>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <AddressPill address={wallet} />
          <button className="btn btn-outline" onClick={fetchVault} disabled={loading}>
            {loading ? <Spinner light /> : "↻"} Refresh
          </button>
        </div>
      </div>

      {vaultInfo ? (
        <VaultHero vaultInfo={vaultInfo} />
      ) : (
        <div className="card" style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)" }}>
          <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🔒</div>
          <div>No vault found yet. Initialize one below, then click Refresh.</div>
        </div>
      )}

      <TxFeedback result={txResult} onDismiss={clearTx} />

      <div className="card-grid">
        {/* Initialize */}
        <div className="card">
          <div className="card-title">⚙️ Initialize Vault</div>
          <form onSubmit={handleInitialize}>
            <div className="form-group">
              <label className="form-label">Student Wallet Address</label>
              <input
                className="form-input"
                placeholder="G…"
                value={studentAddr}
                onChange={(e) => setStudentAddr(e.target.value)}
                required
                disabled={loading}
              />
              <div className="form-hint">Stellar public key of the student's wallet</div>
            </div>
            <div className="form-group">
              <label className="form-label">Daily Limit (USDC)</label>
              <div className="form-input-prefix">
                <span className="form-prefix">$</span>
                <input
                  className="form-input"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={dailyLimit}
                  onChange={(e) => setDailyLimit(e.target.value)}
                  disabled={loading}
                />
              </div>
              <div className="form-hint">
                ≈ ₱{usdcToPhp(parseFloat(dailyLimit) || 0)} per day · stored as {Math.round((parseFloat(dailyLimit) || 0) * 10_000_000).toLocaleString()} stroops
              </div>
            </div>
            <button className="btn btn-primary btn-full btn-lg" type="submit" disabled={loading}>
              {loading ? <><Spinner /> Initializing…</> : "🚀 Initialize on Testnet"}
            </button>
          </form>
        </div>

        {/* Deposit */}
        <div className="card">
          <div className="card-title">💰 Deposit USDC</div>
          <form onSubmit={handleDeposit}>
            <div className="form-group">
              <label className="form-label">Amount (USDC)</label>
              <div className="form-input-prefix">
                <span className="form-prefix">$</span>
                <input
                  className="form-input"
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder="e.g. 1.40 for a week's baon"
                  value={depositAmt}
                  onChange={(e) => setDepositAmt(e.target.value)}
                  disabled={loading}
                />
              </div>
              <div className="form-hint">
                {depositAmt ? `≈ ₱${usdcToPhp(parseFloat(depositAmt) || 0)} · ${((parseFloat(depositAmt)||0) / 0.20).toFixed(1)} days of baon` : "Transfers USDC from your wallet to the vault contract"}
              </div>
            </div>

            <div style={{ background: "var(--gold-dim)", border: "1px solid var(--gold-border)", borderRadius: "var(--radius-sm)", padding: "0.75rem 1rem", fontSize: "0.82rem", color: "var(--text-dim)", marginBottom: "1rem" }}>
              💡 Make sure you have USDC in your Freighter wallet on Testnet first.
              Get test USDC from the <a href="https://laboratory.stellar.org" target="_blank" rel="noreferrer" style={{ color: "var(--gold)" }}>Stellar Laboratory</a>.
            </div>

            <button className="btn btn-primary btn-full btn-lg" type="submit" disabled={loading || !depositAmt}>
              {loading ? <><Spinner /> Depositing…</> : "⬆️ Deposit to Vault"}
            </button>
          </form>
        </div>
      </div>

      {/* Contract info */}
      <div className="card" style={{ borderColor: "var(--surface-3)" }}>
        <div className="card-title" style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>📋 Contract Configuration</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "0.75rem", fontSize: "0.82rem" }}>
          {[
            { label: "Contract ID", value: CONFIG.CONTRACT_ID },
            { label: "USDC Token", value: CONFIG.USDC_TOKEN },
            { label: "Network", value: "Testnet" },
            { label: "RPC", value: CONFIG.RPC_URL },
          ].map((r) => (
            <div key={r.label}>
              <div className="stat-label">{r.label}</div>
              <div style={{ fontFamily: "monospace", fontSize: "0.78rem", color: "var(--text-dim)", wordBreak: "break-all", marginTop: "0.1rem" }}>{r.value}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Student Dashboard ─────────────────────────────────────────────────────────

function StudentDashboard({ wallet }) {
  const [vaultInfo, setVaultInfo]   = useState(null);
  const [loading, setLoading]       = useState(false);
  const [txResult, setTxResult]     = useState(null);
  const [withdrawAmt, setWithdrawAmt] = useState("");

  const clearTx = () => setTxResult(null);

  const fetchVault = useCallback(async () => {
    try {
      setLoading(true);
      const info = await getVaultInfo(wallet);
      setVaultInfo(info);
    } catch (err) {
      setTxResult({ type: "error", message: "Could not load vault: " + err.message });
    } finally {
      setLoading(false);
    }
  }, [wallet]);

  useEffect(() => { fetchVault(); }, [fetchVault]);

  const handleWithdraw = async (e) => {
    e.preventDefault();
    clearTx();
    const amt = parseFloat(withdrawAmt);
    if (!amt || amt <= 0) return;
    try {
      setLoading(true);
      setTxResult({ type: "pending", message: `Requesting withdrawal of ${amt} USDC…` });
      const hash = await withdrawFromVault(wallet, amt);
      setTxResult({ type: "success", message: `Withdrawn ${amt} USDC — enjoy your baon! 🎉`, hash });
      setWithdrawAmt("");
      await fetchVault();
    } catch (err) {
      setTxResult({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  };

  const { canWithdraw } = useCountdown(vaultInfo?.lastWithdrawal ?? 0);
  const limitUsdc = vaultInfo ? stroopsToUsdc(vaultInfo.dailyLimit) : 0;

  return (
    <div className="animate-in" style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem" }}>
        <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.4rem", fontWeight: 800 }}>
          Student Wallet
        </h2>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <AddressPill address={wallet} />
          <button className="btn btn-outline" onClick={fetchVault} disabled={loading}>
            {loading ? <Spinner light /> : "↻"} Refresh
          </button>
        </div>
      </div>

      {vaultInfo ? (
        <VaultHero vaultInfo={vaultInfo} />
      ) : loading ? (
        <div className="card" style={{ textAlign: "center", padding: "3rem" }}>
          <Spinner light /> <span style={{ marginLeft: "0.75rem", color: "var(--text-muted)" }}>Loading vault…</span>
        </div>
      ) : (
        <div className="card" style={{ textAlign: "center", padding: "2rem", color: "var(--text-muted)" }}>
          <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🔒</div>
          <div>No vault found for this wallet. Ask your parent to initialize one.</div>
        </div>
      )}

      <TxFeedback result={txResult} onDismiss={clearTx} />

      {vaultInfo && (
        <div className="card-grid">
          {/* Countdown */}
          <CountdownTimer lastWithdrawal={vaultInfo.lastWithdrawal} />

          {/* Withdraw */}
          <div className="card">
            <div className="card-title">💸 Withdraw Baon</div>

            <form onSubmit={handleWithdraw}>
              <div className="form-group">
                <label className="form-label">Amount (USDC)</label>
                <div className="form-input-prefix">
                  <span className="form-prefix">$</span>
                  <input
                    className="form-input"
                    type="number"
                    min="0.000001"
                    max={limitUsdc}
                    step="0.000001"
                    placeholder={`Max ${limitUsdc.toFixed(4)} USDC`}
                    value={withdrawAmt}
                    onChange={(e) => setWithdrawAmt(e.target.value)}
                    disabled={loading || !canWithdraw}
                  />
                </div>
                <div className="form-hint">
                  {withdrawAmt
                    ? `≈ ₱${usdcToPhp(parseFloat(withdrawAmt) || 0)}`
                    : `Daily limit: ${limitUsdc.toFixed(4)} USDC ≈ ₱${usdcToPhp(limitUsdc)}`}
                </div>
              </div>

              {/* Quick-select buttons */}
              <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap" }}>
                {[0.05, 0.10, 0.15, limitUsdc].map((v) => (
                  <button
                    key={v}
                    type="button"
                    className="btn btn-ghost"
                    style={{ fontSize: "0.78rem", padding: "0.3rem 0.7rem", border: "1px solid var(--surface-3)" }}
                    onClick={() => setWithdrawAmt(v.toFixed(4))}
                    disabled={!canWithdraw || loading}
                  >
                    {v.toFixed(2)}
                  </button>
                ))}
                <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", alignSelf: "center", marginLeft: "0.25rem" }}>USDC</span>
              </div>

              {!canWithdraw && (
                <div className="tx-box pending" style={{ marginBottom: "0.75rem", marginTop: 0 }}>
                  <span>⏳</span>
                  <span>24-hour cooldown active. The contract will reject early withdrawals.</span>
                </div>
              )}

              <button
                className="btn btn-primary btn-full btn-lg"
                type="submit"
                disabled={loading || !canWithdraw || !withdrawAmt}
                style={canWithdraw ? {} : { opacity: 0.5 }}
              >
                {loading ? <><Spinner /> Withdrawing…</> : "⬇️ Withdraw USDC"}
              </button>
            </form>

            <div className="divider" />

            <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
              <strong style={{ color: "var(--text-dim)" }}>Contract guards:</strong>
              <ul style={{ paddingLeft: "1.2rem", marginTop: "0.35rem", display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                <li>Amount ≤ daily limit (enforced in Rust)</li>
                <li>≥ 86 400 seconds since last withdrawal</li>
                <li>Only registered student wallet can call</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Landing ───────────────────────────────────────────────────────────────────

function Landing({ onSelectRole }) {
  return (
    <div className="landing">
      <div className="landing-pig">🐷</div>
      <h1>Stop going broke<br />by Wednesday.</h1>
      <p>BaonGuard enforces your daily allowance on the Stellar blockchain. Parents deposit once — students withdraw a little each day.</p>
      <div className="role-cards">
        {[
          { role: "parent", icon: "👨‍👩‍👧", title: "I'm a Parent", desc: "Set up and fund the vault" },
          { role: "student", icon: "🎒", title: "I'm a Student", desc: "View and withdraw my baon" },
        ].map((r) => (
          <div key={r.role} className="role-card" onClick={() => onSelectRole(r.role)}>
            <div className="role-card-icon">{r.icon}</div>
            <div className="role-card-title">{r.title}</div>
            <div className="role-card-desc">{r.desc}</div>
          </div>
        ))}
      </div>
      <p style={{ fontSize: "0.8rem" }}>
        Runs on <strong style={{ color: "var(--gold)" }}>Stellar Testnet</strong> · Powered by Soroban smart contracts
      </p>
    </div>
  );
}

// ── Connect Prompt ────────────────────────────────────────────────────────────

function ConnectPrompt({ role, onConnect, loading, error }) {
  return (
    <div className="connect-prompt animate-in">
      <div style={{ fontSize: "3rem" }}>{role === "parent" ? "👨‍👩‍👧" : "🎒"}</div>
      <h2>Connect your wallet</h2>
      <p>BaonGuard uses Freighter to sign Soroban transactions on Stellar Testnet.</p>
      {error && (
        <div className="tx-box error" style={{ maxWidth: "400px" }}>
          <span>✗</span> {error}
        </div>
      )}
      <button className="btn btn-primary btn-lg" onClick={onConnect} disabled={loading}>
        {loading ? <><Spinner /> Connecting…</> : "🔗 Connect Freighter"}
      </button>
      <p style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
        Don't have Freighter?{" "}
        <a href="https://www.freighter.app" target="_blank" rel="noreferrer" style={{ color: "var(--gold)" }}>
          Install it here
        </a>
      </p>
    </div>
  );
}

// ── Root App ──────────────────────────────────────────────────────────────────

export default function App() {
  const [view, setView]       = useState("landing"); // landing | parent | student
  const [wallet, setWallet]   = useState(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletError, setWalletError]     = useState(null);

  const handleSelectRole = (role) => {
    setView(role);
    setWalletError(null);
  };

  const handleConnect = async () => {
    setWalletLoading(true);
    setWalletError(null);
    try {
      const addr = await connectFreighter();
      setWallet(addr);
    } catch (err) {
      setWalletError(err.message);
    } finally {
      setWalletLoading(false);
    }
  };

  const handleDisconnect = () => {
    setWallet(null);
    setView("landing");
  };

  const renderMain = () => {
    if (view === "landing") {
      return <Landing onSelectRole={handleSelectRole} />;
    }

    if (!wallet) {
      return (
        <ConnectPrompt
          role={view}
          onConnect={handleConnect}
          loading={walletLoading}
          error={walletError}
        />
      );
    }

    if (view === "parent")  return <ParentDashboard  wallet={wallet} />;
    if (view === "student") return <StudentDashboard wallet={wallet} />;
    return null;
  };

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="logo" onClick={() => { setView("landing"); setWallet(null); }} style={{ cursor: "pointer" }}>
          <span className="logo-pig">🐷</span> BaonGuard
        </div>

        <nav style={{ display: "flex", gap: "0.4rem" }}>
          {["parent", "student"].map((r) => (
            <button
              key={r}
              className={`btn btn-ghost ${view === r ? "btn-outline" : ""}`}
              style={view === r ? { color: "var(--gold)", borderColor: "var(--gold-border)" } : {}}
              onClick={() => handleSelectRole(r)}
            >
              {r === "parent" ? "👨‍👩‍👧 Parent" : "🎒 Student"}
            </button>
          ))}
        </nav>

        <div className="header-right">
          <span className="network-badge">Testnet</span>
          {wallet ? (
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <AddressPill address={wallet} />
              <button className="btn btn-danger" onClick={handleDisconnect}>Disconnect</button>
            </div>
          ) : (
            view !== "landing" && (
              <button className="btn btn-primary" onClick={handleConnect} disabled={walletLoading}>
                {walletLoading ? <Spinner /> : "🔗 Connect"}
              </button>
            )
          )}
        </div>
      </header>

      {/* Main */}
      <main style={{ paddingTop: "2rem" }}>
        {renderMain()}
      </main>
    </div>
  );
}