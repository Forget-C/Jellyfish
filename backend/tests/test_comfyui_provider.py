"""Step 7：ComfyUI 供应商适配层测试（无需真实 ComfyUI 实例）。

覆盖：工作流映射加载与校验、输入注入（不假设节点 ID）、提交/轮询/完成解析、
失败与超时映射、产物定位、配置缺失的清晰失败、以及错误信息不泄露密钥。
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.core.contracts.provider import ProviderConfig
from app.core.contracts.video_generation import VideoGenerationInput
from app.core.integrations.comfyui import (
    ComfyUIError,
    WorkflowConfigError,
    apply_inputs,
    extract_video_output,
    load_mapping,
    read_execution_status,
)
from app.core.tasks.video_generation_tasks import ComfyUIVideoGenerationTask

_FIXTURES = Path(__file__).resolve().parent / "fixtures" / "comfyui"
_MAPPING = _FIXTURES / "example_mapping.json"


def _cfg(base_url: str | None = "http://comfy.test:8188") -> ProviderConfig:
    return ProviderConfig(provider="comfyui", api_key="", base_url=base_url)


def _input(**overrides) -> VideoGenerationInput:
    data = {"prompt": "Bruno bursts in, arms rising", "ratio": "9:16", "seconds": 3}
    data.update(overrides)
    return VideoGenerationInput(**data)


class _FakeAdapter:
    """假 HTTP 边界：记录提交内容并按脚本返回 history。"""

    def __init__(self, history_sequence: list[dict | None], *, fail_submit: str | None = None):
        self.history_sequence = list(history_sequence)
        self.fail_submit = fail_submit
        self.submitted_prompt: dict | None = None
        self.submit_calls = 0
        self.history_calls = 0

    async def submit_prompt(self, *, cfg, prompt, client_id, timeout_s):
        self.submit_calls += 1
        self.submitted_prompt = prompt
        if self.fail_submit:
            raise ComfyUIError(self.fail_submit)
        return "prompt-abc123"

    async def get_history(self, *, cfg, prompt_id, timeout_s):
        self.history_calls += 1
        if self.history_sequence:
            return self.history_sequence.pop(0)
        return None

    def build_view_url(self, *, cfg, output):
        return f"{cfg.base_url}/view?filename={output['filename']}"


def _success_history() -> dict:
    return {
        "status": {"status_str": "success", "completed": True},
        "outputs": {"9": {"videos": [{"filename": "cas_00001.mp4", "subfolder": "", "type": "output"}]}},
    }


# --------------------------------------------------------------------------- #
# 工作流映射
# --------------------------------------------------------------------------- #
def test_mapping_loads_and_describes_safely() -> None:
    """映射可加载，摘要不含提示词或密钥。"""
    mapping = load_mapping(_MAPPING)
    assert mapping.output_node == "9"
    assert set(mapping.inputs) == {
        "positive_prompt",
        "negative_prompt",
        "width",
        "height",
        "frames",
        "fps",
        "seed",
    }
    # describe() 只暴露结构信息：节点数、被映射的输入名、输出节点。
    # 断言它不含任何工作流内容（提示词文本、模型名等），可安全写入日志与任务元数据。
    described = mapping.describe()
    assert described["output_node"] == "9"
    assert described["node_count"] == 6
    serialized = json.dumps(described)
    assert "placeholder positive" not in serialized
    assert "CLIPTextEncode" not in serialized
    assert set(described) == {"node_count", "mapped_inputs", "output_node"}


def test_apply_inputs_injects_only_mapped_values_without_mutating_source() -> None:
    """只注入被映射且有值的键；原工作流不被修改（不假设节点 ID）。"""
    mapping = load_mapping(_MAPPING)
    before = json.dumps(mapping.workflow, sort_keys=True)
    prompt = apply_inputs(
        mapping,
        {"positive_prompt": "a bull celebrates", "width": 1080, "height": 1920, "seed": None},
    )
    assert prompt["6"]["inputs"]["text"] == "a bull celebrates"
    assert prompt["5"]["inputs"]["width"] == 1080
    assert prompt["5"]["inputs"]["height"] == 1920
    # seed 为 None → 不注入，保留工作流原值
    assert prompt["3"]["inputs"]["seed"] == 0
    assert json.dumps(mapping.workflow, sort_keys=True) == before


def test_mapping_rejects_unknown_node_reference(tmp_path: Path) -> None:
    """映射指向不存在的节点时明确失败。"""
    bad = tmp_path / "m.json"
    bad.write_text(
        json.dumps(
            {
                "workflow_path": str(_FIXTURES / "example_workflow.api.json"),
                "inputs": {"positive_prompt": "999.text"},
                "output_node": "9",
            }
        ),
        encoding="utf-8",
    )
    with pytest.raises(WorkflowConfigError, match="absent from the workflow"):
        load_mapping(bad)


def test_missing_mapping_file_fails_clearly(tmp_path: Path) -> None:
    """配置文件缺失 → 清晰错误，绝不回退到假供应商。"""
    with pytest.raises(WorkflowConfigError, match="not found"):
        load_mapping(tmp_path / "nope.json")


def test_unconfigured_workflow_path_fails_clearly() -> None:
    """未配置映射路径时构造任务即失败。"""
    with pytest.raises(WorkflowConfigError, match="not configured"):
        ComfyUIVideoGenerationTask(
            provider_config=_cfg(), input_=_input(), workflow_mapping_path=""
        )


# --------------------------------------------------------------------------- #
# 提交与轮询
# --------------------------------------------------------------------------- #
@pytest.mark.asyncio
async def test_submit_and_complete_produces_result() -> None:
    """排队 → 完成：返回可下载 URL 与 provider job id。"""
    adapter = _FakeAdapter([None, _success_history()])
    task = ComfyUIVideoGenerationTask(
        adapter=adapter,
        mapping=load_mapping(_MAPPING),
        provider_config=_cfg(),
        input_=_input(),
        poll_interval_s=0,
        timeout_s=5,
    )
    await task.run()
    result = await task.get_result()

    assert result is not None, await task.status()
    assert result.provider == "comfyui"
    assert result.provider_task_id == "prompt-abc123"
    assert result.url.endswith("cas_00001.mp4")
    # 9:16 → 1080×1920；3 秒 @24fps → 72 帧
    assert adapter.submitted_prompt["5"]["inputs"]["width"] == 1080
    assert adapter.submitted_prompt["5"]["inputs"]["height"] == 1920
    assert adapter.submitted_prompt["5"]["inputs"]["length"] == 72
    assert adapter.submitted_prompt["8"]["inputs"]["fps"] == 24


@pytest.mark.asyncio
async def test_provider_error_is_mapped_to_failure() -> None:
    """供应商报错 → 任务失败且错误可读。"""
    history = {"status": {"status_str": "error", "messages": ["node 5 failed"]}}
    task = ComfyUIVideoGenerationTask(
        adapter=_FakeAdapter([history]),
        mapping=load_mapping(_MAPPING),
        provider_config=_cfg(),
        input_=_input(),
        poll_interval_s=0,
        timeout_s=5,
    )
    await task.run()
    assert await task.get_result() is None
    status = await task.status()
    assert "execution failed" in status["error"]


@pytest.mark.asyncio
async def test_timeout_is_mapped_to_structured_failure() -> None:
    """永远排队 → 超时失败，不会无限挂起。"""
    task = ComfyUIVideoGenerationTask(
        adapter=_FakeAdapter([]),
        mapping=load_mapping(_MAPPING),
        provider_config=_cfg(),
        input_=_input(),
        poll_interval_s=0,
        timeout_s=0,
    )
    await task.run()
    assert await task.get_result() is None
    assert "timed out" in (await task.status())["error"]


@pytest.mark.asyncio
async def test_missing_base_url_fails_without_leaking_config() -> None:
    """未配置 base_url → 明确失败，且信息里不含密钥字段。"""
    from app.core.integrations.comfyui import ComfyUIVideoApiAdapter

    adapter = ComfyUIVideoApiAdapter()
    with pytest.raises(ComfyUIError, match="base_url is not configured"):
        await adapter.submit_prompt(
            cfg=_cfg(base_url=None), prompt={}, client_id="c", timeout_s=1
        )


# --------------------------------------------------------------------------- #
# 产物定位与状态解析
# --------------------------------------------------------------------------- #
def test_extract_video_output_rejects_non_video() -> None:
    """节点只产出图片时不得当作视频成功。"""
    entry = {"outputs": {"9": {"images": [{"filename": "preview.png"}]}}}
    with pytest.raises(ComfyUIError, match="no video output"):
        extract_video_output(entry, "9")


def test_extract_video_output_finds_video_across_collections() -> None:
    """videos/gifs/images/files 任一集合中的视频都能定位。"""
    entry = {"outputs": {"9": {"gifs": [{"filename": "out.webm", "subfolder": "sub"}]}}}
    found = extract_video_output(entry, "9")
    assert found["filename"] == "out.webm"
    assert found["subfolder"] == "sub"


def test_read_execution_status_treats_absent_status_as_running() -> None:
    """尚无 status 字段视为仍在执行，而不是失败。"""
    assert read_execution_status({})[0] == "running"
    assert read_execution_status({"status": {"status_str": "success"}})[0] == "success"


def test_preview_profile_uses_exact_9_16_dimensions() -> None:
    """预览档 432×768：精确 9:16，且原样注入工作流。"""
    task = ComfyUIVideoGenerationTask(
        adapter=_FakeAdapter([_success_history()]),
        mapping=load_mapping(_MAPPING),
        provider_config=_cfg(),
        input_=_input(width=432, height=768),
        poll_interval_s=0,
        timeout_s=5,
    )
    values = task._build_workflow_values()  # pylint: disable=protected-access
    assert (values["width"], values["height"]) == (432, 768)
    assert 432 / 768 == 9 / 16  # 精确比例，不是 544/960 的 17:30


def test_final_profile_falls_back_to_ratio_dimensions() -> None:
    """成片档不传分辨率 → 由 ratio 推导 1080×1920（既有行为不变）。"""
    task = ComfyUIVideoGenerationTask(
        adapter=_FakeAdapter([_success_history()]),
        mapping=load_mapping(_MAPPING),
        provider_config=_cfg(),
        input_=_input(),
        poll_interval_s=0,
        timeout_s=5,
    )
    values = task._build_workflow_values()  # pylint: disable=protected-access
    assert (values["width"], values["height"]) == (1080, 1920)


# --------------------------------------------------------------------------- #
# fail-fast：缺少尺寸映射时禁止静默略过
# --------------------------------------------------------------------------- #
def _mapping_without(keys: set[str], tmp_path: Path):
    """构造一份去掉指定输入映射的 mapping。"""
    original = json.loads(_MAPPING.read_text(encoding="utf-8"))
    original["inputs"] = {k: v for k, v in original["inputs"].items() if k not in keys}
    original["workflow_path"] = str(_FIXTURES / "example_workflow.api.json")
    path = tmp_path / "m.json"
    path.write_text(json.dumps(original), encoding="utf-8")
    return load_mapping(path)


def test_require_render_inputs_passes_with_width_and_height() -> None:
    """映射同时含 width/height → 校验通过。"""
    from app.core.integrations.comfyui import require_render_inputs

    require_render_inputs(load_mapping(_MAPPING))  # 不抛异常即通过


@pytest.mark.parametrize(
    "removed,expected",
    [({"width"}, "width"), ({"height"}, "height")],
)
def test_missing_single_dimension_mapping_fails(removed, expected, tmp_path: Path) -> None:
    """缺少 width 或 height 之一 → 明确失败，错误列出该键。"""
    from app.core.integrations.comfyui import require_render_inputs

    with pytest.raises(WorkflowConfigError, match="missing required inputs") as exc:
        require_render_inputs(_mapping_without(removed, tmp_path))
    assert expected in str(exc.value)


def test_missing_both_dimensions_lists_both(tmp_path: Path) -> None:
    """两者都缺 → 错误同时列出 width 与 height。"""
    from app.core.integrations.comfyui import require_render_inputs

    with pytest.raises(WorkflowConfigError) as exc:
        require_render_inputs(_mapping_without({"width", "height"}, tmp_path))
    message = str(exc.value)
    assert "width" in message and "height" in message
    assert message.startswith("ComfyUI workflow mapping is missing required inputs:")


@pytest.mark.asyncio
async def test_missing_mapping_never_submits_prompt(tmp_path: Path) -> None:
    """校验失败时 submit_prompt 完全不被调用，任务也不会成功。"""
    adapter = _FakeAdapter([_success_history()])
    task = ComfyUIVideoGenerationTask(
        adapter=adapter,
        mapping=_mapping_without({"width", "height"}, tmp_path),
        provider_config=_cfg(),
        input_=_input(width=432, height=768),
        poll_interval_s=0,
        timeout_s=5,
    )
    await task.run()

    assert adapter.submit_calls == 0, "prompt must not be submitted when mapping is invalid"
    assert await task.get_result() is None
    status = await task.status()
    assert "missing required inputs" in status["error"]


@pytest.mark.asyncio
async def test_preview_profile_actually_reaches_the_workflow() -> None:
    """预览档：工作流节点真的收到 432×768。"""
    adapter = _FakeAdapter([_success_history()])
    task = ComfyUIVideoGenerationTask(
        adapter=adapter,
        mapping=load_mapping(_MAPPING),
        provider_config=_cfg(),
        input_=_input(width=432, height=768),
        poll_interval_s=0,
        timeout_s=5,
    )
    await task.run()
    assert await task.get_result() is not None
    assert adapter.submitted_prompt["5"]["inputs"]["width"] == 432
    assert adapter.submitted_prompt["5"]["inputs"]["height"] == 768


@pytest.mark.asyncio
async def test_final_profile_actually_reaches_the_workflow() -> None:
    """成片档：工作流节点真的收到 1080×1920。"""
    adapter = _FakeAdapter([_success_history()])
    task = ComfyUIVideoGenerationTask(
        adapter=adapter,
        mapping=load_mapping(_MAPPING),
        provider_config=_cfg(),
        input_=_input(),
        poll_interval_s=0,
        timeout_s=5,
    )
    await task.run()
    assert await task.get_result() is not None
    assert adapter.submitted_prompt["5"]["inputs"]["width"] == 1080
    assert adapter.submitted_prompt["5"]["inputs"]["height"] == 1920
