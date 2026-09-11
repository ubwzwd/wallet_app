"""HTTP routers (03-backend-api.md §1.3).

Every module in this package that defines a module level ``router`` is mounted
automatically by ``app.main``, so adding an endpoint file is all it takes to
publish it. Modules are imported in name order, which makes the set of routes
deterministic; route declaration order that actually matters (``/ledgers/join``
before ``/ledgers/{id}``, the transfer routes before ``/transactions/{tid}``)
lives inside a single module and is unaffected.
"""
import importlib
import pkgutil

from fastapi import APIRouter


def iter_routers() -> list[APIRouter]:
    """Import every submodule in name order and collect their ``router``s."""
    routers: list[APIRouter] = []
    for module_info in sorted(pkgutil.iter_modules(__path__), key=lambda info: info.name):
        module = importlib.import_module(f"{__name__}.{module_info.name}")
        router = getattr(module, "router", None)
        if isinstance(router, APIRouter):
            routers.append(router)
    return routers
