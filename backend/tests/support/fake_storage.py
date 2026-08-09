"""内存对象存储替身（测试用）。

用于替换 ``app.core.storage`` 的模块级函数，使字幕产物相关测试无需真实 S3/RustFS。
刻意保留真实模块的关键行为：
- ``get_file_info`` 对不存在的 key 抛异常（生产用它判断对象是否已存在）；
- ``upload_file`` 覆盖同名 key（确定性键的「覆盖而非新增」语义）；
- ``delete_file`` 对不存在的 key 静默通过（补偿清理可重复执行）。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class FakeStorage:
    """记录所有对象与调用次数的内存存储。"""

    objects: dict[str, bytes] = field(default_factory=dict)
    upload_calls: list[str] = field(default_factory=list)
    delete_calls: list[str] = field(default_factory=list)
    #: 设为某个 key 时，对该 key 的上传会抛错（用于测试补偿清理）。
    fail_upload_key: str | None = None

    async def upload_file(
        self, *, key: str, data: bytes, content_type: str | None = None, **_: Any
    ) -> dict[str, Any]:
        """写入（或覆盖）一个对象。"""
        self.upload_calls.append(key)
        if self.fail_upload_key is not None and key == self.fail_upload_key:
            raise RuntimeError(f"injected upload failure for {key}")
        self.objects[key] = bytes(data)
        return {"key": key, "size": len(data), "content_type": content_type}

    async def download_file(self, *, key: str) -> bytes:
        """读取对象；不存在则抛错。"""
        if key not in self.objects:
            raise FileNotFoundError(key)
        return self.objects[key]

    async def get_file_info(self, *, key: str) -> dict[str, Any]:
        """对象元信息；不存在则抛错（与真实实现一致）。"""
        if key not in self.objects:
            raise FileNotFoundError(key)
        return {"key": key, "size": len(self.objects[key])}

    async def delete_file(self, *, key: str) -> None:
        """删除对象；不存在也不报错。"""
        self.delete_calls.append(key)
        self.objects.pop(key, None)

    def install(self, monkeypatch, module) -> "FakeStorage":
        """把本替身的方法打到 ``app.core.storage`` 模块上。"""
        monkeypatch.setattr(module, "upload_file", self.upload_file)
        monkeypatch.setattr(module, "download_file", self.download_file)
        monkeypatch.setattr(module, "get_file_info", self.get_file_info)
        monkeypatch.setattr(module, "delete_file", self.delete_file)
        return self


__all__ = ["FakeStorage"]
