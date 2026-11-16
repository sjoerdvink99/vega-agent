from pathlib import Path

import nbformat
import pytest
from nbclient import NotebookClient

EXAMPLES = Path(__file__).parents[2] / "examples"
NOTEBOOKS = sorted((EXAMPLES / "notebooks").glob("*.ipynb"))


@pytest.mark.parametrize("path", NOTEBOOKS, ids=[path.stem for path in NOTEBOOKS])
def test_notebook_runs(path, tmp_path):
    (tmp_path / "data").symlink_to(EXAMPLES / "data")
    (tmp_path / "notebooks").mkdir()
    notebook = nbformat.read(path, as_version=4)
    NotebookClient(notebook, timeout=120, resources={"metadata": {"path": str(tmp_path / "notebooks")}}).execute()
