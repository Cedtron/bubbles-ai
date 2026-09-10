import importlib

from agents.coding_agent import CodingAgent
from agents.debug_agent import DebugAgent
from agents.planning_agent import PlanningAgent

from utils.logger import get_logger

logger = get_logger(__name__)


class ModelRouter:
    def __init__(self):
        # Eagerly instantiate light-weight agents; delay heavy ones (e.g. ResearchAgent)
        self.agents = {
            "coding": CodingAgent(),
            "debug": DebugAgent(),
            "planning": PlanningAgent(),
        }

        # Mapping of agent name -> module:Class for lazy loading
        self._lazy_agents = {
            "research": "agents.research_agent:ResearchAgent",
        }

        logger.info("🧠 Router initialized with agents")

    def _load_agent(self, name: str):
        """Dynamically import and instantiate an agent by name."""
        spec = self._lazy_agents.get(name)
        if not spec:
            return None
        module_path, class_name = spec.split(":")
        module = importlib.import_module(module_path)
        cls = getattr(module, class_name)
        agent = cls()
        self.agents[name] = agent
        logger.info(f"🧠 Lazily loaded agent: {name}")
        return agent

    def handle_request(self, user_input: str, enabled_tools: list = None, agent_override: str = None):
        """
        Main entry point from app.py (and the GUI).
        `agent_override` skips auto-detection/`/command` parsing and
        forces a specific agent - used by the GUI's agent dropdown.
        """

        if agent_override and agent_override != "auto":
            agent_type, cleaned_input = agent_override, user_input
        else:
            # 1. Check for manual override
            agent_type, cleaned_input = self._check_manual_override(user_input)

            # 2. Auto-detect if not specified
            if not agent_type:
                agent_type = self._auto_detect_agent(cleaned_input)

        logger.info(f"➡️ Routing to: {agent_type}")

        agent = self.agents.get(agent_type)

        if not agent and agent_type in self._lazy_agents:
            agent = self._load_agent(agent_type)

        if not agent:
            raise ValueError(f"Unknown agent type: {agent_type}")

        return agent.run(cleaned_input, enabled_tools=enabled_tools)

    # ------------------------------------

    def _check_manual_override(self, text: str):
        """
        Allows commands like:
        /code build login page
        /debug fix this error
        """

        if text.startswith("/"):
            parts = text.split(" ", 1)
            command = parts[0][1:]  # remove "/"
            content = parts[1] if len(parts) > 1 else ""

            if command in self.agents:
                return command, content

        return None, text

    # ------------------------------------

    def _auto_detect_agent(self, text: str):
        """
        Simple keyword-based detection (can upgrade to AI later)
        """

        text_lower = text.lower()

        if any(word in text_lower for word in ["error", "bug", "fix", "traceback"]):
            return "debug"

        elif any(word in text_lower for word in ["plan", "architecture", "design"]):
            return "planning"

        elif any(word in text_lower for word in ["research", "find", "compare"]):
            return "research"

        else:
            return "coding"