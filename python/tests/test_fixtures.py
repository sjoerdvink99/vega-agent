import json
from pathlib import Path

import pytest

import vega_agent as va

FIXTURES = json.loads((Path(__file__).parents[2] / "grammar" / "fixtures.json").read_text())


@pytest.mark.parametrize("text", FIXTURES["roundtrip"])
def test_roundtrip(text):
    assert str(va.parse(text)) == text


@pytest.mark.parametrize(("text", "expected"), FIXTURES["canonical"])
def test_canonical(text, expected):
    assert str(va.parse(text)) == expected


@pytest.mark.parametrize("text", FIXTURES["errors"])
def test_errors(text):
    with pytest.raises(va.ParseError):
        va.parse(text)


@pytest.mark.parametrize(("text", "count"), FIXTURES["traces"])
def test_traces(text, count):
    if count is None:
        with pytest.raises(va.TraceError):
            va.trace(text)
    else:
        assert len(list(va.trace(text).steps())) == count


@pytest.mark.parametrize(("run", "spec", "expected"), FIXTURES["conforms"])
def test_conforms(run, spec, expected):
    assert va.conforms(run, spec) is expected


@pytest.mark.parametrize(("run", "query", "expected"), FIXTURES["find"])
def test_find(run, query, expected):
    assert [hit.text for hit in va.find(run, query)] == expected


@pytest.mark.parametrize(("run", "query", "expected"), FIXTURES["positions"])
def test_positions(run, query, expected):
    assert [list(hit.steps) for hit in va.find(run, query)] == expected


@pytest.mark.parametrize(("run", "expected"), FIXTURES["fold"])
def test_fold(run, expected):
    assert str(va.fold(va.trace(run).process)) == expected


@pytest.mark.parametrize(("run", "level", "expected"), FIXTURES["abstract"])
def test_abstract(run, level, expected):
    assert str(va.abstract(va.trace(run).process, level)) == expected


@pytest.mark.parametrize(("spec", "level", "expected"), FIXTURES["designs"])
def test_designs(spec, level, expected):
    assert str(va.abstract(spec, level)) == expected


def test_abstract_rejects_an_unknown_level():
    with pytest.raises(ValueError, match="level"):
        va.abstract("model", "everything")
