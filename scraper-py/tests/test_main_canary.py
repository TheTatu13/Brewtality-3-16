"""The canary must stop scraper.main.run() before any API write when a run
scrapes nothing (or nothing survives validation)."""

import pytest

from scraper import api, main
from scraper.validate import CanaryError


@pytest.fixture
def no_api(monkeypatch):
    """Stub the API so a test never touches the network, and record upserts."""
    upserts = []
    monkeypatch.setattr(api, "query_solr", lambda cif: {"numFound": 0, "docs": []})
    monkeypatch.setattr(api, "upsert_jobs", lambda jobs: upserts.append(jobs))
    return upserts


def test_zero_scraped_raises_canary_and_never_upserts(monkeypatch, no_api):
    monkeypatch.setattr(main, "scrape_careers", lambda: [])
    with pytest.raises(CanaryError):
        main.run()
    assert no_api == []


def test_all_jobs_invalid_also_raises_canary(monkeypatch, no_api):
    # scraped something, but every item is unpublishable -> still a canary
    monkeypatch.setattr(main, "scrape_careers", lambda: [
        {"url": "not-a-url", "title": ""},
        {"url": "", "title": "no url"},
    ])
    with pytest.raises(CanaryError):
        main.run()
    assert no_api == []


def test_valid_jobs_reach_upsert(monkeypatch, no_api):
    monkeypatch.setattr(main, "scrape_careers", lambda: [
        {"url": "https://www.antibiotice.ro/joburi/specialist-marketing/", "title": "Specialist Marketing"},
    ])
    count = main.run()
    assert count == 1
    assert len(no_api) == 1 and no_api[0][0]["title"] == "Specialist Marketing"


def test_dry_run_scrapes_and_validates_but_does_not_upsert(monkeypatch, no_api):
    monkeypatch.setattr(main, "scrape_careers", lambda: [
        {"url": "https://www.antibiotice.ro/joburi/x/", "title": "X"},
    ])
    main.run(dry_run=True)
    assert no_api == []
