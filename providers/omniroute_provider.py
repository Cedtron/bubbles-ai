from openai import OpenAI
from config import Config

# OmniRoute (https://github.com/diegosouzapw/OmniRoute) is a self-hosted
# local AI gateway - it exposes a single OpenAI-compatible endpoint
# (default http://localhost:20128/v1) and does its own multi-provider
# routing/fallback behind that. From this app's point of view it's just
# another OpenAI-compatible target, so we reuse the OpenAI SDK.
#
# It typically doesn't require a real API key when running locally -
# any non-empty string works unless you've configured auth on the gateway.


class OmniRouteProvider:
    def __init__(self):
        self.model = Config.OMNIROUTE_MODEL
        self.client = OpenAI(
            api_key=Config.OMNIROUTE_API_KEY or "local",
            base_url=Config.OMNIROUTE_BASE_URL,
        )

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
