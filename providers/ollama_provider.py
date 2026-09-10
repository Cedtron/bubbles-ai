"""
Talks to a local Ollama server (https://ollama.com) - the easiest way
to run Hugging Face models offline without compiling anything: pull a
model into Ollama (it can import GGUF files directly, or pull by
name) and Ollama exposes an OpenAI-compatible /v1 endpoint that we
reuse the OpenAI SDK against, same trick as the OmniRoute provider.
"""

from openai import OpenAI
from config import Config


class OllamaProvider:
    def __init__(self):
        self.model = Config.OLLAMA_MODEL
        self.client = OpenAI(api_key="ollama", base_url=Config.OLLAMA_BASE_URL)

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
