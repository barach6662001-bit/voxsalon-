#!/usr/bin/env python3
"""
find_web_leads.py
=================

Lead generation for **web design / telephony services**: find UK companies that
are *actively trading* but have **no website of their own**, while still being
**reachable** (listed in a directory, a regulator's register, or social).

Why this differs from `find_uk_legal_firms.py`
----------------------------------------------
That script answers "which companies have *zero* digital footprint". For selling
a website or a phone system that is the wrong target: a company with no website,
no phone and no listing is a company you cannot pitch, and in the legal SIC band
most such records are dormant shells or formation-agent registrations.

This script targets the commercially useful segment instead:

    trading  +  no website of its own  +  a contact channel exists   -> HOT LEAD

Data source
-----------
The **free Companies House bulk data product** — no API key required:
    https://download.companieshouse.gov.uk/en_output.html
    BasicCompanyDataAsOneFile-YYYY-MM-01.zip   (~470 MB, ~5.7 M companies)

Pipeline
--------
1. Download / read the bulk CSV, filter by SIC, status, company type, date.
2. Keep only companies whose accounts category implies real trading.
3. Web-search each candidate and classify its web presence.
4. Export ranked CSV: HOT_LEAD first.

Note: the bulk product contains no officer/PSC names. If you need directors,
use `find_uk_legal_firms.py` (Companies House API, requires a key) or the
officers snapshot product.

Compliance: registered-office data is public, but B2B outreach in the UK is
governed by UK GDPR and PECR. Marketing calls must be screened against the TPS /
CTPS, and you must honour opt-outs. See README.md.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import random
import re
import sys
import time
import zipfile
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Iterable
from urllib.parse import urlparse

# --------------------------------------------------------------------------- #
# Config
# --------------------------------------------------------------------------- #

BULK_BASE = "https://download.companieshouse.gov.uk"
BULK_TEMPLATE = "{base}/BasicCompanyDataAsOneFile-{ym}-01.zip"

DEFAULT_SIC = ["69100", "69101", "69102", "69109"]

# Accounts categories that indicate a company actually trades.
TRADING_ACCOUNTS = {
    "MICRO ENTITY",
    "TOTAL EXEMPTION FULL",
    "TOTAL EXEMPTION SMALL",
    "UNAUDITED ABRIDGED",
    "SMALL",
    "FULL",
    "MEDIUM",
    "GROUP",
    "AUDIT EXEMPTION SUBSIDIARY",
}

# Categories that mean "not a customer": no operations, no budget.
NON_TRADING_ACCOUNTS = {"DORMANT", "NO ACCOUNTS FILED"}

ACCEPTED_CATEGORIES = {"Private Limited Company", "Limited Liability Partnership"}

# Hosts that carry no commercial signal — pure registry / aggregator mirrors.
REGISTRY_HOSTS = (
    "gov.uk", "companieshouse.gov.uk", "company-information.service.gov.uk",
    "endole.co.uk", "companycheck.co.uk", "bizdb.co.uk", "opencorporates.com",
    "companiesintheuk.co.uk", "globaldatabase.com", "datalog.co.uk",
    "companydirectorcheck.com", "suite.endole.co.uk", "find-and-update.company-information.service.gov.uk",
    "bizzdb.co.uk", "companylist.org", "ukcompanylist.co.uk", "charitycommission.gov.uk",
)

# Hosts that prove the business is *reachable* even without its own site.
DIRECTORY_HOSTS = (
    "yell.com", "yelp.co.uk", "yelp.com", "thomsonlocal.com", "freeindex.co.uk",
    "cylex-uk.co.uk", "192.com", "scoot.co.uk", "hotfrog.co.uk", "brownbook.net",
    "sra.org.uk", "lawsociety.org.uk", "barstandardsboard.org.uk", "legal500.com",
    "chambers.com", "solicitors.lawsociety.org.uk", "trustpilot.com",
    "checkatrade.com", "bark.com", "google.com/maps",
)

SOCIAL_HOSTS = (
    "linkedin.com", "facebook.com", "instagram.com", "twitter.com", "x.com",
    "tiktok.com", "youtube.com",
)

# Free/blog platforms: a presence but not a real corporate site.
WEAK_SITE_HOSTS = (
    "wordpress.com", "wixsite.com", "blogspot.com", "weebly.com",
    "squarespace.com", "godaddysites.com", "business.site",
)

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
]

STOPWORDS = {
    "ltd", "limited", "llp", "the", "and", "&", "co", "company", "uk",
    "group", "services", "solicitors", "legal", "law", "partners", "associates",
}


# --------------------------------------------------------------------------- #
# Model
# --------------------------------------------------------------------------- #

@dataclass
class Lead:
    name: str
    crn: str
    incorporated: str
    company_type: str
    accounts: str
    sic: str
    address: str
    postcode: str
    verdict: str = "NOT_CHECKED"
    own_site: str = ""
    contact_sources: list[str] = field(default_factory=list)

    @property
    def priority(self) -> int:
        return {"HOT_LEAD": 0, "NO_PRESENCE": 1, "WEAK_SITE": 2,
                "CHECK_FAILED": 3, "HAS_WEBSITE": 4}.get(self.verdict, 5)


# --------------------------------------------------------------------------- #
# Bulk data
# --------------------------------------------------------------------------- #

def latest_bulk_url(base: str = BULK_BASE) -> str:
    today = date.today()
    return BULK_TEMPLATE.format(base=base, ym=f"{today.year}-{today.month:02d}")


def download_bulk(dest: str, url: str | None = None) -> str:
    """Download the bulk zip if not already present. Returns the local path."""
    import requests

    url = url or latest_bulk_url()
    if os.path.exists(dest) and os.path.getsize(dest) > 10_000_000:
        print(f"      using cached {dest}", file=sys.stderr)
        return dest

    print(f"      downloading {url}", file=sys.stderr)
    with requests.get(url, stream=True, timeout=900) as r:
        if r.status_code == 404:
            # This month's file may not be published yet — fall back one month.
            today = date.today()
            y, m = (today.year, today.month - 1) if today.month > 1 else (today.year - 1, 12)
            alt = BULK_TEMPLATE.format(base=BULK_BASE, ym=f"{y}-{m:02d}")
            print(f"      404; falling back to {alt}", file=sys.stderr)
            return download_bulk(dest, alt)
        r.raise_for_status()
        total = int(r.headers.get("Content-Length", 0))
        done = 0
        with open(dest, "wb") as fh:
            for chunk in r.iter_content(chunk_size=1 << 20):
                fh.write(chunk)
                done += len(chunk)
                if total:
                    pct = 100 * done / total
                    print(f"\r      {pct:5.1f}%  ({done/1e6:.0f}/{total/1e6:.0f} MB)",
                          end="", file=sys.stderr)
        print(file=sys.stderr)
    return dest


def iter_bulk_rows(zip_path: str) -> Iterable[dict[str, str]]:
    """Yield rows with **normalised keys**.

    The Companies House bulk CSV ships several headers with a leading space
    (` CompanyNumber`, ` RegAddress.AddressLine2`). Reading them naively yields a
    blank company number for every row, so strip the header names up front.
    """
    with zipfile.ZipFile(zip_path) as z:
        name = z.namelist()[0]
        with z.open(name) as fh:
            text = io.TextIOWrapper(fh, encoding="utf-8", errors="replace")
            reader = csv.reader(text)
            header = [h.strip() for h in next(reader)]
            for values in reader:
                if not values:
                    continue
                yield dict(zip(header, values))


def parse_date(ddmmyyyy: str) -> str:
    try:
        d, m, y = ddmmyyyy.strip().split("/")
        return f"{y}-{m}-{d}"
    except Exception:
        return ""


def filter_companies(
    zip_path: str,
    *,
    sic_codes: set[str],
    from_date: str,
    to_date: str,
    trading_only: bool = True,
) -> tuple[list[Lead], dict[str, int]]:
    leads: list[Lead] = []
    stats = {"scanned": 0, "sic_match": 0, "active": 0, "type_ok": 0,
             "date_ok": 0, "trading": 0}

    for row in iter_bulk_rows(zip_path):
        stats["scanned"] += 1

        sics: list[str] = []
        for key in ("SICCode.SicText_1", "SICCode.SicText_2",
                    "SICCode.SicText_3", "SICCode.SicText_4"):
            val = (row.get(key) or "").strip()
            if val:
                sics.append(val)
        codes = {s.split(" - ")[0].strip() for s in sics}
        if not (codes & sic_codes):
            continue
        stats["sic_match"] += 1

        if (row.get("CompanyStatus") or "").strip() != "Active":
            continue
        stats["active"] += 1

        category = (row.get("CompanyCategory") or "").strip()
        if category not in ACCEPTED_CATEGORIES:
            continue
        stats["type_ok"] += 1

        inc = parse_date(row.get("IncorporationDate") or "")
        if not inc or not (from_date <= inc <= to_date):
            continue
        stats["date_ok"] += 1

        accounts = (row.get("Accounts.AccountCategory") or "").strip()
        if trading_only and accounts not in TRADING_ACCOUNTS:
            continue
        stats["trading"] += 1

        address = ", ".join(x for x in [
            (row.get("RegAddress.AddressLine1") or "").strip(),
            (row.get("RegAddress.AddressLine2") or "").strip(),
            (row.get("RegAddress.PostTown") or "").strip(),
            (row.get("RegAddress.County") or "").strip(),
            (row.get("RegAddress.PostCode") or "").strip(),
        ] if x)

        leads.append(Lead(
            name=(row.get("CompanyName") or "").strip(),
            crn=(row.get("CompanyNumber") or "").strip(),
            incorporated=inc,
            company_type="LLP" if category == "Limited Liability Partnership" else "Ltd",
            accounts=accounts,
            sic="; ".join(s for s in sics if s.split(" - ")[0].strip() in sic_codes),
            address=address,
            postcode=(row.get("RegAddress.PostCode") or "").strip(),
        ))

    return leads, stats


# --------------------------------------------------------------------------- #
# Web presence classification
# --------------------------------------------------------------------------- #

def host_of(url: str) -> str:
    return (urlparse(url).hostname or "").lower().lstrip("www.")


def host_in(host: str, group: Iterable[str]) -> bool:
    return any(host == d or host.endswith("." + d) or d in host for d in group)


def name_tokens(company_name: str) -> set[str]:
    words = re.findall(r"[a-z0-9]+", company_name.lower())
    return {w for w in words if w not in STOPWORDS and len(w) > 2}


def looks_like_own_site(host: str, company_name: str) -> bool:
    """Heuristic: does this domain plausibly belong to the company?"""
    tokens = name_tokens(company_name)
    if not tokens:
        return False
    stem = host.split(".")[0].replace("-", "")
    return any(t in stem for t in tokens if len(t) > 3)


class PresenceClassifier:
    def __init__(self, delay: float = 2.0):
        self.delay = delay
        self._ua = list(USER_AGENTS)
        try:
            from ddgs import DDGS  # noqa: F401
            self.available = True
        except Exception:
            self.available = False

    def _search(self, query: str) -> list[dict[str, Any]]:
        from ddgs import DDGS
        attempts = ({"timeout": 20}, {})
        last: Exception | None = None
        for kwargs in attempts:
            try:
                with DDGS(**kwargs) as d:
                    return list(d.text(query, region="uk-en", max_results=12))
            except TypeError as exc:
                last = exc
                continue
        if last:
            raise last
        return []

    def classify(self, lead: Lead) -> None:
        """Set lead.verdict / own_site / contact_sources."""
        if not self.available:
            lead.verdict = "CHECK_FAILED"
            return

        time.sleep(self.delay + random.uniform(0, 1.0))
        query = f'"{lead.name}"'
        try:
            results = self._search(query)
        except Exception as exc:
            print(f"      [search] {exc.__class__.__name__}: {str(exc)[:100]}", file=sys.stderr)
            lead.verdict = "CHECK_FAILED"
            return

        own_site = ""
        weak_site = ""
        contacts: list[str] = []

        for r in results:
            url = r.get("href") or ""
            if not url:
                continue
            host = host_of(url)
            if not host or host_in(host, REGISTRY_HOSTS):
                continue
            if host_in(host, DIRECTORY_HOSTS):
                contacts.append(host)
                continue
            if host_in(host, SOCIAL_HOSTS):
                contacts.append(host)
                continue
            if host_in(host, WEAK_SITE_HOSTS):
                weak_site = weak_site or host
                continue
            if looks_like_own_site(host, lead.name):
                own_site = own_site or host

        lead.contact_sources = sorted(set(contacts))[:5]

        if own_site:
            lead.verdict, lead.own_site = "HAS_WEBSITE", own_site
        elif weak_site:
            lead.verdict, lead.own_site = "WEAK_SITE", weak_site
        elif contacts:
            lead.verdict = "HOT_LEAD"          # reachable, but no site of its own
        else:
            lead.verdict = "NO_PRESENCE"       # nothing at all — hard to contact


# --------------------------------------------------------------------------- #
# Output
# --------------------------------------------------------------------------- #

CSV_HEADER = [
    "№", "Company Name", "CRN", "Incorporation Date", "Type", "Accounts Category",
    "SIC Code & Description", "Registered Office Address", "Postcode",
    "Verdict", "Existing Site", "Contact Sources",
]


def write_csv(path: str, leads: list[Lead]) -> None:
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(CSV_HEADER)
        for i, l in enumerate(leads, 1):
            w.writerow([i, l.name, l.crn, l.incorporated, l.company_type, l.accounts,
                        l.sic, l.address, l.postcode, l.verdict, l.own_site,
                        ", ".join(l.contact_sources)])


def markdown_table(leads: list[Lead], limit: int = 10) -> str:
    cols = ["№", "Company Name", "CRN", "Inc.", "Accounts", "Verdict", "Contact via"]
    out = ["| " + " | ".join(cols) + " |",
           "| " + " | ".join(["---"] * len(cols)) + " |"]
    for i, l in enumerate(leads[:limit], 1):
        out.append(f"| {i} | {l.name} | {l.crn} | {l.incorporated} | {l.accounts} | "
                   f"{l.verdict} | {', '.join(l.contact_sources) or '—'} |")
    return "\n".join(out)


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #

def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--zip", default="ch_bulk.zip", help="Path to (or destination for) the bulk zip.")
    p.add_argument("--bulk-url", default=None, help="Override the bulk file URL.")
    p.add_argument("--sic", nargs="+", default=DEFAULT_SIC, help="SIC codes to include.")
    p.add_argument("--from-date", default="2012-01-01")
    p.add_argument("--to-date", default=date.today().isoformat())
    p.add_argument("--include-non-trading", action="store_true",
                   help="Also keep DORMANT / NO ACCOUNTS FILED (not recommended for sales).")
    p.add_argument("--check", type=int, default=60,
                   help="How many candidates to run the web-presence check on.")
    p.add_argument("--search-delay", type=float, default=2.0)
    p.add_argument("--seed", type=int, default=42, help="Sampling seed.")
    p.add_argument("--postcode-prefix", nargs="*", default=None,
                   help="Restrict to postcode prefixes, e.g. M L S1 (useful for local outreach).")
    p.add_argument("--out", default="web_service_leads.csv")
    p.add_argument("--stats-only", action="store_true",
                   help="Only print aggregate statistics; no search, no per-company output.")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    print("[1/4] Companies House bulk data (no API key required)", file=sys.stderr)
    try:
        zip_path = download_bulk(args.zip, args.bulk_url)
    except Exception as exc:
        print(f"ERROR downloading bulk data: {exc}", file=sys.stderr)
        return 2

    print("[2/4] Filtering …", file=sys.stderr)
    leads, stats = filter_companies(
        zip_path,
        sic_codes=set(args.sic),
        from_date=args.from_date,
        to_date=args.to_date,
        trading_only=not args.include_non_trading,
    )

    if args.postcode_prefix:
        prefixes = tuple(p.upper() for p in args.postcode_prefix)
        leads = [l for l in leads if l.postcode.upper().startswith(prefixes)]

    print(f"      scanned {stats['scanned']:,} companies", file=sys.stderr)
    print(f"      SIC match       : {stats['sic_match']:,}", file=sys.stderr)
    print(f"      active          : {stats['active']:,}", file=sys.stderr)
    print(f"      Ltd/LLP         : {stats['type_ok']:,}", file=sys.stderr)
    print(f"      in date range   : {stats['date_ok']:,}", file=sys.stderr)
    print(f"      trading         : {stats['trading']:,}", file=sys.stderr)
    print(f"      after postcode  : {len(leads):,}", file=sys.stderr)

    if args.stats_only:
        print(json.dumps(stats, indent=2))
        return 0

    random.seed(args.seed)
    random.shuffle(leads)
    sample = leads[: args.check]

    print(f"[3/4] Web-presence check on {len(sample)} candidates …", file=sys.stderr)
    clf = PresenceClassifier(delay=args.search_delay)
    if not clf.available:
        print("      WARNING: `ddgs` not installed — pip install ddgs", file=sys.stderr)

    for i, lead in enumerate(sample, 1):
        clf.classify(lead)
        print(f"      {i:>3}/{len(sample)}  {lead.verdict:<12} {lead.name}", file=sys.stderr)

    sample.sort(key=lambda l: (l.priority, l.name))

    print("[4/4] Writing output …", file=sys.stderr)
    write_csv(args.out, sample)

    counts: dict[str, int] = {}
    for l in sample:
        counts[l.verdict] = counts.get(l.verdict, 0) + 1
    print(f"\n      {args.out}  ({len(sample)} rows)", file=sys.stderr)
    for k, v in sorted(counts.items()):
        print(f"      {v:>4}  {k}", file=sys.stderr)

    hot = [l for l in sample if l.verdict == "HOT_LEAD"]
    print("\n### HOT LEADS — trading, no website of their own, reachable\n")
    print(markdown_table(hot, limit=25) if hot
          else "_No hot leads in this sample — raise --check or widen --sic._")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
