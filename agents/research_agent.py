from agents.base_agent import BaseAgent
from tools.search import web_search
from utils.logger import get_logger

logger = get_logger(__name__)


class ResearchAgent(BaseAgent):
    name = "research_agent"
    prompt_file = "research.txt"

    def gather_context(self, user_input: str) -> str:
        """Pull in lightweight web search results to ground the answer."""
        try:
            results = web_search(user_input, max_results=5)
            if not results:
                return ""
            lines = [f"- {r['title']}: {r['snippet']} ({r['url']})" for r in results]
            return "Search results:\n" + "\n".join(lines)
        except Exception as e:
            logger.warning(f"Web search unavailable, continuing without it: {e}")
            return ""
