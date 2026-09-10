"""
Lightweight web search tool.

Uses DuckDuckGo's HTML endpoint (no API key needed) so ResearchAgent
has something to ground answers in out of the box. Swap this for a
proper search API (Bing, Serper, Tavily, etc.) for production use -
scraping is best-effort and may break if DuckDuckGo changes markup.
"""

import requests
from bs4 import BeautifulSoup

from utils.logger import get_logger

logger = get_logger(__name__)

SEARCH_URL = "https://html.duckduckgo.com/html/"


def web_search(query: str, max_results: int = 5) -> list:
    try:
        response = requests.post(
            SEARCH_URL,
            data={"q": query},
            headers={"User-Agent": "Mozilla/5.0 (compatible; AgentCode/1.0)"},
            timeout=10,
        )
        response.raise_for_status()
    except requests.RequestException as e:
        logger.warning(f"Web search request failed: {e}")
        return []

    soup = BeautifulSoup(response.text, "html.parser")
    results = []

    for result in soup.select(".result")[:max_results]:
        title_el = result.select_one(".result__title")
        snippet_el = result.select_one(".result__snippet")
        link_el = result.select_one(".result__url")

        if not title_el:
            continue

        results.append({
            "title": title_el.get_text(strip=True),
            "snippet": snippet_el.get_text(strip=True) if snippet_el else "",
            "url": link_el.get_text(strip=True) if link_el else "",
        })

    return results
