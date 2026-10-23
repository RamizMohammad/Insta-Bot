from __future__ import annotations


async def test_workflow_evaluate_endpoint(api) -> None:
    auth = await api.register("wf@example.com")
    body = {
        "comment_text": "Please send me the COURSE link!",
        "rules": [{"keyword": "course", "match_type": "contains", "case_sensitive": False, "action": "include"}],
    }
    r = await api.client.post("/api/v1/workflows/evaluate", json=body, headers=api.headers(auth))
    assert r.status_code == 200
    data = r.json()
    assert data["matched"] is True
    assert data["matched_rules"][0]["keyword"] == "course"
    assert data["eligibility"]["decision"] == "proceed"
    r = await api.client.post("/api/v1/workflows/evaluate", json=body | {"comment_text": 5}, headers=api.headers(auth))
    assert r.json()["matched"] is False
    assert (await api.client.post("/api/v1/workflows/evaluate", json=body)).status_code == 401
