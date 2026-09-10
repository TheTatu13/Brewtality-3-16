import logging

from scraper.parse import parse_deadline, parse_listing, slugify


def test_slugify_strips_diacritics():
    assert slugify("Key Account Manager – Vânzări Distribuitori") == "key-account-manager-vanzari-distribuitori"
    assert slugify("  Operator   exploatare și mentenanță  ") == "operator-exploatare-si-mentenanta"


def test_parse_deadline():
    assert parse_deadline("Data limita: 30.09.2026").startswith("2026-09-30T23:59:59")
    assert parse_deadline("2026-10-31").startswith("2026-10-31T00:00:00")
    assert parse_deadline("fără termen") is None
    assert parse_deadline(None) is None


class TestParseListingHappyPath:
    def test_extracts_one_item_per_article(self, fixture_html):
        items = parse_listing(fixture_html("listing_ok.html"))
        assert [i["title"] for i in items] == ["Manager Medical – Produse veterinare", "Servant pompier"]

    def test_carries_deadline_when_present(self, fixture_html):
        items = parse_listing(fixture_html("listing_ok.html"))
        assert items[0]["expirationdate"].startswith("2026-09-30")
        assert items[1]["expirationdate"] is None

    def test_empty_when_nothing_matches(self):
        assert parse_listing("<div>no jobs here</div>") == []


class TestParseListingSelfHealing:
    def test_recovers_via_fallback_class_and_fallback_heading(self, fixture_html, caplog):
        with caplog.at_level(logging.INFO):
            items = parse_listing(fixture_html("listing_renamed_class.html"))
        titles = sorted(i["title"] for i in items)
        assert titles == ["Analist Calitate", "Tehnician Mentenanta Electric"]
        analist = next(i for i in items if i["title"] == "Analist Calitate")
        assert analist["expirationdate"].startswith("2026-11-15")

    def test_falls_back_to_json_ld(self, fixture_html):
        items = parse_listing(fixture_html("listing_jsonld_only.html"))
        assert sorted(i["title"] for i in items) == ["Product Manager Biovet", "Reprezentant Medical"]
        rep = next(i for i in items if i["title"] == "Reprezentant Medical")
        assert rep["expirationdate"].startswith("2026-10-31")

    def test_falls_back_to_regex_article_slicing(self, fixture_html):
        items = parse_listing(fixture_html("listing_regex_article.html"))
        assert len(items) == 1
        assert items[0]["title"] == "Servant Pompier"
        assert items[0]["expirationdate"].startswith("2026-10-20")

    def test_unrecognisable_page_returns_empty_without_raising(self, fixture_html):
        # feeds the canary in main.run()
        assert parse_listing(fixture_html("listing_unrecognisable.html")) == []
