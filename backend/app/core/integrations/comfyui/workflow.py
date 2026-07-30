"""ComfyUI API-format 工作流的加载与输入注入。

**不假设任何节点 ID。** 节点 ID 因工作流而异，因此本模块要求显式提供一份
「输入映射」，把逻辑输入名（prompt / width / ...）映射到
``<node_id>.<input_name>``，并显式指定输出节点。

映射文件（JSON）示例::

    {
      "workflow_path": "workflows/cas_txt2video.api.json",
      "inputs": {
        "positive_prompt": "6.text",
        "negative_prompt": "7.text",
        "width":  "5.width",
        "height": "5.height",
        "frames": "5.length",
        "fps":    "8.fps",
        "seed":   "3.seed"
      },
      "output_node": "9"
    }

只有出现在 ``inputs`` 中的键才会被注入；未映射的输入被静默忽略（因为并非所有
工作流都支持 negative prompt / fps / seed）。这样既避免了硬编码，也避免了向
工作流写入它不认识的字段。
"""

from __future__ import annotations

import copy
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

#: 允许注入的逻辑输入名。刻意保持窄集合：新增需显式扩展并测试。
SUPPORTED_INPUT_KEYS: frozenset[str] = frozenset(
    {"positive_prompt", "negative_prompt", "width", "height", "frames", "fps", "seed"}
)


class WorkflowConfigError(RuntimeError):
    """工作流配置缺失或不合法。

    该错误必须清晰暴露到 Production Job 与工作台，不能被静默吞掉，
    也不能退化成假供应商。
    """


@dataclass(frozen=True, slots=True)
class WorkflowMapping:
    """一份工作流及其输入/输出映射。"""

    workflow: dict[str, Any]
    inputs: dict[str, str]
    output_node: str

    def describe(self) -> dict[str, Any]:
        """用于诊断的安全摘要（不含提示词内容与任何密钥）。"""
        return {
            "node_count": len(self.workflow),
            "mapped_inputs": sorted(self.inputs.keys()),
            "output_node": self.output_node,
        }


def _split_target(target: str) -> tuple[str, str]:
    """把 ``"6.text"`` 拆成 ``("6", "text")``。"""
    node_id, _, field = target.partition(".")
    if not node_id or not field:
        raise WorkflowConfigError(
            f"invalid input mapping target {target!r}; expected '<node_id>.<input_name>'"
        )
    return node_id, field


def load_mapping(mapping_path: str | Path, *, base_dir: str | Path | None = None) -> WorkflowMapping:
    """读取映射文件与其引用的工作流 JSON。

    参数：
        mapping_path: 映射 JSON 的路径。
        base_dir: 解析 ``workflow_path`` 相对路径的基准目录；缺省用映射文件所在目录。
    异常：
        WorkflowConfigError：文件缺失、JSON 非法、字段缺失或映射目标不合法。
    """
    path = Path(mapping_path)
    if not path.is_file():
        raise WorkflowConfigError(f"workflow mapping file not found: {path}")
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise WorkflowConfigError(f"workflow mapping is not valid JSON: {exc}") from exc
    if not isinstance(raw, dict):
        raise WorkflowConfigError("workflow mapping must be a JSON object")

    workflow_rel = raw.get("workflow_path")
    if not isinstance(workflow_rel, str) or not workflow_rel.strip():
        raise WorkflowConfigError("workflow mapping requires a non-empty 'workflow_path'")

    root = Path(base_dir) if base_dir is not None else path.parent
    workflow_file = Path(workflow_rel)
    if not workflow_file.is_absolute():
        workflow_file = root / workflow_file
    if not workflow_file.is_file():
        raise WorkflowConfigError(f"workflow file not found: {workflow_file}")
    try:
        workflow = json.loads(workflow_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise WorkflowConfigError(f"workflow file is not valid JSON: {exc}") from exc
    if not isinstance(workflow, dict) or not workflow:
        raise WorkflowConfigError("workflow must be a non-empty API-format JSON object")

    inputs = raw.get("inputs")
    if not isinstance(inputs, dict) or not inputs:
        raise WorkflowConfigError("workflow mapping requires a non-empty 'inputs' object")
    unknown = sorted(set(inputs) - SUPPORTED_INPUT_KEYS)
    if unknown:
        raise WorkflowConfigError(
            f"unsupported input keys in mapping: {unknown}; "
            f"supported: {sorted(SUPPORTED_INPUT_KEYS)}"
        )

    normalized: dict[str, str] = {}
    for key, target in inputs.items():
        if not isinstance(target, str):
            raise WorkflowConfigError(f"input mapping for {key!r} must be a string")
        node_id, _field = _split_target(target)
        if node_id not in workflow:
            raise WorkflowConfigError(
                f"input mapping for {key!r} references node {node_id!r} absent from the workflow"
            )
        normalized[key] = target

    output_node = raw.get("output_node")
    if not isinstance(output_node, str) or not output_node.strip():
        raise WorkflowConfigError("workflow mapping requires a non-empty 'output_node'")
    if output_node not in workflow:
        raise WorkflowConfigError(f"output_node {output_node!r} is absent from the workflow")

    return WorkflowMapping(workflow=workflow, inputs=normalized, output_node=output_node)


def apply_inputs(mapping: WorkflowMapping, values: dict[str, Any]) -> dict[str, Any]:
    """把 ``values`` 注入工作流副本并返回。

    只注入「既被映射、又在 values 里有非 None 值」的键；原始工作流不被修改。
    """
    prompt = copy.deepcopy(mapping.workflow)
    for key, target in mapping.inputs.items():
        if key not in values:
            continue
        value = values[key]
        if value is None:
            continue
        node_id, field = _split_target(target)
        node = prompt.get(node_id)
        if not isinstance(node, dict):
            raise WorkflowConfigError(f"workflow node {node_id!r} is not an object")
        node.setdefault("inputs", {})
        if not isinstance(node["inputs"], dict):
            raise WorkflowConfigError(f"workflow node {node_id!r} has a non-object 'inputs'")
        node["inputs"][field] = value
    return prompt


__all__ = [
    "SUPPORTED_INPUT_KEYS",
    "WorkflowConfigError",
    "WorkflowMapping",
    "apply_inputs",
    "load_mapping",
]
