from openai import OpenAI
from config import Config


class OpenAIProvider:
    def __init__(self):
        self.model = Config.DEFAULT_MODEL
        self.client = OpenAI(api_key=Config.OPENAI_API_KEY)

    def generate(self, prompt: str, system: str = None):
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
