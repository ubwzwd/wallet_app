"""Tests for the unified error body and exception handlers (03-backend-api.md §4.1)."""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.errors import ApiError, ErrorCode, install_error_handlers


def _build_app() -> FastAPI:
    """A tiny app with routes that each raise a different kind of error."""
    app = FastAPI()
    install_error_handlers(app)

    @app.get("/boom/api-error")
    def boom_api_error():
        raise ApiError(status_code=409, code=ErrorCode.STALE_UPDATE, detail="Stale update")

    @app.get("/boom/http-exception")
    def boom_http_exception():
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Ledger not found")

    @app.get("/boom/http-exception-headers")
    def boom_http_exception_headers():
        from fastapi import HTTPException

        raise HTTPException(
            status_code=401,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    @app.get("/boom/unauthorized")
    def boom_unauthorized():
        from fastapi import HTTPException

        raise HTTPException(status_code=401, detail="Not authenticated")

    @app.get("/boom/forbidden")
    def boom_forbidden():
        from fastapi import HTTPException

        raise HTTPException(status_code=403, detail="Not allowed")

    @app.get("/boom/bad-gateway")
    def boom_bad_gateway():
        from fastapi import HTTPException

        raise HTTPException(status_code=502, detail="Upstream failed")

    @app.post("/boom/validation")
    def boom_validation(amount: int):
        return {"amount": amount}

    @app.get("/boom/unhandled")
    def boom_unhandled():
        raise RuntimeError("kaboom")

    return app


client = TestClient(_build_app(), raise_server_exceptions=False)


def test_api_error_shape():
    resp = client.get("/boom/api-error")
    assert resp.status_code == 409
    body = resp.json()
    assert body["detail"] == "Stale update"
    assert body["code"] == "stale_update"


def test_http_exception_maps_to_not_found_code():
    resp = client.get("/boom/http-exception")
    assert resp.status_code == 404
    body = resp.json()
    assert body["detail"] == "Ledger not found"
    assert body["code"] == "not_found"


def test_http_exception_headers_pass_through():
    """A header set on the HTTPException (e.g. WWW-Authenticate, Retry-After)
    must survive through the unified handler, not just the code/detail."""
    resp = client.get("/boom/http-exception-headers")
    assert resp.status_code == 401
    body = resp.json()
    assert body["code"] == "unauthorized"
    assert resp.headers["www-authenticate"] == "Bearer"


def test_http_status_to_code_unauthorized():
    resp = client.get("/boom/unauthorized")
    assert resp.status_code == 401
    assert resp.json()["code"] == "unauthorized"


def test_http_status_to_code_forbidden():
    resp = client.get("/boom/forbidden")
    assert resp.status_code == 403
    assert resp.json()["code"] == "forbidden"


def test_http_status_to_code_server_error():
    resp = client.get("/boom/bad-gateway")
    assert resp.status_code == 502
    assert resp.json()["code"] == "internal_error"


def test_validation_error_shape():
    resp = client.post("/boom/validation", json={})
    assert resp.status_code == 422
    body = resp.json()
    assert body["code"] == "validation_error"
    # detail is a single compressed sentence, "<loc>: <msg>" per error, joined by "; "
    assert isinstance(body["detail"], str)
    assert "amount" in body["detail"]
    # raw pydantic error array is not returned (§4.1: "原始数组放在 detail 之外不再返回")
    assert set(body.keys()) == {"detail", "code"}


def test_unhandled_exception_returns_internal_error_without_leaking_stack():
    resp = client.get("/boom/unhandled")
    assert resp.status_code == 500
    body = resp.json()
    assert body["code"] == "internal_error"
    assert "kaboom" not in body["detail"]
    assert "Traceback" not in body["detail"]


def test_unregistered_path_returns_not_found_code():
    """Starlette's router-level 404 (unknown path) must still get {detail, code}."""
    resp = client.get("/no-such-route")
    assert resp.status_code == 404
    body = resp.json()
    assert body["code"] == "not_found"
    assert isinstance(body["detail"], str)


def test_wrong_method_returns_validation_error_code():
    """Starlette's router-level 405 (wrong method) must still get {detail, code}."""
    resp = client.post("/boom/http-exception")
    assert resp.status_code == 405
    body = resp.json()
    assert body["code"] == "validation_error"
    assert isinstance(body["detail"], str)


def test_import_app_main_succeeds():
    import app.main  # noqa: F401


def test_health_endpoint():
    from app.main import app as main_app

    with TestClient(main_app) as c:
        resp = c.get("/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "healthy"
