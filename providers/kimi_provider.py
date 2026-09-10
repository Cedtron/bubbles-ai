from openai import OpenAI
from config import Config

# Kimi (Moonshot AI) also exposes an OpenAI-compatible API.


class KimiProvider:
    def __init__(self):
        self.model = Config.KIMI_MODEL
        self.client = OpenAI(api_key=Config.KIMI_API_KEY, base_url=Config.KIMI_BASE_URL)

    def generate(self, prompt: str, system: str = None) -> str:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        response = self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=Config.TEMPERATURE,
            max_tokens=Config.MAX_TOKENS,
        )

        return response.choices[0].message.content
