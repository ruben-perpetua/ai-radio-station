"""
Module 6: MCP — Model Context Protocol
========================================
A standardized framework that connects multiple AI agents and tools,
enabling seamless communication, tool discovery, and shared context.

The MCPRegistry acts as the central hub where:
  - Tools are registered with structured schemas
  - Agents discover capabilities at runtime
  - All executions are logged for observability
  - Context is shared across agents transparently
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional


# ── Data contracts ────────────────────────────────────────────────────────────

@dataclass
class ToolSchema:
    """Defines the public interface contract for an MCP tool."""
    name: str
    description: str
    parameters: Dict[str, Any]
    returns: str
    tags: List[str] = field(default_factory=list)

    def to_prompt_str(self) -> str:
        """Serialises the schema so it can be injected into an LLM prompt."""
        params = json.dumps(self.parameters, indent=2)
        return (
            f"Tool      : {self.name}\n"
            f"Description: {self.description}\n"
            f"Parameters : {params}\n"
            f"Returns    : {self.returns}"
        )


@dataclass
class ToolCall:
    """Immutable record of a single tool invocation — used for tracing."""
    tool_name: str
    inputs: Dict[str, Any]
    output: Any
    duration_ms: float
    success: bool
    error: Optional[str] = None


# ── Core registry ─────────────────────────────────────────────────────────────

class MCPTool:
    """Wraps a Python callable with its MCP schema."""

    def __init__(self, schema: ToolSchema, handler: Callable):
        self.schema = schema
        self._handler = handler

    def execute(self, **kwargs) -> Any:
        return self._handler(**kwargs)


class MCPRegistry:
    """
    Central MCP Tool Registry.

    Implements the Model Context Protocol pattern:
      1. Developers register tools using the @registry.tool() decorator.
      2. Agents call registry.describe_tools() to get the tool catalogue.
      3. Agents call registry.execute(tool_name, **kwargs) to run a tool.
      4. All calls are logged; call registry.get_stats() for observability.

    Example
    -------
    registry = MCPRegistry("my-server")

    @registry.tool(
        name="search_web",
        description="Search the internet",
        parameters={"query": {"type": "string"}},
        returns="List[str]",
    )
    def search_web(query: str) -> list:
        ...
    """

    def __init__(self, server_name: str = "ai-tech-radio"):
        self.server_name = server_name
        self._tools: Dict[str, MCPTool] = {}
        self._call_log: List[ToolCall] = []

    # ── Registration ──────────────────────────────────────────────────────────

    def tool(
        self,
        name: str,
        description: str,
        parameters: Dict[str, Any],
        returns: str = "Any",
        tags: Optional[List[str]] = None,
    ) -> Callable:
        """Decorator that registers the wrapped function as an MCP tool."""
        def decorator(func: Callable) -> Callable:
            schema = ToolSchema(
                name=name,
                description=description,
                parameters=parameters,
                returns=returns,
                tags=tags or [],
            )
            self._tools[name] = MCPTool(schema, func)
            return func
        return decorator

    # ── Discovery ─────────────────────────────────────────────────────────────

    def list_tools(self) -> List[ToolSchema]:
        return [t.schema for t in self._tools.values()]

    def describe_tools(self) -> str:
        """Returns all tool schemas formatted for LLM context injection."""
        return "\n\n".join(t.schema.to_prompt_str() for t in self._tools.values())

    def get_tool(self, name: str) -> Optional[MCPTool]:
        return self._tools.get(name)

    # ── Execution ─────────────────────────────────────────────────────────────

    def execute(self, tool_name: str, **kwargs) -> Any:
        """Execute a registered tool and record the invocation."""
        tool = self.get_tool(tool_name)
        if not tool:
            available = list(self._tools.keys())
            raise ValueError(f"Unknown tool '{tool_name}'. Available: {available}")

        t0 = time.perf_counter()
        try:
            result = tool.execute(**kwargs)
            self._call_log.append(ToolCall(
                tool_name=tool_name,
                inputs=kwargs,
                output=result,
                duration_ms=(time.perf_counter() - t0) * 1000,
                success=True,
            ))
            return result
        except Exception as exc:
            self._call_log.append(ToolCall(
                tool_name=tool_name,
                inputs=kwargs,
                output=None,
                duration_ms=(time.perf_counter() - t0) * 1000,
                success=False,
                error=str(exc),
            ))
            raise

    # ── Observability ─────────────────────────────────────────────────────────

    def get_stats(self) -> Dict[str, Any]:
        if not self._call_log:
            return {"total_calls": 0}
        success = [c for c in self._call_log if c.success]
        return {
            "total_calls": len(self._call_log),
            "successful": len(success),
            "failed": len(self._call_log) - len(success),
            "success_rate": len(success) / len(self._call_log),
            "avg_duration_ms": round(
                sum(c.duration_ms for c in self._call_log) / len(self._call_log), 2
            ),
            "tools_used": list({c.tool_name for c in self._call_log}),
        }

    def __repr__(self) -> str:
        return (
            f"MCPRegistry(server={self.server_name!r}, "
            f"tools={list(self._tools.keys())})"
        )
