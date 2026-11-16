from __future__ import annotations

import json
import re
from collections import defaultdict
from collections.abc import Iterable, Iterator
from dataclasses import dataclass, field

from ..syntax import EMPTY, Step
from ..trace import Trace, is_ground, timing
from .conventions import MESSAGES
from .records import READ_DEPTH, Records, dicts, first, identifier, instant, integer, listed, mapping, records, text
from .timed import Timed, timed_parallel, timed_sequence, timed_step

ROLES: dict[str, str] = MESSAGES["roles"]
HOSTED = set(MESSAGES["hosted"])
CALLS = set(MESSAGES["calls"])
INJECTED = tuple(MESSAGES["injected"])
SUBAGENTS = set(MESSAGES["subagents"])
INVOKED = {"function_call", "custom_tool_call"}
RETURNED = {"function_call_output", "custom_tool_call_output"}
ITEMS = {"message", "reasoning", *INVOKED, *RETURNED, *HOSTED}
EXIT = re.compile(r"exit[ _]?code\W{0,3}(-?\d+)", re.IGNORECASE | re.ASCII)


@dataclass
class Call:
    id: str | None
    name: object
    start: float | None
    actor: str = "tool"
    bodies: list[Transcript] = field(default_factory=list)
    failed: bool = False
    end: float | None = None


@dataclass
class Turn:
    actor: str
    start: float | None
    end: float | None
    calls: list[Call] = field(default_factory=list)


@dataclass
class Transcript:
    turns: list[Turn] = field(default_factory=list)
    pending: dict[str, Call] = field(default_factory=dict)
    keyed: dict[str, Turn] = field(default_factory=dict)
    open: bool = False
    clock: float | None = None

    def human(self, at: float | None) -> None:
        self.turns.append(Turn("human", at, at))
        self.open = False
        self.tick(at)

    def model(
        self,
        calls: Iterable[Call] = (),
        merge: bool = False,
        at: float | None = None,
        key: str | None = None,
        actor: str = "model",
    ) -> None:
        turn = self.keyed.get(key) if key is not None else None
        if turn is None and merge and self.open:
            turn = self.turns[-1]
        if turn is None:
            turn = Turn(actor, first(self.clock, at), at)
            self.turns.append(turn)
            self.open = True
            if key is not None:
                self.keyed[key] = turn
        turn.end = first(at, turn.end)
        for call in calls:
            turn.calls.append(call)
            if call.id is not None:
                self.pending[call.id] = call
        self.tick(at)

    def result(self, ident: str | None, failed: bool, at: float | None) -> None:
        self.open = False
        call = self.pending.get(ident) if ident is not None else None
        if call is not None:
            call.failed = call.failed or failed
            call.end = first(at, call.end)
        self.tick(at)

    def tick(self, at: float | None) -> None:
        if at is not None:
            self.clock = at


def messages(source: Records) -> list[Trace]:
    return runs((ident, transcribe(items)) for ident, items in _conversations(list(records(source))))


def codex(source: Records) -> list[Trace]:
    sessions: list[tuple[str, list[dict]]] = []
    for item in dicts(records(source)):
        payload = mapping(item.get("payload"))
        if item.get("type") == "session_meta" or not sessions:
            ident = text(payload.get("id")) if item.get("type") == "session_meta" else None
            if sessions and not sessions[-1][1]:
                sessions.pop()
            sessions.append((ident or str(len(sessions)), []))
        if item.get("type") == "response_item" and payload:
            sessions[-1][1].append({**payload, "timestamp": item.get("timestamp")})
    return runs((ident, transcribe(items)) for ident, items in sessions)


def claude_code(source: Records) -> list[Trace]:
    lines = [
        item
        for item in dicts(records(source))
        if item.get("type") in ("user", "assistant") and isinstance(item.get("message"), dict)
    ]
    sessions: dict[str, list[dict]] = defaultdict(list)
    threads: dict[str, list[dict]] = defaultdict(list)
    for line in lines:
        if line.get("isSidechain") is True:
            threads[text(line.get("agentId")) or ""].append(line)
        else:
            sessions[text(line.get("sessionId")) or ""].append(line)
    links = {
        ident: agent
        for line in lines
        if (agent := text(mapping(line.get("toolUseResult")).get("agentId")))
        for block in _blocks(line["message"])
        if (ident := text(block.get("tool_use_id")))
    }
    return runs(
        (ident or str(index), _session(group, threads, links, False, 0))
        for index, (ident, group) in enumerate(sessions.items())
    )


def _session(lines: list[dict], threads: dict, links: dict, delegated: bool, depth: int) -> Transcript:
    transcript = Transcript()
    for line in lines:
        if line.get("isMeta") is True or line.get("isCompactSummary") is True:
            continue
        message, at = line["message"], instant(line.get("timestamp"))
        if line["type"] == "user":
            _user(message, transcript, at, spoken=not delegated)
            continue
        calls = _calls(message, at)
        for call, block in _delegations(message, calls):
            call.actor, call.name = "agent", mapping(block.get("input")).get("subagent_type")
            thread = threads.get(links.get(call.id or ""), [])
            if thread and depth < READ_DEPTH:
                call.bodies.append(_session(thread, threads, links, True, depth + 1))
        transcript.model(calls, at=at, key=text(message.get("id")) or text(line.get("uuid")))
    return transcript


def _delegations(message: dict, calls: list[Call]) -> Iterator[tuple[Call, dict]]:
    found = {call.id: call for call in calls if call.id}
    for block in _blocks(message):
        ident = text(block.get("id"))
        if block.get("type") == "tool_use" and text(block.get("name")) in SUBAGENTS and ident in found:
            yield found[ident], block


def runs(transcripts: Iterable[tuple[str, Transcript]]) -> list[Trace]:
    found = (trace(transcript, ident) for ident, transcript in transcripts)
    return [run for run in found if run is not None]


def trace(transcript: Transcript, ident: str, agent: str | None = None) -> Trace | None:
    process = _process(transcript, 0)
    if process.node == EMPTY or not is_ground(process.node):
        return None
    return Trace(process.node, ident, timing(process.time), {"agent": agent} if agent else {})


def _process(transcript: Transcript, depth: int) -> Timed:
    parts = (
        part
        for turn in transcript.turns
        for part in (
            timed_step(Step(turn.actor), _interval(turn.start, turn.end)),
            timed_parallel(_call(call, depth) for call in turn.calls),
        )
    )
    return timed_sequence(parts)


def _call(call: Call, depth: int) -> Timed:
    bodies = call.bodies if depth < READ_DEPTH else []
    body = timed_parallel(_process(each, depth + 1) for each in bodies)
    step = Step(call.actor, identifier(call.name), failed=call.failed)
    return timed_step(step, _interval(call.start, first(call.end, call.start)), body)


def _interval(start: float | None, end: float | None) -> tuple[float, float] | None:
    return (start, end) if start is not None and end is not None and end >= start else None


def transcribe(items: Iterable) -> Transcript:
    transcript = Transcript()
    for item in dicts(items):
        message = normal(item)
        _read(message, transcript, instant(first(item.get("timestamp"), message.get("timestamp"))))
    return transcript


def _conversations(items: list) -> Iterator[tuple[str, list]]:
    if items and all(is_message(item) for item in items):
        yield "0", items
        return
    for index, item in enumerate(items):
        if isinstance(item, list):
            yield str(index), item
        elif isinstance(item, dict) and isinstance(item.get("samples"), list):
            for position, sample in enumerate(dicts(item["samples"])):
                yield _named(sample, position), conversation(sample)
        elif isinstance(item, dict):
            yield _named(item, index), conversation(item)


def _named(record: dict, index: int) -> str:
    base = text(first(record.get("id"), record.get("conversation_id"))) or str(index)
    epoch = text(record.get("epoch"))
    return f"{base}:{epoch}" if epoch else base


def conversation(record: dict) -> list:
    keys = ("contents", "conversations", "messages", "events", "input")
    found = next((record[key] for key in keys if isinstance(record.get(key), list)), [])
    replies = [choice.get("message") for choice in dicts(listed(record.get("choices")))]
    return [*found, *listed(record.get("output")), *replies]


def is_message(item) -> bool:
    if not isinstance(item, dict):
        return False
    message = normal(item)
    return (
        "role" in message
        or _role(message) is not None
        or text(message.get("type")) in ITEMS
        or message.get("kind") in ("request", "response")
    )


def normal(message: dict) -> dict:
    kwargs, data, content = message.get("kwargs"), message.get("data"), message.get("content")
    if message.get("lc") is not None and isinstance(kwargs, dict):
        names = listed(message.get("id"))
        return {
            **kwargs,
            "type": re.sub(r"(Message)?(Chunk)?$", "", (text(names[-1]) if names else None) or "").lower(),
        }
    if isinstance(data, dict) and text(message.get("type")) in ROLES and "role" not in message:
        return {**data, "type": message["type"]}
    if "from" in message and "value" in message:
        return _shared(message)
    if "role" not in message and isinstance(content, dict) and ("role" in content or "parts" in content):
        return {"role": "user" if message.get("author") == "user" else "model", **content}
    return message


def _shared(message: dict) -> dict:
    role, value = (text(message.get("from")) or "").lower(), message.get("value")
    if role not in ("function_call", "tool_call"):
        return {"role": role, "content": text(value) or ""}
    try:
        parsed = json.loads(value) if isinstance(value, str) else value
    except json.JSONDecodeError:
        parsed = None
    calls = parsed if isinstance(parsed, list) else [parsed]
    return {"role": "assistant", "tool_calls": [{"name": mapping(call).get("name")} for call in calls]}


def _role(message: dict) -> str | None:
    kind = text(message.get("type"))
    role = text(message.get("role")) or (kind if kind in ROLES else None)
    return ROLES.get(role.lower()) if role else None


def _read(message: dict, transcript: Transcript, at: float | None) -> None:
    kind, role = text(message.get("type")) or "", _role(message)
    if kind in HOSTED:
        call = text(first(message.get("id"), message.get("call_id"))) or kind
        name = message.get("name") if kind == "mcp_call" else kind.removesuffix("_call")
        transcript.model([Call(call, name, at, failed=message.get("status") == "failed")], merge=True, at=at)
    elif kind in INVOKED:
        call = text(first(message.get("call_id"), message.get("id")))
        transcript.model([Call(call, message.get("name"), at)], merge=True, at=at)
    elif kind in RETURNED:
        transcript.result(text(message.get("call_id")), _exited(message.get("output")), at)
    elif kind == "reasoning":
        transcript.model(merge=True, at=at)
    elif message.get("kind") == "response":
        transcript.model(_parts(message, at), at=at)
    elif message.get("kind") == "request":
        _request(message, transcript, at)
    elif role == "assistant":
        transcript.model(_calls(message, at), merge=kind == "message", at=at)
    elif role == "tool":
        _tool(message, transcript, at)
    elif role == "user":
        _user(message, transcript, at)


def _exited(output) -> bool:
    try:
        parsed = json.loads(output) if isinstance(output, str) else output
    except json.JSONDecodeError:
        parsed = None
    code = mapping(mapping(parsed).get("metadata")).get("exit_code")
    if code is None and isinstance(output, str) and (found := EXIT.search(output[:400])):
        code = int(found.group(1))
    return integer(code) not in (None, 0)


def _calls(message: dict, at: float | None) -> list[Call]:
    calls = []
    for call in dicts(listed(message.get("tool_calls"))):
        function = call.get("function")
        name = first(mapping(function).get("name"), function if isinstance(function, str) else None, call.get("name"))
        calls.append(Call(text(call.get("id")), name, at))
    legacy = message.get("function_call")
    if isinstance(legacy, dict):
        calls.append(Call(text(legacy.get("name")), legacy.get("name"), at))
    for block in _blocks(message):
        gemini, bedrock = block.get("functionCall"), block.get("toolUse")
        if text(block.get("type")) in CALLS:
            calls.append(Call(text(block.get("id")), block.get("name"), at))
        elif isinstance(gemini, dict):
            calls.append(Call(text(first(gemini.get("id"), gemini.get("name"))), gemini.get("name"), at))
        elif isinstance(bedrock, dict):
            calls.append(Call(text(bedrock.get("toolUseId")), bedrock.get("name"), at))
    return calls


def _parts(message: dict, at: float | None) -> list[Call]:
    return [
        Call(text(part.get("tool_call_id")), part.get("tool_name"), at)
        for part in dicts(listed(message.get("parts")))
        if part.get("part_kind") in ("tool-call", "builtin-tool-call")
    ]


def _request(message: dict, transcript: Transcript, at: float | None) -> None:
    for part in dicts(listed(message.get("parts"))):
        kind, moment = part.get("part_kind"), first(instant(part.get("timestamp")), at)
        if kind == "user-prompt":
            transcript.human(moment)
        elif kind in ("tool-return", "builtin-tool-return"):
            transcript.result(text(part.get("tool_call_id")), False, moment)
        elif kind == "retry-prompt":
            transcript.result(text(part.get("tool_call_id")) if part.get("tool_name") else None, True, moment)


def _outcome(block: dict) -> tuple[str | None, bool] | None:
    gemini, bedrock = block.get("functionResponse"), block.get("toolResult")
    if block.get("type") == "tool_result":
        return text(block.get("tool_use_id")), bool(block.get("is_error"))
    if isinstance(gemini, dict):
        return text(first(gemini.get("id"), gemini.get("name"))), "error" in mapping(gemini.get("response"))
    if isinstance(bedrock, dict):
        return text(bedrock.get("toolUseId")), bedrock.get("status") == "error"
    return None


def _tool(message: dict, transcript: Transcript, at: float | None) -> None:
    ident = text(first(message.get("tool_call_id"), message.get("tool_use_id")))
    erred = bool(message.get("error")) or message.get("status") == "error" or message.get("is_error") is True
    transcript.result(ident, erred, at)
    for block in _blocks(message):
        if (outcome := _outcome(block)) is not None:
            transcript.result(*outcome, at)


def _user(message: dict, transcript: Transcript, at: float | None, spoken: bool = True) -> None:
    blocks = _blocks(message)
    outcomes = [outcome for block in blocks if (outcome := _outcome(block)) is not None]
    for ident, erred in outcomes:
        transcript.result(ident, erred, at)
    content = message.get("content")
    said = isinstance(content, str) or len(outcomes) < len(blocks)
    if spoken and said and not _injected(content, blocks):
        transcript.human(at)


def _injected(content, blocks: list[dict]) -> bool:
    texts = [content] if isinstance(content, str) else [text(block.get("text")) or "" for block in blocks]
    return bool(texts) and all(each.lstrip().startswith(INJECTED) for each in texts)


def _blocks(message: dict) -> list[dict]:
    return list(dicts([*listed(message.get("content")), *listed(message.get("parts"))]))
