"""管理页公开搜索的匹配、稳定分页及旧列表兼容。"""
from datetime import datetime
from uuid import uuid4

import pytest

from app.models.studio import PromptTemplate
from tests.test_database_baseline_business import STUDIO, baseline_client, data


@pytest.mark.asyncio
async def test_management_search(baseline_client):
    client, sessions = baseline_client
    path = STUDIO + "/prompts"
    prefix = uuid4().hex
    term = prefix + "CAFÉ%_\\"
    async with sessions.begin() as db:
        for index in reversed(range(28)):
            name = term if index < 5 else prefix
            preview = term if index < 24 else (term.replace("É", "E"), term.replace("%", "X"),
                                                     term.replace("_", "X"), term.rstrip(chr(92)))[index - 24]
            db.add(PromptTemplate(id=f"{prefix}-{index:02}", category="video_prompt", name=name,
                                  preview=preview, content=term, created_at=datetime(2026, 1, 1)))
    found = []
    for page in (1, 2, 3):
        result = await data(client.get(path + "/summaries", params={"q": " " + term.lower() + " ", "page": page}))
        assert result["pagination"]["total"] == 24
        assert len(result["items"]) == (4 if page == 3 else 10)
        for row in result["items"]:
            assert set(row) == {"id", "name", "category"}
            found.append(row["id"])
    assert found == [f"{prefix}-{i:02}" for i in range(24)]
    legacy = await data(client.get(path, params={"q": prefix + "_af%"}))
    assert legacy["pagination"]["total"] == 5
    assert legacy["items"][0]["content"] == term
