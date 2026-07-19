from fastapi.testclient import TestClient

from app.main import app


def test_m9_tester_page_is_served_without_api_key() -> None:
    response = TestClient(app).get("/m9-tester/")
    assert response.status_code == 200
    assert "M9 Gateway Tester" in response.text
    assert 'fetch("/v1/inspect"' in response.text
