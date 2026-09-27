"""Run JS regressions through pytest; the original inline app became ES modules.

Known-defect checks now assert corrected behaviour. All data and HTTP are synthetic.
"""

import shutil
import subprocess
from pathlib import Path

import pytest


@pytest.mark.parametrize("suite", ["engine", "sync", "worker"])
def test_javascript_regressions(suite: str) -> None:
    node = shutil.which("node")
    assert node is not None, "Node.js is required for the JavaScript regression suite"
    result = subprocess.run(
        [node, "--test", str(Path(__file__).with_name(f"{suite}.test.mjs"))],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert result.returncode == 0, result.stdout + result.stderr
