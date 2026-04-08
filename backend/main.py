"""
backend/main.py

FastAPI application for BaonGuard — proxies all Stellar RPC calls so the
browser never hits the RPC directly (fixes CORS, Bug 1.4) and returns
structured JSON errors (fixes Bug 1.7).
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, Field

from backend.stellar_client import StellarClient

logger = logging.getLogger(__name__)

# ── Lifespan: create a single StellarClient instance shared across requests ──

stellar_client: StellarClient | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global stellar_client
    stellar_client = StellarClient()
    logger.info("StellarClient ready")
    yield
    logger.info("Shutting down")


# ── 8.1  FastAPI app + CORS ───────────────────────────────────────────────────

app = FastAPI(
    title="BaonGuard API",
    description="FastAPI proxy for the BaonGuard Soroban timelock vault",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── 8.2  Pydantic models ──────────────────────────────────────────────────────

class InitializeRequest(BaseModel):
    student_address: str = Field(
        ...,
        description="Stellar G-address of the student wallet",
        example="GABC...XYZ",
    )
    token_address: str = Field(
        ...,
        description="Stellar C-address of the USDC token contract",
        example="CBKFO3...",
    )
    daily_limit: int = Field(
        ...,
        gt=0,
        description="Maximum stroops the student can withdraw per 24 hours",
    )


class WithdrawRequest(BaseModel):
    student_address: str = Field(
        ...,
        description="Must match the address registered at initialization",
    )
    amount: int = Field(
        ...,
        gt=0,
        description="Amount in stroops to withdraw (must be <= daily_limit)",
    )


class VaultInfoResponse(BaseModel):
    student_address: str
    daily_limit: int
    last_withdrawal_timestamp: int
    current_balance: int


class ErrorResponse(BaseModel):
    error: str


# ── 8.6  Global exception handlers ───────────────────────────────────────────
# Registered before routes so they apply to all endpoints.

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Override FastAPI's default 422 to return { "error": "..." } format."""
    messages = "; ".join(
        f"{' -> '.join(str(loc) for loc in e['loc'])}: {e['msg']}"
        for e in exc.errors()
    )
    return JSONResponse(status_code=422, content={"error": messages})


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Catch-all: return HTTP 500 with { "error": "..." }."""
    logger.exception("Unhandled exception on %s %s", request.method, request.url)
    return JSONResponse(status_code=500, content={"error": str(exc)})


# ── 8.3  GET /vault-info ──────────────────────────────────────────────────────

@app.get("/vault-info", response_model=VaultInfoResponse)
async def get_vault_info():
    """
    Return current vault state from the Soroban contract.

    Calls get_vault_info() as a read-only simulation — no fee, no ledger write.
    The contract returns a tuple: (student_address, daily_limit,
    last_withdrawal_timestamp, current_balance).
    """
    try:
        result = await stellar_client.call_contract_view("get_vault_info", [])
    except Exception as exc:
        logger.error("get_vault_info failed: %s", exc)
        raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    # result is a list of four parsed Python values from the contract tuple.
    if isinstance(result, (list, tuple)) and len(result) == 4:
        student_address, daily_limit, last_withdrawal_timestamp, current_balance = result
    else:
        raise HTTPException(
            status_code=500,
            detail={"error": f"Unexpected vault-info shape: {result!r}"},
        )

    return VaultInfoResponse(
        student_address=str(student_address),
        daily_limit=int(daily_limit),
        last_withdrawal_timestamp=int(last_withdrawal_timestamp),
        current_balance=int(current_balance),
    )


# ── 8.4  POST /initialize ─────────────────────────────────────────────────────

@app.post("/initialize")
async def initialize_vault(body: InitializeRequest):
    """
    Initialize the vault with a student address, token address, and daily limit.

    Can only be called once — subsequent calls will be rejected by the contract
    with an error (returned as HTTP 400).
    """
    try:
        tx_hash = await stellar_client.invoke_contract(
            "initialize",
            [body.student_address, body.token_address, body.daily_limit],
        )
    except Exception as exc:
        error_msg = str(exc)
        logger.error("initialize failed: %s", error_msg)
        raise HTTPException(status_code=400, detail={"error": error_msg}) from exc

    return {"tx_hash": tx_hash}


# ── 8.5  POST /withdraw ───────────────────────────────────────────────────────

@app.post("/withdraw")
async def withdraw(body: WithdrawRequest):
    """
    Withdraw stroops from the vault to the student's wallet.

    The contract enforces:
      - amount <= daily_limit  (else HTTP 400 "exceeds daily limit")
      - 24-hour cooldown since last withdrawal  (else HTTP 400 "withdrawal too soon")
      - caller must be the registered student  (else HTTP 400 "unauthorized")
    """
    try:
        tx_hash = await stellar_client.invoke_contract(
            "withdraw",
            [body.student_address, body.amount],
        )
    except Exception as exc:
        error_msg = str(exc)
        logger.error("withdraw failed: %s", error_msg)
        raise HTTPException(status_code=400, detail={"error": error_msg}) from exc

    return {"tx_hash": tx_hash}
