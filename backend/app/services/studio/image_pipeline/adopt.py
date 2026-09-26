"""把生成出来的图片「采纳」进资产图片槽位（断点③的落点）。

用户要求："生成图片能回到资产页查看、采纳，刷新后仍存在。"

现状缺口（已核实）：
- ``image_pipeline`` 的出图提交**故意不写库**（文件头写明"提交结果由调用方走既有端点落库"）；
- 但 "既有的落库端点" **并不存在**：``create_file_from_url_or_b64``（下载远端图片→存储→建 FileItem）
  没有任何路由暴露。
- 结果就是：出图拿到的 ``oss_url`` / ``local_path`` 只存在于那一次响应里，**刷新即丢**。

本模块补上这一步：把外部生成的图片下载进存储、建 ``files`` 记录、写回
``{entity}_images.file_id``，并按需设为定版（``is_primary``）。之后资产页刷新即可看到，
且能被「按定版参考图批量出图」再次读到。

边界说明：
- 本步骤是**内部存储写入**（默认本地驱动），不是对外付费调用，因此不套付费守卫；
  对外付费出口（LLM / 出图服务 / 出视频）仍全部经守卫。
- **拒绝演练占位地址**：DRY_RUN 下的占位地址是不可达域名，且属于"演练产物"，
  不允许写进正式产物字段（与 product_guardrails 的口径一致）。
- **不静默替换定版**（用户明确要求）：``set_primary`` 默认 False；该资产已有定版图而本次
  会顶掉它时，必须显式传 ``confirm_replace_primary=true``，否则 409 且一行都不改。
  判定与摘要只有一份实现，见 ``app/services/studio/primary_protection.py``。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.types import FileType
from app.services.studio.entity_specs import entity_spec, normalize_entity_type
from app.services.studio.image_pipeline.reference_preflight import (
    verify_uploaded_url_reachable as _verify_uploaded_url_reachable,
)
from app.services.studio.primary_protection import (
    PrimaryImageSummary,
    ensure_primary_not_silently_replaced,
)
from app.utils.files import create_file_from_url_or_b64

# 「上传/落库之后的匿名可达性验证」**只有一份实现**，在
# ``image_pipeline/reference_preflight.py``（提交前预检与它共用同一个探活实现）。
# 这里保留同名导出只为兼容既有调用方/测试，**不要再在这里写第二份探测逻辑**。
verify_uploaded_url_reachable = _verify_uploaded_url_reachable

# DRY_RUN 占位地址使用的不可达域名（见 llm_orchestration/dry_run.py）
PLACEHOLDER_URL_MARKERS: tuple[str, ...] = ("dry-run.invalid",)

# 支持采纳的资产类型（**读取侧**口径：能收到「采纳」动作的资产类型全集）。
# 注意：这里不是「能出图的类型」——出图服务契约只覆盖 character/scene/prop 三类，
# 服装与商品走 Jellyfish 自己的通道，各自在提交侧按类型路由（见 costume_channel）。
ADOPTABLE_ENTITY_TYPES: tuple[str, ...] = (
    "character",
    "scene",
    "prop",
    "costume",
    "actor",
    "product",
)


@dataclass(slots=True)
class AdoptedImage:
    entity_type: str
    entity_id: str
    image_id: int
    file_id: str
    url: str
    is_primary: bool
    name: str
    # ``url`` = **落库后**的可访问地址（资产页/后续出图实际用的就是它）；
    # ``source_url`` = 采纳时传入的来源地址（只作溯源）。两者此前被混成一个字段，
    # 调用方拿 url 去比对参考图会永远对不上。
    source_url: str = ""
    # 落库地址是否**匿名公网可达**：None=未验证（演练模式 / 没有可验证地址）
    url_reachable: bool | None = None
    url_probe: dict[str, Any] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    # 本次采纳**顶掉了哪张旧定版图**（只读摘要：槽位 id / 文件名 / 是否 OSS 公网地址）。
    # 只有「已有定版图 + 调用方显式确认替换」时才有值；没替换过旧定版时为 None。
    replaced_primary: dict[str, Any] | None = None

    def to_read(self) -> dict[str, Any]:
        return {
            "entity_type": self.entity_type,
            "entity_id": self.entity_id,
            "image_id": self.image_id,
            "file_id": self.file_id,
            "url": self.url,
            "source_url": self.source_url,
            "is_primary": self.is_primary,
            "name": self.name,
            "url_reachable": self.url_reachable,
            "url_probe": dict(self.url_probe),
            "warnings": list(self.warnings),
            "replaced_primary": dict(self.replaced_primary) if self.replaced_primary else None,
        }


def reject_placeholder_url(url: str) -> None:
    """拒绝把演练占位地址采纳进正式产物。"""
    text = str(url or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="url 不能为空。")
    for marker in PLACEHOLDER_URL_MARKERS:
        if marker in text:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"这是 DRY_RUN 演练占位地址（命中 {marker}），不能采纳为正式产物。"
                    "请在关闭守卫并确认真实调用后，用真实生成的图片地址采纳。"
                ),
            )


async def _locate_slot(
    db: AsyncSession,
    *,
    spec: Any,
    entity_id: str,
    image_id: int | None,
) -> Any:
    """定位目标槽位；不存在（且不能新建）时返回 ``None``。

    显式 ``image_id`` 时只接受属于该资产的行；否则复用该资产**第一个槽位**（``id asc``），
    没有则返回 ``None`` 交给调用方新建（避免每次采纳都新增一行）。
    """
    if image_id is not None:
        target = await db.get(spec.image_model, image_id)
        if target is None or str(getattr(target, spec.id_field)) != entity_id:
            raise HTTPException(status_code=404, detail=f"{spec.image_model.__name__} not found")
        return target

    parent_field = getattr(spec.image_model, spec.id_field)
    return (
        await db.execute(
            select(spec.image_model)
            .where(parent_field == entity_id)
            .order_by(spec.image_model.id.asc())
            .limit(1)
        )
    ).scalars().first()


async def adopt_generated_image(
    db: AsyncSession,
    *,
    entity_type: str,
    entity_id: str,
    url: str,
    image_id: int | None = None,
    set_primary: bool = False,
    confirm_replace_primary: bool = False,
    name: str | None = None,
    probe: Any = None,
) -> AdoptedImage:
    """把外部生成的图片采纳到资产的某个图片槽位。

    ``image_id`` 为空时：优先复用该资产**已有的第一个槽位**；没有则新建一个槽位。

    ``set_primary`` **默认 False**（此前默认 True）：只有调用方**显式**传 true 才会设为定版。
    原因（用户明确要求「不得静默替换定版」）：不传 ``image_id`` 时复用的是第一个槽位，
    而它常常就是当前定版那一行——旧默认值会让「再采纳一次」静默把定版图换掉。

    ``confirm_replace_primary``：该资产**已有定版图**（``is_primary=True`` 且 ``file_id`` 非空）
    且本次会顶掉它时，必须显式传 true，否则抛结构化 409（``meta.error`` 里带将被替换那张图的
    只读摘要）。判定与摘要在 ``primary_protection`` 里**只有一份实现**；
    判定发生在下载入库**之前**，所以 409 时数据库一行都没改。

    ``probe`` 仅供测试注入（默认走真实的匿名探活实现，见 ``verify_uploaded_url_reachable``）。
    """
    entity_type_norm = normalize_entity_type(entity_type)
    if entity_type_norm not in ADOPTABLE_ENTITY_TYPES:
        raise HTTPException(status_code=400, detail=f"不支持的资产类型：{entity_type}")
    reject_placeholder_url(url)

    spec = entity_spec(entity_type_norm)
    parent = await db.get(spec.model, entity_id)
    if parent is None:
        raise HTTPException(status_code=404, detail=f"{spec.model.__name__} not found")

    # 1) 先定位槽位（原来是下载之后才定位——那样连 404 都会先写一行 files 记录）
    target = await _locate_slot(db, spec=spec, entity_id=entity_id, image_id=image_id)

    # 2) 定版保护：本次会不会顶掉既有定版图？必须在任何写入之前判定。
    #    「没有定版」/「没设版且没碰定版那一行」都照旧放行；直接冲突则 409。
    replaced_primary: PrimaryImageSummary | None = await ensure_primary_not_silently_replaced(
        db,
        image_model=spec.image_model,
        id_field=spec.id_field,
        entity_type=entity_type_norm,
        entity_id=entity_id,
        target_image_id=getattr(target, "id", None),
        becomes_primary=bool(set_primary),
        # 采纳一定会把新图片写进目标槽位（下载 → 新 files 行 → 覆盖 file_id）
        replaces_target_file=True,
        confirm_replace_primary=bool(confirm_replace_primary),
    )

    # 3) 下载 + 入库（长期资产）
    file_item = await create_file_from_url_or_b64(
        db,
        url=url,
        name=name or f"{getattr(parent, 'name', entity_id)} 生成图",
        prefix=f"generated-images/{entity_type_norm}",
    )
    if str(getattr(file_item, "type", "") or "") not in {FileType.image.value, ""}:
        # 采纳进图片槽位的必须是图片
        raise HTTPException(status_code=400, detail="下载到的内容不是图片，无法采纳到图片槽位。")

    if target is None:
        target = spec.image_model(**{spec.id_field: entity_id})
        db.add(target)

    # 4) 写回 file_id（这就是"刷新后仍在"的关键）+ 按需定版
    replaced_in_place = (
        replaced_primary is not None and target.id is not None
        and replaced_primary.image_id == int(target.id)
    )
    # 设版口径（三选一，别把 is_primary 当成三态开关乱写）：
    # - 显式 set_primary=true → 设为定版（并清掉同资产其它行）；
    # - 本次是「确认后原地替换定版图」→ 该槽位**保持**定版（否则一确认反倒把定版弄没了）；
    # - 其余 → **不动** is_primary。旧实现这里无条件写 False，等于「采纳时顺手把定版标记抹掉」，
    #   而 set_primary 默认改成 false 后，那个副作用会变成默认行为。
    keep_primary = bool(set_primary) or replaced_in_place
    target.file_id = file_item.id
    if keep_primary and hasattr(target, "is_primary"):
        target.is_primary = True
    await db.flush()
    await db.refresh(target)

    # 设了定版则清掉同资产其它行（与 entity_images 的互斥口径一致）
    if keep_primary and hasattr(target, "is_primary"):
        parent_field = getattr(spec.image_model, spec.id_field)
        others = (
            await db.execute(select(spec.image_model).where(parent_field == entity_id))
        ).scalars().all()
        for row in others:
            if row.id != target.id and hasattr(row, "is_primary"):
                row.is_primary = False
        await db.flush()
        await db.refresh(target)

    stored_url = str(getattr(file_item, "thumbnail", "") or "")
    # 5) 上传之后**真的验证一次**：这个地址匿名（上游）取不取得到。
    #    只报告、不阻断（图已经存好了），但必须让用户当场看到问题与修法。
    #    实现只有一份：``reference_preflight.verify_uploaded_url_reachable``。
    reachability = await verify_uploaded_url_reachable(
        stored_url,
        label=f"{getattr(parent, 'name', entity_id)} 的采纳图片",
        probe=probe,
    )

    return AdoptedImage(
        entity_type=entity_type_norm,
        entity_id=entity_id,
        image_id=target.id,
        file_id=str(file_item.id),
        # 落库后的真实地址：create_file_from_url_or_b64 把它写在 thumbnail 上
        url=stored_url,
        source_url=str(url),
        is_primary=bool(getattr(target, "is_primary", False)),
        name=str(name or ""),
        url_reachable=reachability.reachable,
        url_probe=dict(reachability.probe),
        warnings=list(reachability.warnings),
        replaced_primary=replaced_primary.to_read() if replaced_primary else None,
    )


__all__ = [
    "ADOPTABLE_ENTITY_TYPES",
    "AdoptedImage",
    "adopt_generated_image",
    "reject_placeholder_url",
    "verify_uploaded_url_reachable",
]
