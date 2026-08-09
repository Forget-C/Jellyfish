"""CAS 生产流水线（Sprint 4 MVP 骨架）。

只包含确定性、可追溯的端到端生产骨架：ProductionJob/Shot/Artifact 持久化、
供应商边界与 Mock 实现、确定性提示词、ArtifactManager、编排器与 manifest。
本冲刺不接入任何真实 AI/FFmpeg 供应商，不使用 Celery/Redis/LLM。
"""
