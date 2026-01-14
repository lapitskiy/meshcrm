"""
Documents Service - Bounded Context: documents

Отвечает за PDF/акты/счета, связаны с Case только через case_uuid.
"""
import os
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown lifecycle."""
    logger.info("Documents service starting...")
    yield
    logger.info("Documents service shutting down...")


app = FastAPI(
    title="Documents Service",
    description="Bounded context: documents",
    version="1.0.0",
    lifespan=lifespan,
)


@app.get("/health")
async def health():
    """Health check."""
    return {"status": "ok", "service": "documents"}


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "service": "documents",
        "bounded_context": "documents",
        "status": "running",
    }

