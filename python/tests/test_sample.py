import pytest

import vega_agent as va

SPEC = "model.plan(=> task:text[]) -> agent.worker{ (model -> tool.search)+ -> model }[] -> (model.answer | human.ask)"


def test_samples_conform_to_their_spec():
    for trace in va.sample(SPEC, 50, seed=7):
        assert va.conforms(trace, SPEC)


@pytest.mark.parametrize(
    "spec",
    [
        "(tool.a || tool.b)[1,3] -> model",
        "model[0,2] || tool -> code",
        "(tool.a || tool.b | tool.c) || code[]",
        "((model -> tool)? || human)[] -> model",
        "agent{ model[1,] -> tool* }[2,] || code?",
    ],
)
def test_parallel_samples_conform_to_their_spec(spec):
    for trace in va.sample(spec, 40, seed=11):
        assert va.conforms(trace, spec), str(trace)


def test_sampling_is_seeded():
    assert [str(t) for t in va.sample(SPEC, 5, seed=1)] == [str(t) for t in va.sample(SPEC, 5, seed=1)]


def test_corpus_round_trip():
    corpus = va.Corpus(va.sample("(model -> tool[]){1,4} -> model", 40, seed=3))
    assert corpus.conformance("(model -> tool[])* -> model") == 1.0
    assert corpus.variants("loops")["runs"].sum() == 40
    assert corpus.chart(highlight="tool[2]").to_dict()["mark"] == "icicle"


@pytest.mark.parametrize(("n", "again"), [(-1, 0.5), (True, 0.5), (2.5, 0.5), (1, 1.0), (1, -0.1), (1, "0.5")])
def test_sampling_arguments_are_checked(n, again):
    with pytest.raises(ValueError):
        va.sample("model*", n, again=again)
