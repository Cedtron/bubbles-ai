"""
Simple page-fetching tool ("browser" in the lightweight sense - no
JS rendering). Fetches a URL and extracts readable text, useful for
letting ResearchAgent read an actual page instead of just a snippet.

For full JS-rendered pages, swap this for Playwright/Selenium.
"""

import requests
from bs4 import BeautifulSoup

from utils.logger import get_logger

logger = get_logger(__name__)

HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; AgentCode/1.0)"}


def fetch_page(url: str, max_chars: int = 8000) -> dict:
    """
    Fetches `url` and returns its title and readable text content.
    """
    try:
        response = requests.get(url, headers=HEADERS, timeout=10)
        response.raise_for_status()
    except requests.RequestException as e:
        logger.warning(f"Failed to fetch {url}: {e}")
        return {"url": url, "title": "", "text": "", "error": str(e)}

    soup = BeautifulSoup(response.text, "html.parser")

    # Strip elements that aren't useful readable content
    for tag in soup(["script", "style", "nav", "footer", "header", "noscript"]):
        tag.decompose()

    title = soup.title.get_text(strip=True) if soup.title else ""
    text = " ".join(soup.get_text(separator=" ").split())

    if len(text) > max_chars:
        text = text[:max_chars] + "... [truncated]"

    return {"url": url, "title": title, "text": text, "error": None}
