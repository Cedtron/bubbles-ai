from anthropic import Anthropic
from config import Config


class AnthropicProvider:
    def __init__(self):
        self.model = Config.ANTHROPIC_MODEL
        self.client = Anthropic(api_key=Config.ANTHROPIC_API_KEY)

    def generate(self, prompt: str, system: str = None) -> str:
        response = self.client.messages.create(
            model=self.model,
            max_tokens=Config.MAX_TOKENS,
            temperature=Config.TEMPERATURE,
            system=system or "You are a helpful coding assistant.",
            messages=[
                {"role": "user", "content": prompt}
            ],
        )

        return "".join(block.text for block in response.content if block.type == "text")
