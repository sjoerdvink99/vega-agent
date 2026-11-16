from __future__ import annotations

import re
from collections.abc import Callable, Iterable, Mapping
from dataclasses import replace

from ..syntax import ACTORS
from ..trace import Trace
from .conventions import term
from .records import category, identifier, instant, pick, seconds, text
from .spans import Span, build, parent

CHANNELS = ("group", "run", "step", "parent", "actor", "name", "failed", "start", "end")
MAX_GROUPS = 2
PER_SECOND = {"s": 1.0, "ms": 1e3, "us": 1e6, "ns": 1e9}
TARGET = re.compile(rf"({'|'.join(ACTORS)})(\.[A-Za-z_][A-Za-z0-9_]*)?")


def check(how: Mapping) -> Mapping:
    _known(how, CHANNELS, "trace")
    for key in ("run", "step", "parent", "name"):
        if key in how:
            _named(how[key], key)
    if "group" in how:
        _channel(how["group"], "group", {"order": _order}, required=("order",))
    if "actor" in how:
        _channel(how["actor"], "actor", {"map": _targets})
    if "failed" in how:
        _channel(how["failed"], "failed", {"equal": _value}, required=("equal",))
    for key in ("start", "end"):
        if key in how:
            _channel(how[key], key, {"unit": _unit}, required=("unit",))
    stepwise = next((key for key in CHANNELS if key not in ("group", "actor") and key in how), None)
    if stepwise and "actor" not in how:
        raise TypeError(f"the {stepwise!r} channel reads records as steps, which needs an 'actor' channel")
    return how


def _known(value: Mapping, keys: Iterable[str], at: str) -> None:
    unknown = [key for key in value if key not in keys]
    if unknown:
        raise TypeError(f"unknown {at} option {unknown[0]!r}, expected one of {', '.join(keys)}")


def _named(value, at: str) -> None:
    if not isinstance(value, str) or not value:
        raise TypeError(f"{at} expects a field name, found {value!r}")


def _channel(value, at: str, options: dict[str, Callable], required: tuple[str, ...] = ()) -> None:
    if isinstance(value, str):
        _named(value, at)
        return
    if not isinstance(value, Mapping):
        raise TypeError(f"{at} expects a field name or an object with 'field', found {value!r}")
    _known(value, ("field", *options), at)
    _named(value.get("field"), f"{at}.field")
    for key, test in options.items():
        if key in value or key in required:
            test(value.get(key), f"{at}.{key}")


def _targets(value, at: str) -> None:
    if not isinstance(value, Mapping):
        raise TypeError(f"{at} expects an object of values to actors, found {value!r}")
    for key, target in value.items():
        if target is not None and not (isinstance(target, str) and TARGET.fullmatch(target)):
            raise TypeError(f"{at}.{key} expects an actor such as 'model' or 'tool.search', or None, found {target!r}")


def _order(value, at: str) -> None:
    names = value if isinstance(value, list) else None
    if not names or len(names) > MAX_GROUPS or len(set(map(str, names))) != len(names):
        raise TypeError(f"{at} expects one or {MAX_GROUPS} distinct group names, found {value!r}")
    if not all(isinstance(name, str) for name in names):
        raise TypeError(f"{at} expects group names as strings, found {value!r}")


def group_of(how: Mapping) -> str | None:
    group = how.get("group")
    return None if group is None else _field(group)


def _value(value, at: str) -> None:
    if not isinstance(value, (str, int, float, bool)):
        raise TypeError(f"{at} expects a string, number or boolean, found {value!r}")


def _unit(value, at: str) -> None:
    if value not in PER_SECOND:
        raise TypeError(f"{at} expects one of {', '.join(PER_SECOND)}, found {value!r}")


def mapped(items: Iterable, how: Mapping) -> list[Trace]:
    records = [item for item in items if isinstance(item, dict)]
    spans = [_span(record, index, how) for index, record in enumerate(records)]
    runs = build(spans)
    group = group_of(how)
    if group is None:
        return runs
    groups: dict[str, str] = {}
    for span, record in zip(spans, records, strict=True):
        if (value := category(pick(record, group))) is not None:
            groups.setdefault(span.trace, value)
    return [_grouped(run, groups[run.id]) for run in runs if run.id in groups]


def _grouped(run: Trace, group: str) -> Trace:
    return replace(run, meta={**run.meta, "group": group})


def _span(record: dict, index: int, how: Mapping) -> Span:
    def value(channel: str):
        return pick(record, how[channel]) if channel in how else None

    ident = text(value("step")) or f"#{index}"
    name = identifier(value("name"))
    start = _moment(record, how.get("start"))
    return Span(
        id=ident,
        parent=parent(value("parent"), ident) if "parent" in how else None,
        trace=(category(value("run")) or "") if "run" in how else "",
        title=name or "",
        start=start,
        end=_moment(record, how["end"]) if "end" in how else start,
        failed="failed" in how and _failed(record, how["failed"]),
        kind=_kind(record, how["actor"], name),
    )


def _field(channel) -> str:
    return channel if isinstance(channel, str) else channel["field"]


def _kind(record: dict, channel, name: str | None) -> tuple[str, str | None] | None:
    value = category(pick(record, _field(channel)))
    if value is None:
        return None
    table = channel.get("map", {}) if isinstance(channel, dict) else {}
    found = term(value) if value not in table else term(table[value]) if table[value] is not None else None
    return found and (found[0], name or found[1])


def _failed(record: dict, channel) -> bool:
    value = pick(record, _field(channel))
    if isinstance(channel, str):
        return bool(value)
    equal = channel["equal"]
    return value == equal and isinstance(value, bool) == isinstance(equal, bool)


def _moment(record: dict, channel) -> float | None:
    if channel is None:
        return None
    value = pick(record, _field(channel))
    return instant(value) if isinstance(channel, str) else seconds(value, PER_SECOND[channel["unit"]])
