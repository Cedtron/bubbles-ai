"""
Shared data structures used across agents, providers, and memory.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


@dataclass
class Message:
    role: str  # "user" | "assistant" | "system"
    content: str
    timestamp: str = field(default_factory=lambda: datetime.utcnow().isoformat())

    def to_dict(self) -> dict:
        return {"role": self.role, "content": self.content, "timestamp": self.timestamp}


@dataclass
class AgentResponse:
    agent: str
    output: str
    model: Optional[str] = None
    provider: Optional[str] = None
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0

    def to_dict(self) -> dict:
        return {
            "agent": self.agent,
            "output": self.output,
            "model": self.model,
            "provider": self.provider,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cost_usd": self.cost_usd,
        }


# Known models per provider - used for validation / defaults elsewhere
PROVIDER_MODELS = {
    "openai": ["gpt-4o", "gpt-4o-mini"],
    "anthropic": ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022"],
    "deepseek": ["deepseek-chat", "deepseek-coder"],
    "kimi": ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
    "nova": ["amazon.nova-lite-v1:0", "amazon.nova-pro-v1:0"],
}
