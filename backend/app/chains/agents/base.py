"""通用 Agent 基类：固化 PromptTemplate + 输出模型，调用 LLM 并解析输出。"""

from __future__ import annotations

import ast
import json
import re
from abc import ABC, abstractmethod
from typing import Any, Generic, TypeVar, cast

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.prompts import PromptTemplate
from langchain_core.runnables import Runnable, RunnableLambda
from pydantic import BaseModel

STRUCTURED_OUTPUT_METHOD = "function_calling"

T = TypeVar("T", bound=BaseModel)


def _extract_json_from_text(raw: str) -> str:
    """从 LLM 原始输出中剥离 markdown 代码块并提取 JSON 字符串。"""
    text = raw.strip()
    match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
    if match:
        return match.group(1).strip()
    return text


def _extract_first_json_object(text: str) -> str | None:
    """尽量从文本中提取第一个 JSON 对象/数组片段。"""

    s = text.strip()
    for opener, closer in (("{", "}"), ("[", "]")):
        start = s.find(opener)
        end = s.rfind(closer)
        if start != -1 and end != -1 and end > start:
            return s[start : end + 1].strip()
    return None


def _quote_unquoted_object_keys(text: str) -> str:
    """为常见 JSON-like 输出补齐未加引号的对象键名。"""
    pattern = re.compile(r'([{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)(\s*:)')
    return pattern.sub(r'\1"\2"\3', text)


def _replace_json_literals_for_python(text: str) -> str:
    """将 JSON 字面量替换为 Python 字面量，便于 ast.literal_eval 解析。"""
    text = re.sub(r"(?<=[:\[,{\s])true(?=[,\]}\s])", "True", text)
    text = re.sub(r"(?<=[:\[,{\s])false(?=[,\]}\s])", "False", text)
    text = re.sub(r"(?<=[:\[,{\s])null(?=[,\]}\s])", "None", text)
    return text


def _repair_json_like(text: str) -> str:
    """修复 LLM 常见 JSON 格式问题。"""
    repaired = text.strip()
    repaired = repaired.replace("“", '"').replace("”", '"').replace("‘", "'").replace("’", "'")
    repaired = _quote_unquoted_object_keys(repaired)
    # 去除尾逗号：{"a":1,} / [1,2,]
    repaired = re.sub(r",\s*([}\]])", r"\1", repaired)
    return repaired


def _parse_python_call_kwargs(text: str) -> dict[str, Any] | None:
    """解析 `Foo(a=1, b='x')` / `dict(a=1)` 这类 kwargs 风格输出。"""
    try:
        expr = ast.parse(text, mode="eval")
    except Exception:
        return None
    body = expr.body
    if not isinstance(body, ast.Call) or body.args:
        return None

    parsed: dict[str, Any] = {}
    for kw in body.keywords:
        if kw.arg is None:
            return None
        try:
            parsed[kw.arg] = ast.literal_eval(kw.value)
        except Exception:
            return None
    return parsed


def _load_json_like(text: str) -> Any:
    """尽量解析 LLM 返回的 JSON / JSON-like 文本。"""

    candidates: list[str] = []
    stripped = text.strip()
    if stripped:
        candidates.append(stripped)
    first_obj = _extract_first_json_object(stripped)
    if first_obj and first_obj != stripped:
        candidates.append(first_obj)

    last_error: Exception | None = None
    preferred_error: Exception | None = None
    for candidate in candidates:
        try:
            return json.loads(candidate)
        except Exception as e:
            last_error = e
            if preferred_error is None:
                preferred_error = e

        repaired = _repair_json_like(candidate)
        try:
            return json.loads(repaired)
        except Exception as e:
            last_error = e
            if preferred_error is None:
                preferred_error = e

        python_like = _replace_json_literals_for_python(repaired)
        try:
            return ast.literal_eval(python_like)
        except Exception as e:
            last_error = e

        call_kwargs = _parse_python_call_kwargs(python_like)
        if call_kwargs is not None:
            return call_kwargs

    if preferred_error is not None:
        raise ValueError("Failed to parse LLM output as JSON-like text") from preferred_error
    if last_error is not None:
        raise ValueError("Failed to parse LLM output as JSON-like text") from last_error
    raise ValueError("Empty output from LLM")


def _thinking_extra_body(model: BaseChatModel, enable_thinking: bool) -> dict[str, Any] | None:
    """Extra body toggling Qwen-style thinking for OpenAI-compatible endpoints.

    `enable_thinking` is a DashScope extension; the official OpenAI API rejects
    it as an unknown parameter, so nothing is bound for api.openai.com targets.
    """
    base = str(getattr(model, "openai_api_base", "") or "").rstrip("/")
    if not base or "api.openai.com" in base:
        return None
    return {"enable_thinking": enable_thinking}


class AgentBase(ABC, Generic[T]):
    """通用 Agent 基类：子类固化 prompt_template 与 output_model。"""

    enable_thinking: bool = True

    def __init__(
        self,
        model: BaseChatModel,
        *,
        structured_output_method: str = STRUCTURED_OUTPUT_METHOD,
        agent_kwargs: dict[str, Any] | None = None,
    ) -> None:
        self._model = model
        thinking_body = _thinking_extra_body(model, self.enable_thinking)
        if thinking_body is not None:
            self._model.bind(extra_body=thinking_body)
        self._structured_output_method = structured_output_method
        self._agent_kwargs = dict(agent_kwargs or {})
        self._structured_chain: Runnable | None = None

    @property
    @abstractmethod
    def prompt_template(self) -> PromptTemplate:
        ...

    @property
    @abstractmethod
    def output_model(self) -> type[T]:
        ...

    @property
    def system_prompt(self) -> str:
        """子类可覆盖：系统提示词（作为 system message / 高优先级指令）。"""
        return ""

    def _normalize(self, data: dict[str, Any]) -> dict[str, Any]:
        """子类可覆盖：将 LLM 返回的 dict 规范化为 output_model 所需结构。默认 identity。"""
        return data

    def render_prompt(self, **kwargs: Any) -> str:
        """渲染完整提示词（变量填充后的最终字符串）。"""

        prompt = self.prompt_template
        try:
            user_prompt = prompt.format(**kwargs)
        except KeyError as e:
            missing = str(e).strip("'")
            raise ValueError(
                f"render_prompt 缺少变量: {missing}. "
                f"需要: {list(prompt.input_variables)}"
            ) from e

        sys = (self.system_prompt or "").strip()
        if not sys:
            return user_prompt
        return f"{sys}\n\n{user_prompt}".strip()

    def _render_user_prompt(self, **kwargs: Any) -> str:
        """仅渲染用户提示词（不包含 system_prompt）。"""
        prompt = self.prompt_template
        try:
            return prompt.format(**kwargs)
        except KeyError as e:
            missing = str(e).strip("'")
            raise ValueError(
                f"render_prompt 缺少变量: {missing}. "
                f"需要: {list(prompt.input_variables)}"
            ) from e

    def _as_messages_input(self, **kwargs: Any) -> dict[str, Any]:
        """将 kwargs 渲染为 LangChain agent 所需的 messages 输入形状。"""
        return {
            "messages": [
                {
                    "role": "user",
                    "content": self._render_user_prompt(**kwargs),
                }
            ]
        }

    @staticmethod
    def _last_message_content(state: Any) -> str:
        """
        从 create_agent 返回的 state 中提取最后一条消息的 content。
        若不是标准 state，则尽量退化为 str(state)。
        """
        if isinstance(state, dict):
            messages = state.get("messages")
            if isinstance(messages, list) and messages:
                last = messages[-1]
                # 兼容 dict message 与 BaseMessage
                if isinstance(last, dict):
                    content = last.get("content")
                    if content is not None:
                        return str(content)
                if hasattr(last, "content"):
                    return str(getattr(last, "content"))
        if hasattr(state, "content"):
            return str(getattr(state, "content"))
        return str(state)

    def _extract_structured_response(self, state: Any) -> Any:
        """
        从 create_agent 返回的 state 中提取 structured_response。
        LangChain 文档约定：structured response 放在 state['structured_response']。
        """
        if isinstance(state, dict) and "structured_response" in state:
            return state.get("structured_response")
        return state

    def create_agent(self, *, structured_output: type[BaseModel] | None = None) -> Runnable:
        """
        生成可执行 runnable：
        - 优先使用 `langchain.agents.create_agent`，把 `system_prompt` 作为系统提示词传入
        - structured_output 不为 None 时，通过 `response_format=ToolStrategy(structured_output)` 让模型输出结构化结果
        - 若当前环境未安装 langchain，则降级为：RunnableLambda(render_user_prompt) | model（structured 时用 with_structured_output）
        """

        # --- preferred path: langchain create_agent + ToolStrategy ---
        try:
            from langchain.agents import create_agent as _lc_create_agent  # type: ignore

            kwargs = dict(self._agent_kwargs)
            if structured_output is not None:
                kwargs["response_format"] = structured_output
            agent = _lc_create_agent(
                model=self._model,
                system_prompt=(self.system_prompt or ""),
                **kwargs,
            )
            # create_agent 接受 {"messages": [...]} 作为输入
            return RunnableLambda(lambda inputs: self._as_messages_input(**inputs)) | cast(Runnable, agent)
        except Exception:
            # --- fallback path: no langchain available ---
            llm: Runnable = cast(Runnable, self._model)
            if structured_output is not None:
                with_structured = getattr(self._model, "with_structured_output", None)
                if callable(with_structured):
                    try:
                        llm = cast(
                            Runnable,
                            with_structured(
                                structured_output,
                                method=self._structured_output_method,
                            ),
                        )
                    except NotImplementedError:
                        # 某些 BaseChatModel 子类（如测试 mock）不实现 with_structured_output；退回原始输出解析。
                        pass
            return RunnableLambda(lambda inputs: self._render_user_prompt(**inputs)) | llm

    def _build_structured_chain(self) -> Runnable | None:
        """构建 structured output chain（优先 ToolStrategy；缺 langchain 时退回 with_structured_output）。"""
        return self.create_agent(structured_output=self.output_model)

    def _get_structured_chain(self) -> Runnable | None:
        if self._structured_chain is not None:
            return self._structured_chain
        self._structured_chain = self._build_structured_chain()
        return self._structured_chain

    def run(self, **kwargs: Any) -> str:
        """调用 agent，返回原始字符串（通常为 JSON）。"""
        chain: Runnable = self.create_agent()
        result = chain.invoke(kwargs)
        return self._last_message_content(result)

    async def arun(self, **kwargs: Any) -> str:
        """异步调用 agent。"""
        chain: Runnable = self.create_agent()
        result = await chain.ainvoke(kwargs)
        return self._last_message_content(result)

    def format_output(self, raw: str) -> T:
        """将 agent 原始输出解析为结构化结果（JSON → 规范化 → Pydantic）。"""
        output_model = self.output_model
        json_str = _extract_json_from_text(raw)
        data = _load_json_like(json_str)
        if isinstance(data, dict):
            data = self._normalize(data)
        return output_model.model_validate(data)

    def extract(self, **kwargs: Any) -> T:
        """执行：优先 with_structured_output，否则 run + format_output。"""
        chain = self._get_structured_chain()
        if chain is not None:
            try:
                state = chain.invoke(kwargs)
                result = self._extract_structured_response(state)
                if isinstance(result, self.output_model):
                    return cast(T, result)
                if isinstance(result, dict):
                    data = self._normalize(result)
                    return self.output_model.model_validate(data)
            except Exception:
                pass
        return self.format_output(self.run(**kwargs))

    async def aextract(self, **kwargs: Any) -> T:
        """异步执行。"""
        chain = self._get_structured_chain()
        if chain is not None:
            try:
                state = await chain.ainvoke(kwargs)
                result = self._extract_structured_response(state)
                if isinstance(result, self.output_model):
                    return cast(T, result)
                if isinstance(result, dict):
                    data = self._normalize(result)
                    return self.output_model.model_validate(data)
            except Exception:
                pass
        return self.format_output(await self.arun(**kwargs))
