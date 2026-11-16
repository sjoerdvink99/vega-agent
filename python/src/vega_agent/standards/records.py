from __future__ import annotations

import json
import math
import re
import zipfile
from collections.abc import Iterable, Iterator
from datetime import datetime, timezone
from pathlib import Path

Records = str | Path | dict | list | Iterable[dict]

READ_DEPTH = 24
NANOSECONDS = 1e9
MICROSECONDS = 1e6
MILLISECONDS = 1e3
SECONDS = 1.0
EARLIEST, LATEST = -62135596800.0, 253402300799.0
ISO = re.compile(
    r"(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?)?\s*(Z|[+-]\d{2}:?\d{2})?",
    re.ASCII | re.IGNORECASE,
)


def records(source: Records) -> Iterator:
    if source is None or isinstance(source, (int, float, bool, bytes)):
        raise TypeError(f"expected a path, a record, or an iterable of records, found {type(source).__name__}")
    if isinstance(source, dict):
        yield source
    elif isinstance(source, (str, Path)):
        yield from load(Path(source).expanduser())
    else:
        yield from source


def load(path: Path) -> Iterator:
    if zipfile.is_zipfile(path):
        yield from _archive(path)
        return
    yield from parse(path.read_text(encoding="utf-8", errors="replace"))
    companions = path.with_suffix("") / "subagents"
    if path.suffix == ".jsonl" and companions.is_dir():
        for companion in sorted(companions.glob("*.jsonl")):
            yield from parse(companion.read_text(encoding="utf-8", errors="replace"))


def parse(content: str) -> Iterator:
    try:
        loaded = json.loads(content)
    except json.JSONDecodeError:
        for line in content.splitlines():
            yield from _decoded(line)
        return
    yield from loaded if isinstance(loaded, list) else [loaded]


def _decoded(line: str) -> list:
    try:
        return [json.loads(line)] if line.strip() else []
    except json.JSONDecodeError:
        return []


def _archive(path: Path) -> Iterator:
    with zipfile.ZipFile(path) as archive:
        for name in sorted(archive.namelist()):
            if name.startswith("samples/") and name.endswith(".json"):
                yield from parse(archive.read(name).decode("utf-8", errors="replace"))


def seconds(value, per_second: float = NANOSECONDS) -> float | None:
    if value is None or value == "" or isinstance(value, bool):
        return None
    try:
        if isinstance(value, (int, float)) or re.fullmatch(r"\d+(\.\d+)?", str(value), flags=re.ASCII):
            parsed = float(value) / per_second
        else:
            parsed = _moment(str(value))
    except (ValueError, OverflowError, OSError):
        return None
    return parsed if EARLIEST <= parsed <= LATEST else None


def instant(value) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return seconds(value, SECONDS)
    magnitude = abs(value)
    scale = (
        SECONDS
        if magnitude < 1e11
        else MILLISECONDS
        if magnitude < 1e14
        else MICROSECONDS
        if magnitude < 1e17
        else NANOSECONDS
    )
    return seconds(value, scale)


def _moment(value: str) -> float:
    found = ISO.fullmatch(value.strip())
    if found is None:
        raise ValueError(value)
    year, month, day, hour, minute, second, fraction, zone = found.groups()
    micros = int((fraction or "").ljust(6, "0")[:6])
    moment = datetime(int(year), int(month), int(day), int(hour or 0), int(minute or 0), int(second or 0), micros)
    return moment.replace(tzinfo=timezone.utc).timestamp() - _offset(zone)


def _offset(zone: str | None) -> float:
    if not zone or zone.upper() == "Z":
        return 0.0
    digits = zone[1:].replace(":", "")
    hours, minutes = int(digits[:2]), int(digits[2:])
    if hours > 23 or minutes > 59:
        raise ValueError(zone)
    return (-1 if zone.startswith("-") else 1) * (hours * 3600 + minutes * 60)


def listed(value) -> list:
    return value if isinstance(value, list) else []


def mapping(value) -> dict:
    return value if isinstance(value, dict) else {}


def dicts(items: Iterable) -> Iterator[dict]:
    return (item for item in items if isinstance(item, dict))


def first(*values):
    return next((value for value in values if value is not None), None)


def text(value) -> str | None:
    if isinstance(value, str):
        return value
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        number = float(value)
    except OverflowError:
        return None
    if not math.isfinite(number):
        return None
    return str(int(number)) if number.is_integer() else repr(number)


def pick(record, path: str):
    if not isinstance(record, dict):
        return None
    if path in record:
        return record[path]
    parts = path.split(".")
    for split in range(len(parts) - 1, 0, -1):
        head = ".".join(parts[:split])
        if head in record:
            return pick(record[head], ".".join(parts[split:]))
    return None


def category(value) -> str | None:
    return str(value).lower() if isinstance(value, bool) else text(value)


def integer(value) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return int(value) if math.isfinite(value) and float(value).is_integer() else None


def unquoted(value) -> str | None:
    found = text(value)
    if found and len(found) > 1 and found[0] == found[-1] == '"':
        try:
            decoded = json.loads(found)
        except json.JSONDecodeError:
            return found
        return decoded if isinstance(decoded, str) else found
    return found


def identifier(value) -> str | None:
    cleaned = re.sub(r"\W+", "_", text(value) or "", flags=re.ASCII).strip("_")
    return None if not cleaned else f"_{cleaned}" if cleaned[0].isdigit() else cleaned
