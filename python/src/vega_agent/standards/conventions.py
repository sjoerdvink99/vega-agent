from __future__ import annotations

import json
from pathlib import Path

from ..syntax import ACTORS
from .records import dicts, listed, mapping, text, unquoted

CONVENTIONS = json.loads((Path(__file__).parents[1] / "static" / "conventions.json").read_text())
OPERATIONS = {value for rule in CONVENTIONS["rules"] for value in rule["values"]}
MESSAGES = CONVENTIONS["messages"]
VOCABULARY = {
    key.lower(): value
    for table in [*(rule["values"] for rule in CONVENTIONS["rules"]), *CONVENTIONS["spans"].values()]
    for key, value in table.items()
}


def target(value: str | None) -> tuple[str, str | None] | None:
    if value is None:
        return None
    actor, _, name = value.partition(".")
    return actor, name or None


def term(value: str) -> tuple[str, str | None] | None:
    if value.lower() in VOCABULARY:
        return target(VOCABULARY[value.lower()])
    found = target(value)
    return found if found is not None and found[0] in ACTORS else None


def classify(attributes: dict) -> tuple[str, str | None] | None:
    for rule in CONVENTIONS["rules"]:
        value = unquoted(attributes.get(rule["key"]))
        if value is not None and value in rule["values"]:
            return target(rule["values"][value])
    return None


def named(actor: str, attributes: dict) -> str | None:
    return next((value for key in CONVENTIONS["names"][actor] if (value := unquoted(attributes.get(key)))), None)


def failed(status, attributes: dict, events=None) -> bool:
    rules = CONVENTIONS["failure"]
    return (
        any(status == value for value in rules["status"])
        or any(key in attributes for key in rules["attributes"])
        or any(text(event.get("name")) in rules["events"] for event in dicts(listed(events)))
    )


def kind(table: str, value) -> tuple[str, str | None] | None:
    return target(mapping(CONVENTIONS["spans"].get(table)).get(text(value)))
