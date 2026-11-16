from pathlib import Path

import vega_agent as va

HERE = Path(__file__).parent
DATA = HERE / "data"
FIGURE = HERE.parent / "docs" / "figures" / "difference.svg"


def main() -> None:
    old = va.Corpus(va.read(DATA / "copilot-model-a.jsonl"), "model-a")
    new = va.Corpus(va.read(DATA / "copilot-model-b.jsonl"), "model-b")
    chart = va.icicle({"model-a": old, "model-b": new}, level="names", title="Same harness, two models")
    chart.spec = {**chart.spec, "width": 900}
    chart.save(FIGURE)


if __name__ == "__main__":
    main()
