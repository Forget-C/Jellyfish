"""任务主表单一维护入口的架构护栏。"""

import ast
from pathlib import Path


def test_only_task_service_constructs_or_updates_task_rows():
    """扫描全部应用模块，禁止其他模块直接构造、批量更新或删除 Task。"""
    root = Path(__file__).parents[2] / "app"
    violations = []
    for path in root.rglob("*.py"):
        if path == root / "services/task_service.py":
            continue
        tree = ast.parse(path.read_text())
        names = {alias.asname or alias.name for node in ast.walk(tree)
                 if isinstance(node, ast.ImportFrom) and node.module == "app.models.task"
                 for alias in node.names if alias.name == "Task"}
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Name):
                continue
            creates = node.func.id in names
            mutates = node.func.id in {"update", "delete"} and node.args and isinstance(node.args[0], ast.Name) and node.args[0].id in names
            if creates or mutates:
                violations.append(f"{path.relative_to(root)}:{node.lineno}")
    assert not violations, violations


def test_worker_reports_lifecycle_through_task_service():
    """执行器不得直接赋值状态；成功、失败、取消都交给统一维护入口裁决。"""
    root = Path(__file__).parents[2] / "app"
    for relative in ("task_worker.py", "services/generation/media_execution.py", "services/script_processing_worker.py"):
        tree = ast.parse((root / relative).read_text())
        for node in ast.walk(tree):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target] if isinstance(node, (ast.AnnAssign, ast.AugAssign)) else []
            assert not any(isinstance(target, ast.Attribute) and target.attr == "status" for target in targets), relative
