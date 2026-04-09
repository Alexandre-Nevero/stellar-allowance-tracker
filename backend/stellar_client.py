"""
backend/stellar_client.py

Stellar SDK wrapper for BaonGuard.
Handles all Soroban contract interactions: view calls (simulation only)
and state-changing invocations (build → simulate → prepare → sign → submit → poll).
"""

import asyncio
import logging
import os
from typing import Any

from dotenv import load_dotenv
from stellar_sdk import Keypair, Network, TransactionBuilder
from stellar_sdk import SorobanServer
from stellar_sdk.exceptions import PrepareTransactionException
from stellar_sdk.soroban_rpc import GetTransactionStatus
from stellar_sdk.xdr import SCVal, SCValType

# Load backend/.env into os.environ before anything else reads env vars.
# resolve_dotenv_path ensures we find the .env relative to this file,
# not relative to wherever the process was launched from.
_env_path = os.path.join(os.path.dirname(__file__), ".env")
load_dotenv(dotenv_path=_env_path)

logger = logging.getLogger(__name__)


class StellarClient:
    """Wraps stellar-sdk to interact with the BaonGuard Soroban contract."""

    def __init__(
        self,
        contract_id: str | None = None,
        rpc_url: str | None = None,
        network_passphrase: str | None = None,
    ) -> None:
        """
        Load configuration from env vars (with optional overrides for testing).

        Reads CONTRACT_ID, STELLAR_RPC_URL, NETWORK_PASSPHRASE, and
        ADMIN_SECRET_KEY from the environment (populated by python-dotenv
        from backend/.env at module import time).
        """
        self.contract_id = contract_id or os.environ["CONTRACT_ID"]
        self.rpc_url = rpc_url or os.environ["STELLAR_RPC_URL"]
        self.network_passphrase = network_passphrase or os.environ["NETWORK_PASSPHRASE"]
        # ADMIN_SECRET_KEY is read lazily in invoke_contract so it is never
        # stored in a long-lived attribute (reduces accidental logging risk).

        # SorobanServer manages the HTTP connection pool to the RPC node.
        self.server = SorobanServer(self.rpc_url)

        logger.info(
            "StellarClient initialised — contract=%s rpc=%s",
            self.contract_id,
            self.rpc_url,
        )

    # ──────────────────────────────────────────────────────────────────────────
    # 7.2  Read-only simulation call
    # ──────────────────────────────────────────────────────────────────────────

    async def call_contract_view(self, function_name: str, args: list) -> Any:
        """
        Call a read-only contract function via simulation.

        No transaction is submitted — this is free and instant.
        Used for get_vault_info().

        Args:
            function_name: Name of the contract function to call.
            args: List of Python values; the SDK converts them to ScVal.

        Returns:
            Parsed Python value(s) from the contract's return ScVal.

        Raises:
            Exception: If simulation fails or returns an error.
        """
        logger.info("call_contract_view: function=%s args=%s", function_name, args)

        # Build a transaction using a random (throwaway) keypair.
        # For simulation the source account doesn't need to exist on-chain —
        # we only need a valid public key to satisfy the XDR structure.
        source_keypair = Keypair.random()

        try:
            source_account = self.server.load_account(source_keypair.public_key)
        except Exception:
            # If the random account doesn't exist on testnet, create a minimal
            # account object with sequence 0 so we can still build the tx.
            from stellar_sdk import Account
            source_account = Account(source_keypair.public_key, 0)

        # Convert Python args to ScVal parameters for the contract call.
        parameters = self._to_scval_list(args)

        tx = (
            TransactionBuilder(
                source_account=source_account,
                network_passphrase=self.network_passphrase,
                base_fee=100,
            )
            .append_invoke_contract_function_op(
                contract_id=self.contract_id,
                function_name=function_name,
                parameters=parameters,
            )
            .set_timeout(30)
            .build()
        )

        logger.info("call_contract_view: simulating transaction for %s", function_name)
        response = self.server.simulate_transaction(tx)

        if response.error:
            logger.error(
                "call_contract_view: simulation error for %s — %s",
                function_name,
                response.error,
            )
            raise Exception(f"Simulation failed: {response.error}")

        if not response.results:
            raise Exception("Simulation returned no results")

        result_xdr = response.results[0].xdr
        logger.info(
            "call_contract_view: simulation succeeded for %s, result_xdr=%s",
            function_name,
            result_xdr,
        )
        return self._parse_result(result_xdr)

    # ──────────────────────────────────────────────────────────────────────────
    # 7.3  Full transaction lifecycle for state-changing calls
    # ──────────────────────────────────────────────────────────────────────────

    async def invoke_contract(self, function_name: str, args: list) -> str:
        """
        Build, simulate, prepare, sign, submit, and poll a Soroban transaction.

        Lifecycle:
          1. BUILD   — assemble the transaction with the contract call
          2. SIMULATE — run it on the RPC to get fee + auth entries
          3. PREPARE — apply simulation results (fee, footprint, auth)
          4. SIGN    — sign with ADMIN_SECRET_KEY
          5. SUBMIT  — broadcast to the network
          6. POLL    — wait for the transaction to be included in a ledger

        Args:
            function_name: Name of the contract function to invoke.
            args: List of Python values to pass as arguments.

        Returns:
            Transaction hash (hex string) on success.

        Raises:
            Exception: On simulation failure, submission error, or tx failure.
        """
        logger.info("invoke_contract: function=%s args=%s", function_name, args)

        # Step 1: BUILD ────────────────────────────────────────────────────────
        # Read the admin secret key at call time (never store it as an attribute).
        admin_secret = os.environ["ADMIN_SECRET_KEY"]
        source_keypair = Keypair.from_secret(admin_secret)

        logger.info(
            "invoke_contract: loading source account %s", source_keypair.public_key
        )
        source_account = self.server.load_account(source_keypair.public_key)

        parameters = self._to_scval_list(args)

        tx = (
            TransactionBuilder(
                source_account=source_account,
                network_passphrase=self.network_passphrase,
                base_fee=100,
            )
            .append_invoke_contract_function_op(
                contract_id=self.contract_id,
                function_name=function_name,
                parameters=parameters,
            )
            .set_timeout(30)
            .build()
        )

        # Steps 2 & 3: SIMULATE + PREPARE ─────────────────────────────────────
        # prepare_transaction() simulates internally, then applies the results
        # (fee, storage footprint, auth entries) to the transaction.
        # Without this the network will reject the transaction.
        logger.info(
            "invoke_contract: preparing (simulate+apply) transaction for %s",
            function_name,
        )
        try:
            prepared_tx = self.server.prepare_transaction(tx)
        except PrepareTransactionException as exc:
            logger.error(
                "invoke_contract: prepare failed for %s — %s", function_name, exc
            )
            raise Exception(f"Transaction preparation failed: {exc}") from exc

        # Step 4: SIGN ─────────────────────────────────────────────────────────
        prepared_tx.sign(source_keypair)
        logger.info("invoke_contract: transaction signed for %s", function_name)

        # Step 5: SUBMIT ───────────────────────────────────────────────────────
        logger.info("invoke_contract: submitting transaction for %s", function_name)
        send_response = self.server.send_transaction(prepared_tx)

        if send_response.status == "ERROR":
            logger.error(
                "invoke_contract: submission error for %s — %s",
                function_name,
                send_response.error_result_xdr,
            )
            raise Exception(
                f"Transaction submission failed: {send_response.error_result_xdr}"
            )

        tx_hash = send_response.hash
        logger.info(
            "invoke_contract: transaction submitted for %s, hash=%s, status=%s",
            function_name,
            tx_hash,
            send_response.status,
        )

        # Step 6: POLL ─────────────────────────────────────────────────────────
        # Transactions are not immediately confirmed. Poll until the transaction
        # is included in a ledger (usually 5–10 seconds on testnet).
        while True:
            result = self.server.get_transaction(tx_hash)
            logger.info(
                "invoke_contract: poll status for %s hash=%s — %s",
                function_name,
                tx_hash,
                result.status,
            )

            if result.status == GetTransactionStatus.SUCCESS:
                logger.info(
                    "invoke_contract: transaction SUCCESS for %s hash=%s",
                    function_name,
                    tx_hash,
                )
                return tx_hash

            if result.status == GetTransactionStatus.FAILED:
                logger.error(
                    "invoke_contract: transaction FAILED for %s hash=%s — %s",
                    function_name,
                    tx_hash,
                    result.result_xdr,
                )
                raise Exception(f"Transaction failed on-chain: {result.result_xdr}")

            # NOT_FOUND means still pending — wait one ledger close (~5 s).
            await asyncio.sleep(5)

    # ──────────────────────────────────────────────────────────────────────────
    # 7.4  ScVal XDR → Python type conversion
    # ──────────────────────────────────────────────────────────────────────────

    def _parse_result(self, xdr: str) -> Any:
        """
        Convert a Soroban ScVal XDR string back to a native Python value.

        Supported mappings:
          SCV_ADDRESS → str  (Stellar G-address or C-address)
          SCV_I128    → int
          SCV_U64     → int
          SCV_BOOL    → bool
          SCV_VOID    → None
          SCV_VEC     → list  (each element recursively parsed)
          SCV_MAP     → dict  (keys and values recursively parsed)
          SCV_STRING  → str
          SCV_SYMBOL  → str
          SCV_U32     → int
          SCV_I32     → int
          SCV_BYTES   → bytes
          (fallback)  → raw SCVal object

        Args:
            xdr: Base64-encoded XDR string of a Soroban ScVal.

        Returns:
            A Python-native representation of the ScVal.
        """
        val = SCVal.from_xdr(xdr)
        return self._scval_to_python(val)

    def _scval_to_python(self, val: SCVal) -> Any:
        """Recursively convert a SCVal to a Python type."""
        t = val.type

        if t == SCValType.SCV_ADDRESS:
            # Address can be an account (G-address) or contract (C-address).
            # The SDK's StrKey helpers encode it back to the human-readable form.
            from stellar_sdk import StrKey
            addr = val.address
            if addr.account_id is not None:
                # Ed25519 public key → G-address
                raw = addr.account_id.account_id.ed25519.uint256
                return StrKey.encode_ed25519_public_key(raw)
            elif addr.contract_id is not None:
                # Contract hash → C-address
                raw = addr.contract_id.hash
                return StrKey.encode_contract(raw)
            return str(addr)

        if t == SCValType.SCV_I128:
            # i128 is stored as two u64 parts: hi (signed) and lo (unsigned).
            hi = val.i128.hi.int64
            lo = val.i128.lo.uint64
            return (hi << 64) | lo

        if t == SCValType.SCV_U64:
            return val.u64.uint64

        if t == SCValType.SCV_BOOL:
            return val.b

        if t == SCValType.SCV_VOID:
            return None

        if t == SCValType.SCV_VEC:
            if val.vec is None:
                return []
            return [self._scval_to_python(item) for item in val.vec.sc_vec]

        if t == SCValType.SCV_MAP:
            if val.map is None:
                return {}
            return {
                self._scval_to_python(entry.key): self._scval_to_python(entry.val)
                for entry in val.map.sc_map
            }

        if t == SCValType.SCV_STRING:
            return val.str.sc_string.decode("utf-8")

        if t == SCValType.SCV_SYMBOL:
            return val.sym.sc_symbol.decode("utf-8")

        if t == SCValType.SCV_U32:
            return val.u32.uint32

        if t == SCValType.SCV_I32:
            return val.i32.int32

        if t == SCValType.SCV_BYTES:
            return bytes(val.bytes.sc_bytes)

        # Fallback: return the raw SCVal so callers can inspect it.
        logger.warning("_parse_result: unhandled ScVal type %s", t)
        return val

    # ──────────────────────────────────────────────────────────────────────────
    # Internal helpers
    # ──────────────────────────────────────────────────────────────────────────

    def _to_scval_list(self, args: list) -> list:
        """
        Convert a list of Python values to stellar_sdk ScVal objects.

        The SDK's TransactionBuilder.append_invoke_contract_function_op
        accepts a list of SCVal XDR objects.  We use stellar_sdk helpers
        to build them from Python primitives.

        Supported input types:
          str  → SCV_ADDRESS (if it looks like a Stellar address) or SCV_STRING
          int  → SCV_I128
          bool → SCV_BOOL
          None → SCV_VOID
          SCVal (already converted) → passed through unchanged
        """
        from stellar_sdk import scval as sv

        result = []
        for arg in args:
            if isinstance(arg, SCVal):
                # Already an SCVal — pass through.
                result.append(arg)
            elif isinstance(arg, bool):
                result.append(sv.to_bool(arg))
            elif isinstance(arg, int):
                result.append(sv.to_int128(arg))
            elif isinstance(arg, str):
                # Stellar addresses start with G (account) or C (contract).
                if (arg.startswith("G") or arg.startswith("C")) and len(arg) == 56:
                    result.append(sv.to_address(arg))
                else:
                    result.append(sv.to_string(arg))
            elif arg is None:
                result.append(sv.to_void())
            else:
                raise TypeError(f"Cannot convert argument of type {type(arg)} to ScVal")
        return result
