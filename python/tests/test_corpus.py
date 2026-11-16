from collections import Counter

import pytest

import vega_agent as va

SPEC = "model -> (tool.read | tool.write!)? -> (model -> tool[1,2]){0,2} -> model"
RUNS = va.sample(SPEC, 120, seed=5)
QUERIES = ["tool.write!", "model -> tool -> model", "tool[2]", "(model -> tool){2}"]


def test_samples_repeat_traces():
    assert len({str(run.process) for run in RUNS}) < len(RUNS) / 2


@pytest.mark.parametrize("level", va.LEVELS)
def test_variants_count_each_run_once_at_its_abstraction(level):
    corpus = va.Corpus(RUNS)
    expected = Counter(str(va.abstract(run.process, level)) for run in RUNS)
    frame = corpus.variants(level)
    assert dict(zip(frame["process"], frame["runs"], strict=True)) == expected
    assert list(frame["runs"]) == sorted(frame["runs"], reverse=True)
    assert frame["share"].sum() == pytest.approx(1)


@pytest.mark.parametrize("query", QUERIES)
def test_where_and_conformance_agree_with_each_run(query):
    corpus = va.Corpus(RUNS, name="sampled")
    kept = corpus.where(query)
    assert [run.id for run in kept] == [run.id for run in RUNS if va.find(run, query)]
    assert kept.name == "sampled"
    assert corpus.conformance(query) == sum(va.conforms(run, query) for run in RUNS) / len(RUNS)


def test_conformance_to_the_generating_spec_is_total():
    assert va.Corpus(RUNS).conformance(SPEC) == 1


def test_find_lists_every_match_of_every_run():
    frame = va.Corpus(RUNS[:10]).find("model -> tool")
    expected = [(run.id, hit.text) for run in RUNS[:10] for hit in va.find(run, "model -> tool")]
    assert list(zip(frame["trace"], frame["match"], strict=True)) == expected


def test_select_keeps_the_corpus_order():
    corpus = va.Corpus(RUNS)
    picked = [RUNS[7].id, RUNS[2].id, "missing"]
    assert [run.id for run in corpus.select(picked)] == [RUNS[2].id, RUNS[7].id]


def test_an_empty_corpus_is_well_defined():
    corpus = va.Corpus([])
    assert len(corpus) == 0
    assert corpus.variants().empty
    assert corpus.conformance("model") == 0
    assert len(corpus.where("model")) == 0


def test_diff_measures_both_sides():
    before, after = va.Corpus(RUNS[:60]), va.Corpus(RUNS[60:])
    diff = va.Diff(before, after, spec=SPEC, queries={"failed write": "tool.write!"}, labels=("old", "new"))
    metrics = diff.metrics().set_index("metric")
    assert metrics.loc["conforms to spec", "old"] == 1
    rate = len(before.where("tool.write!")) / len(before)
    assert metrics.loc["failed write", "old"] == pytest.approx(rate)
    assert metrics.loc["failed write", "delta"] == pytest.approx(metrics.loc["failed write", "new"] - rate)
    variants = diff.variants("actors")
    assert list(variants["delta"]) == sorted(variants["delta"], key=abs, reverse=True)
    assert variants["old"].sum() == pytest.approx(1) and variants["new"].sum() == pytest.approx(1)
