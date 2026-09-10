"""
Shared logic for all agents: load a system prompt, optionally gather
extra context, call the provider (with fallback), track token/cost,
and - if tools are enabled - run a small tool-use loop so the model
can call a tool, see the result, and respond again before finishing.
"""

from utils.logger import get_logger
from utils.tokenizer import count_tokens
from utils.cost import estimate_cost
from prompts.prompts_loader import load_prompt
from providers import generate_with_fallback
from tools.registry import build_tool_prompt, parse_tool_call, execute_tool

logger = get_logger(__name__)

MAX_TOOL_ITERATIONS = 4


class BaseAgent:
    name = "base_agent"
    prompt_file = None  # e.g. "coding.txt" - subclasses set this

    def __init__(self, provider_name: str = None):
        self.system_prompt = load_prompt(self.prompt_file) if self.prompt_file else ""
        self.preferred_provider = provider_name

    # ------------------------------------

    def run(self, user_input: str, enabled_tools: list = None):
        """
        Main agent execution. If `enabled_tools` is a non-empty list of
        tool names, the model may call one via a fenced ```tool block;
        the tool is executed and the result fed back for up to
        MAX_TOOL_ITERATIONS rounds before returning the final answer.
        """
        logger.info(f"🤖 {self.name} started")

        context = self.gather_context(user_input)
        prompt = self.think(user_input, context)

        system_prompt = self.system_prompt
        if enabled_tools:
            system_prompt = system_prompt + "\n\n" + build_tool_prompt(enabled_tools)

        transcript = ""
        response = ""
        iterations = MAX_TOOL_ITERATIONS if enabled_tools else 1

        for i in range(iterations):
            response = self.act(prompt + transcript, system_prompt)

            if not enabled_tools:
                break

            call = parse_tool_call(response)
            if not call:
                break

            logger.info(f"🔧 Tool call: {call.get('name')}({call.get('args')})")
            result = execute_tool(call, enabled_tools)
            transcript += (
                f"\n\nYou called tool `{call.get('name')}`. Result:\n{result}\n\n"
                f"Continue: give your final answer, or call another tool if needed."
            )

        return self.observe(response)

    # ------------------------------------

    def gather_context(self, user_input: str) -> str:
        """Override in subclasses that need extra context (e.g. web search)."""
        return ""

    def think(self, user_input: str, context: str = "") -> str:
        context_block = f"\n\n{context}" if context else ""
        return f"User request:\n{user_input}{context_block}"

    def act(self, prompt: str, system_prompt: str) -> str:
        try:
            provider, response = generate_with_fallback(
                prompt, system=system_prompt, preferred=self.preferred_provider
            )
        except Exception as e:
            logger.error(f"All providers failed: {e}")
            return f"❌ Error generating response: {e}"

        in_tokens = count_tokens(system_prompt + prompt, model=provider.model)
        out_tokens = count_tokens(response, model=provider.model)
        cost = estimate_cost(provider.model, in_tokens, out_tokens)
        logger.info(f"💰 via {provider.name} | ~${cost:.6f} ({in_tokens} in / {out_tokens} out)")

        return response

    def observe(self, response: str) -> str:
        return response
