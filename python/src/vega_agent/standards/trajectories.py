from __future__ import annotations

import re
from collections.abc import Iterator

from ..trace import Trace
from .conventions import CONVENTIONS
from .messages import EXIT, Call, Transcript, runs, trace
from .records import READ_DEPTH, Records, dicts, first, instant, integer, listed, mapping, records, text

OPENHANDS: dict[str, str] = CONVENTIONS["trajectories"]["openhands"]
FENCED = re.compile(r"```(?:bash|sh|shell)\b", re.ASCII)
RETURNCODE = re.compile(r"<returncode>\s*(-?\d+)\s*</returncode>", re.ASCII)


def atif(source: Records) -> list[Trace]:
    found = []
    for index, document in enumerate(dicts(records(source))):
        ident = text(document.get("trajectory_id")) or text(document.get("session_id")) or str(index)
        run = trace(_trajectory(document, 0), ident, text(mapping(document.get("agent")).get("name")))
        if run is not None:
            found.append(run)
    return found


def _trajectory(document: dict, depth: int) -> Transcript:
    subagents = {text(sub.get("trajectory_id")): sub for sub in dicts(listed(document.get("subagent_trajectories")))}
    transcript = Transcript()
    for step in dicts(listed(document.get("steps"))):
        at = instant(step.get("timestamp"))
        if step.get("source") == "user":
            transcript.human(at)
        if step.get("source") != "agent":
            continue
        results = {
            text(result.get("source_call_id")): result
            for result in dicts(listed(mapping(step.get("observation")).get("results")))
        }
        calls = [
            _call(call, mapping(results.get(text(call.get("tool_call_id")))), subagents, at, depth)
            for call in dicts(listed(step.get("tool_calls")))
        ]
        transcript.model(calls, at=at, actor="code" if _zero(step.get("llm_call_count")) else "model")
    return transcript


def _zero(value) -> bool:
    return integer(value) == 0


def _call(call: dict, result: dict, subagents: dict, at: float | None, depth: int) -> Call:
    found = Call(text(call.get("tool_call_id")), call.get("function_name"), at)
    found.failed = bool(mapping(result.get("extra")).get("is_error"))
    refs = result.get("subagent_trajectory_ref") or []
    if not refs:
        return found
    found.actor = "agent"
    keys = (text(ref.get("trajectory_id")) for ref in dicts([refs] if isinstance(refs, dict) else listed(refs)))
    if depth < READ_DEPTH:
        found.bodies = [_trajectory(subagents[key], depth + 1) for key in keys if key in subagents]
    return found


def swe_agent(source: Records) -> list[Trace]:
    return runs((_named(document, index), _swe(document)) for index, document in enumerate(dicts(records(source))))


def _swe(document: dict) -> Transcript:
    transcript = Transcript()
    if isinstance(document.get("trajectory"), list):
        for step in dicts(document["trajectory"]):
            words = (text(step.get("action")) or "").split()
            transcript.model([Call(None, words[0], None)] if words else [])
        return transcript
    last: Call | None = None
    for message in dicts(listed(document.get("messages"))):
        content = text(message.get("content")) or ""
        if message.get("role") == "assistant":
            last = Call(None, "bash", None) if FENCED.search(content) else None
            transcript.model([last] if last else [])
        elif message.get("role") == "user" and last is not None:
            code = RETURNCODE.search(content)
            last.failed = bool(code and int(code.group(1)) != 0)
            last = None
    return transcript


def openhands(source: Records) -> list[Trace]:
    return runs((ident, _events(events)) for ident, events in _histories(list(dicts(records(source)))))


def _histories(items: list[dict]) -> Iterator[tuple[str, list]]:
    if items and all("action" in item or "observation" in item for item in items):
        yield "0", items
        return
    for index, item in enumerate(items):
        yield _named(item, index), listed(first(item.get("history"), item.get("events")))


def _events(events: list) -> Transcript:
    transcript = Transcript()
    for event in dicts(events):
        at = instant(event.get("timestamp"))
        if "observation" in event:
            transcript.result(text(event.get("cause")), _erred(event), at)
            continue
        action, source = text(event.get("action")), event.get("source")
        if source == "user" and action == "message":
            transcript.human(at)
        actor = OPENHANDS.get(action or "")
        if source != "agent" or actor is None:
            continue
        response = mapping(mapping(event.get("tool_call_metadata")).get("model_response")).get("id")
        args = mapping(event.get("args"))
        name = args.get("name") if action == "mcp" else args.get("agent") if action == "delegate" else action
        calls = [] if actor == "model" else [Call(text(event.get("id")), name, at, actor)]
        transcript.model(calls, at=at, key=text(response))
    return transcript


def _erred(event: dict) -> bool:
    extras = mapping(event.get("extras"))
    code = first(mapping(extras.get("metadata")).get("exit_code"), extras.get("exit_code"))
    if event.get("observation") == "error" or event.get("success") is False:
        return True
    if integer(code) is not None:
        return integer(code) not in (0, -1)
    found = EXIT.search((text(event.get("content")) or "")[-400:]) if event.get("observation") == "run" else None
    return bool(found and int(found.group(1)) != 0)


def _named(document: dict, index: int) -> str:
    info = mapping(document.get("info"))
    return text(first(document.get("instance_id"), info.get("instance_id"), document.get("id"))) or str(index)
