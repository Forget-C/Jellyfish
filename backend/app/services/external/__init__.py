"""外部平台对接（巨日禄等）。

模块划分：
  * ``jurilu_agent_import``   —— 搬运自中控台的零依赖抓取/解析（纯 stdlib）。
  * ``jurilu_import_plan``    —— 配对计划的纯函数（可沙箱自检）。
  * ``jurilu_import_service`` —— 取数 + 落库编排（依赖 sqlalchemy）。

这里**不做 re-export**，避免 import 本包时被动加载 sqlalchemy。
请显式 ``from app.services.external import jurilu_import_service``。
"""
