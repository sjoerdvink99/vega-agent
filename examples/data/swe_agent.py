import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
TARGET = HERE.parents[1] / "docs" / "assets" / "swe-agent.jsonl"
ROWS = "https://datasets-server.huggingface.co/rows?dataset=nebius/SWE-agent-trajectories&config=default&split=train"
TOTAL = 80036
PAGE = 10
ATTEMPTS = 6
PAUSE = 3
COMMANDS = {
    "open",
    "goto",
    "scroll_down",
    "scroll_up",
    "create",
    "edit",
    "search_dir",
    "search_file",
    "find_file",
    "submit",
    "python",
    "ls",
    "find",
    "grep",
    "cat",
    "rm",
}
ALIASES = {"python3": "python", "pytest": "python"}
BLOCK = re.compile(r"```[a-z]*\n(.*?)```", re.S)
FAILURE = re.compile(
    r"Traceback \(most recent call last\)|introduced new syntax error|command not found|No such file|not found", re.I
)


def page(offset: int, attempt: int = 1) -> list[dict]:
    time.sleep(PAUSE)
    try:
        with urllib.request.urlopen(f"{ROWS}&offset={offset}&length={PAGE}", timeout=120) as response:
            return [row["row"] for row in json.load(response)["rows"]]
    except urllib.error.URLError:
        if attempt == ATTEMPTS:
            raise
        time.sleep(PAUSE * 4**attempt)
        return page(offset, attempt + 1)


def command(text: str) -> str:
    blocks = BLOCK.findall(text)
    words = blocks[-1].split() if blocks else []
    word = ALIASES.get(words[0], words[0]) if words else "bash"
    return word if word in COMMANDS else "bash"


def events(row: dict, index: int) -> list[dict]:
    turns = row["trajectory"]
    run = f"r{index}"
    found: list[dict] = []
    for position, turn in enumerate(turns):
        if turn.get("role") != "ai":
            continue
        reply = turns[position + 1].get("text", "") if position + 1 < len(turns) else ""
        tool = command(turn.get("text", ""))
        found.append({"run": run, "actor": "model"})
        found.append({"run": run, "actor": "tool", "tool": tool, **({"failed": True} if FAILURE.search(reply) else {})})
    if found:
        found[0] = {
            **found[0],
            "issue": row["instance_id"],
            "model": row["model_name"].removeprefix("swe-agent-"),
            "outcome": "resolved" if row["target"] else "unresolved",
        }
    return found


def main(runs: int) -> None:
    pages = max(1, runs // PAGE)
    rows = [row for offset in range(0, TOTAL, TOTAL // pages)[:pages] for row in page(offset)]
    lines = "".join(
        json.dumps(event, separators=(",", ":")) + "\n"
        for index, row in enumerate(rows)
        for event in events(row, index)
    )
    TARGET.write_text(lines)


if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 400)
