from pathlib import Path

import pytest

_FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def fixture_html():
    """Return the text of a fixture file under tests/fixtures/."""
    def _load(name: str) -> str:
        return (_FIXTURES / name).read_text(encoding="utf-8")
    return _load
