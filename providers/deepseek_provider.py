from openai import OpenAI
from config import Config

# DeepSeek exposes an OpenAI-compatible API, so we reuse the OpenAI SDK
# pointed at DeepSeek's base URL.


class DeepSeekProvider:
    def __init__(self):
        self.model = Config.DEEPSEEK_MODEL
        self.client = OpenAI(api_key=Config.DEEPSEEK_API_KEY, base_url=Config.DEEPSEEK_BASE_URL)

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
