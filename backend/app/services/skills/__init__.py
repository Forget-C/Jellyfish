"""导演 Skill（一键技能）与提示词导出。

包内划分（刻意让 ``__init__`` 保持零依赖）：
  - ``prompt_skill_registry``：Skill 清单与提示词拼装口径（纯标准库）
  - ``quick_skill_text``      ：交付文本口径（纯标准库）
  - ``quick_skill_service``   ：取数、调用 LLM、写回镜头（依赖 sqlalchemy/fastapi）

**本文件不要 import 上面任何子模块**——否则沙箱内 import 本包会连带拉起
sqlalchemy 被信号杀掉，纯逻辑自检就跑不起来了。
"""
