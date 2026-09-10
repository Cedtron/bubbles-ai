"""
Very rough cost estimation for LLM calls.

Prices are USD per 1M tokens and are approximate / may drift out of
date - treat this as a ballpark estimator, not a billing source of truth.
"""

from utils.logger import get_logger

logger = get_logger(__name__)

# (input_price_per_1m, output_price_per_1m)
PRICING = {
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-4o": (2.50, 10.00),
    "claude-3-5-sonnet-20241022": (3.00, 15.00),
    "claude-3-5-haiku-20241022": (0.80, 4.00),
    "deepseek-chat": (0.27, 1.10),
    "moonshot-v1-8k": (0.20, 2.00),
    "amazon.nova-lite-v1:0": (0.06, 0.24),
    "amazon.nova-pro-v1:0": (0.80, 3.20),
}

DEFAULT_PRICING = (1.00, 3.00)  # fallback if model isn't in the table


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """
    Returns an estimated USD cost for a single request.
    """
    input_price, output_price = PRICING.get(model, DEFAULT_PRICING)

    cost = (input_tokens / 1_000_000) * input_price
    cost += (output_tokens / 1_000_000) * output_price

    return round(cost, 6)


class CostTracker:
    """
    Accumulates cost across a session.
    """

    def __init__(self):
        self.total_cost = 0.0
        self.total_input_tokens = 0
        self.total_output_tokens = 0

    def add(self, model: str, input_tokens: int, output_tokens: int):
        cost = estimate_cost(model, input_tokens, output_tokens)
        self.total_cost += cost
        self.total_input_tokens += input_tokens
        self.total_output_tokens += output_tokens

        logger.info(
            f"💰 +${cost:.6f} ({input_tokens} in / {output_tokens} out) "
            f"| session total: ${self.total_cost:.6f}"
        )
        return cost

    def summary(self) -> dict:
        return {
            "total_cost_usd": round(self.total_cost, 6),
            "total_input_tokens": self.total_input_tokens,
            "total_output_tokens": self.total_output_tokens,
        }
