"""
Zero-config provider that always responds - no API key, no local
model, no server needed. Used as the last resort in the fallback
chain so the chat/tools/sessions UI is testable immediately, even
before you've set up any real provider.

Responses are canned/templated, not actually intelligent - this is
for exercising the app, not for real answers.
"""

import textwrap


class DemoProvider:
    def __init__(self):
        self.model = "demo"

    def generate(self, prompt: str, system: str = None) -> str:
        snippet = prompt.strip().splitlines()[-1] if prompt.strip() else ""
        snippet = textwrap.shorten(snippet, width=120, placeholder="…")

        return (
            "🫧 **Demo mode** - no real AI provider is configured yet, so this is a "
            "canned reply just so you can see the app working end to end.\n\n"
            f'You said: "{snippet}"\n\n'
            "To get real answers: open the **AI Brain** tab and either add an API key "
            "(OpenAI/Anthropic/DeepSeek/Kimi), point it at a local Ollama server, "
            "or load an offline .gguf model file - then hit Save."
        )
