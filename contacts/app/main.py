"""
Contacts Service - Bounded Context: contacts

Отвечает за клиентов и контактные данные, связаны с Case только через case_uuid.
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
    logger.info("Contacts service starting...")
    yield
    logger.info("Contacts service shutting down...")


app = FastAPI(
    title="Contacts Service",
    description="Bounded context: contacts",
    version="1.0.0",
    lifespan=lifespan,
)


@app.get("/health")
async def health():
    """Health check."""
    return {"status": "ok", "service": "contacts"}


@app.get("/")
async def root():
    """Root endpoint."""
    return {
        "service": "contacts",
        "bounded_context": "contacts",
        "status": "running",
    }

