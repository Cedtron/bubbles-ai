import os
from dotenv import load_dotenv

from router import ModelRouter
from utils.logger import get_logger

# Load environment variables
load_dotenv()

logger = get_logger(__name__)


class CodingAgentApp:
    def __init__(self):
        self.router = ModelRouter()
        logger.info("🚀 Coding Agent App initialized")

    def run(self):
        print("=== Bubbles AI (CLI mode) ===")
        print("Tip: run `python main_gui.py` for the desktop app instead.")
        print("Type 'exit' to quit\n")

        while True:
            user_input = input(">>> ")

            if user_input.lower() in ["exit", "quit"]:
                print("👋 Goodbye!")
                break

            try:
                response = self.router.handle_request(user_input)
                print("\n🤖 Response:\n")
                print(response)
                print("\n" + "-" * 50)

            except Exception as e:
                logger.error(f"Error: {str(e)}")
                print("❌ Something went wrong:", str(e))


if __name__ == "__main__":
    app = CodingAgentApp()
    app.run()