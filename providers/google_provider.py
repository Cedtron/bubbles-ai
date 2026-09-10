"""
Google AI (Gemini) provider - calls the Generative Language API
directly over REST, so no extra SDK dependency is needed (just
`requests`, which is already required).
"""

import requests

from config import Config

API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"


class GoogleProvider:
    def __init__(self):
        self.model = Config.GOOGLE_MODEL
        self.api_key = Config.GOOGLE_API_KEY
        if not self.api_key:
            raise ValueError("No Google API key set. Add one in the AI Brain tab.")

    def generate(self, prompt: str, system: str = None) -> str:
        url = f"{API_BASE}/{self.model}:generateContent?key={self.api_key}"

        payload = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": Config.TEMPERATURE,
                "maxOutputTokens": Config.MAX_TOKENS,
            },
        }
        if system:
            payload["systemInstruction"] = {"parts": [{"text": system}]}

        response = requests.post(url, json=payload, timeout=60)
        response.raise_for_status()
        data = response.json()

        candidates = data.get("candidates") or []
        if not candidates:
            block_reason = data.get("promptFeedback", {}).get("blockReason")
            raise RuntimeError(f"Gemini returned no candidates (blockReason={block_reason})")

        parts = candidates[0].get("content", {}).get("parts", [])
        return "".join(p.get("text", "") for p in parts)
