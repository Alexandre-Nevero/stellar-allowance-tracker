# BaonGuard Frontend

React + Stellar SDK web app for the BaonGuard Soroban timelock vault.

## Stack

| Layer | Tech |
|---|---|
| UI framework | React 18 + Vite |
| Blockchain SDK | @stellar/stellar-sdk v12 |
| Wallet | Freighter browser extension |
| Styling | Plain CSS (no framework — zero dead weight) |
| Network | Stellar Testnet (Soroban RPC) |

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure contract IDs
cp .env.example .env.local
# Edit .env.local with your deployed CONTRACT_ID and USDC_TOKEN

# 3. Run dev server
npm run dev
# → http://localhost:5173
```

## Build for Production

```bash
npm run build     # outputs to dist/
npm run preview   # preview the built app
```

## Project Structure

```
src/
├── main.jsx       Entry point
├── App.jsx        Root component, routing, wallet state
├── stellar.js     All Stellar SDK calls (single source of truth)
└── index.css      Design system (CSS variables + components)
```

## Connecting to the Contract

All blockchain calls live in `src/stellar.js`. The five exported functions map 1:1 to contract operations:

| Function | Contract call |
|---|---|
| `getVaultInfo(pubkey)` | `get_vault_info()` — simulated, no gas |
| `initializeVault(pubkey, student, limit)` | `initialize(student, token, daily_limit)` |
| `depositToVault(pubkey, amount)` | USDC token `transfer(parent → contract)` |
| `withdrawFromVault(pubkey, amount)` | `withdraw(amount)` |
| `connectFreighter()` | Freighter wallet API |

## Wallet Setup (Testnet)

1. Install [Freighter](https://www.freighter.app)
2. Switch to **Testnet** in Freighter settings
3. Fund with XLM via [Friendbot](https://friendbot.stellar.org?addr=YOUR_ADDRESS)
4. Get test USDC via [Stellar Laboratory](https://laboratory.stellar.org)

## License

MIT