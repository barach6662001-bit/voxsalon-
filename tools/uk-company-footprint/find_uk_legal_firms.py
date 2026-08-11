#!/usr/bin/env python3
"""
find_uk_legal_firms.py
======================

Discover UK legal-services companies (Companies House, SIC 69100/69101/69102/69109)
that appear to have **no digital footprint**, enrich them with their active
directors / PSCs, and export a verified CSV.

Pipeline
--------
1. Companies House Advanced Search API  -> base list (with rate limiting + 429 handling)
2. /company/{crn}/officers (+ PSC)       -> active directors / persons of significant control
3. Web search per company                -> "digital footprint" check
4. verified_uk_legal_firms.csv           -> final output + Markdown preview

IMPORTANT
---------
* Requires a free Companies House API key: https://developer.company-information.service.gov.uk/
  Export it as  CH_API_KEY  (or pass --api-key).
* The footprint check scrapes a public search engine via the `ddgs` library.
  Search engines rate-limit / block automated queries; the check is best-effort
  and marks companies CHECK_FAILED (never guesses) when a query cannot complete.
* Companies House data and officer/PSC names are PUBLIC but are personal data
  under UK GDPR. Use the output only for lawful purposes and honour the
  Companies House API terms of use. See README.md.

Author: generated for the VoxSalon repo's tools/ utilities.
"""

from __future__ import annotations

import argparse
import csv
import itertools
import os
import random
import sys
import time
from dataclasses import dataclass, field
from datetime import date
from typing import Any, Iterable
from urllib.parse import urlparse

import requests

# --------------------------------------------------------------------------- #
# Configuration / constants
# --------------------------------------------------------------------------- #

CH_BASE = "https://api.company-information.service.gov.uk"
ADVANCED_SEARCH = f"{CH_BASE}/advanced-search/companies"

# SIC codes for "Legal activities" and the descriptions Companies House uses.
SIC_DESCRIPTIONS: dict[str, str] = {
    "69100": "Legal activities",
    "69101": "Barristers at law",
    "69102": "Solicitors",
    "69109": "Activities of patent and copyright agents; other legal activities n.e.c.",
}

# Company types we accept (advanced-search `company_type` values).
COMPANY_TYPES = ["ltd", "llp"]

# Officer / PSC roles that count as an active owner/manager.
OWNER_ROLES = (
    "director",
    "member",
    "llp-member",
    "llp-designated-member",
    "managing-officer",
)

# Only these hosts are allowed to appear in search results for a company to
# still count as "no digital footprint". Anything else (a commercial site,
# LinkedIn, Facebook, a services page) fails the company.
REGISTRY_WHITELIST = (
    "gov.uk",                                        # find-and-update.company-information.service.gov.uk etc.
    "companieshouse.gov.uk",
    "company-information.service.gov.uk",
    "endole.co.uk",
    "companycheck.co.uk",
    "bizdb.co.uk",
    "opencorporates.com",
)

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
]

# Companies House global limit: 600 requests / 5 minutes ≈ 2 req/s.
CH_MIN_INTERVAL = 0.5  # seconds between Companies House calls


# --------------------------------------------------------------------------- #
# Data model
# --------------------------------------------------------------------------- #

@dataclass
class Company:
    name: str
    crn: str
    incorporated: str
    sic_codes: list[str]
    address: str
    company_type: str
    status: str
    owners: list[str] = field(default_factory=list)
    footprint_status: str = "NOT_CHECKED"

    def sic_label(self) -> str:
        return "; ".join(
            f"{c} — {SIC_DESCRIPTIONS.get(c, 'Unknown')}" for c in self.sic_codes
        )


# --------------------------------------------------------------------------- #
# Companies House client
# --------------------------------------------------------------------------- #

class CompaniesHouseClient:
    """Thin Companies House REST client with rate limiting and 429 backoff."""

    def __init__(self, api_key: str, session: requests.Session | None = None):
        if not api_key:
            raise ValueError("A Companies House API key is required.")
        self.api_key = api_key
        self.session = session or requests.Session()
        self.session.auth = (api_key, "")  # Basic auth: key as username, blank password
        self._last_call = 0.0

    # -- low level --------------------------------------------------------- #
    def _throttle(self) -> None:
        elapsed = time.monotonic() - self._last_call
        if elapsed < CH_MIN_INTERVAL:
            time.sleep(CH_MIN_INTERVAL - elapsed)

    def _get(self, url: str, params: Any = None, *, max_retries: int = 5) -> dict[str, Any]:
        for attempt in range(1, max_retries + 1):
            self._throttle()
            try:
                resp = self.session.get(url, params=params, timeout=30)
            except requests.RequestException as exc:
                wait = min(2 ** attempt, 30)
                print(f"    [network] {exc.__class__.__name__}; retry in {wait}s", file=sys.stderr)
                time.sleep(wait)
                continue
            finally:
                self._last_call = time.monotonic()

            if resp.status_code == 429:
                # Honour Retry-After if present, else exponential backoff.
                retry_after = int(resp.headers.get("Retry-After", min(2 ** attempt, 60)))
                print(f"    [429] rate limited; sleeping {retry_after}s", file=sys.stderr)
                time.sleep(retry_after)
                continue
            if resp.status_code == 401:
                raise PermissionError(
                    "401 Unauthorized from Companies House — check CH_API_KEY is a valid "
                    "'REST' / live application key."
                )
            if resp.status_code == 404:
                return {}
            if resp.status_code >= 500:
                wait = min(2 ** attempt, 30)
                print(f"    [{resp.status_code}] server error; retry in {wait}s", file=sys.stderr)
                time.sleep(wait)
                continue
            resp.raise_for_status()
            return resp.json()
        raise RuntimeError(f"Giving up on {url} after {max_retries} retries.")

    # -- high level -------------------------------------------------------- #
    def advanced_search(
        self,
        *,
        sic_codes: Iterable[str],
        company_types: Iterable[str],
        incorporated_from: str,
        incorporated_to: str,
        status: str = "active",
        page_size: int = 100,
        max_results: int | None = None,
    ) -> Iterable[dict[str, Any]]:
        """Yield raw company items from the Advanced Search API, paginating by start_index."""
        start_index = 0
        yielded = 0
        while True:
            params: list[tuple[str, str]] = [
                ("company_status", status),
                ("incorporated_from", incorporated_from),
                ("incorporated_to", incorporated_to),
                ("size", str(page_size)),
                ("start_index", str(start_index)),
            ]
            params += [("sic_codes", c) for c in sic_codes]
            params += [("company_type", t) for t in company_types]

            data = self._get(ADVANCED_SEARCH, params=params)
            items = data.get("items", []) or []
            hits = data.get("hits", 0)
            if not items:
                break
            for item in items:
                yield item
                yielded += 1
                if max_results and yielded >= max_results:
                    return
            start_index += len(items)
            if start_index >= hits:
                break

    def active_owners(self, crn: str) -> list[str]:
        """Return active directors/managers + active PSCs (deduped, in stable order)."""
        names: list[str] = []
        seen: set[str] = set()

        officers = self._get(f"{CH_BASE}/company/{crn}/officers", params={"items_per_page": 100})
        for off in officers.get("items", []) or []:
            if off.get("resigned_on"):
                continue
            role = (off.get("officer_role") or "").lower()
            if not any(r in role for r in OWNER_ROLES):
                continue
            name = (off.get("name") or "").strip()
            if name and name.lower() not in seen:
                seen.add(name.lower())
                names.append(f"{name} ({role})")

        psc = self._get(
            f"{CH_BASE}/company/{crn}/persons-with-significant-control",
            params={"items_per_page": 100},
        )
        for p in psc.get("items", []) or []:
            if p.get("ceased_on"):
                continue
            name = (p.get("name") or "").strip()
            if name and name.lower() not in seen:
                seen.add(name.lower())
                names.append(f"{name} (PSC)")

        return names


# --------------------------------------------------------------------------- #
# Digital-footprint check
# --------------------------------------------------------------------------- #

class FootprintChecker:
    """Best-effort 'no digital footprint' check via a public search engine."""

    def __init__(self, whitelist: Iterable[str] = REGISTRY_WHITELIST, delay: float = 2.0):
        self.whitelist = tuple(whitelist)
        self.delay = delay
        self._ua_cycle = itertools.cycle(USER_AGENTS)
        try:
            from ddgs import DDGS  # noqa: F401
            self._available = True
        except Exception:
            self._available = False

    def _run_search(self, DDGS, query: str) -> list[dict[str, Any]]:
        """Run one search, tolerant of ddgs API differences across versions.

        Newer ddgs (>=6/9.x) rotates User-Agents internally and does not accept a
        `headers` kwarg; older versions do. Try the richer call first, fall back.
        """
        ua = next(self._ua_cycle)
        attempts = (
            {"headers": {"User-Agent": ua}, "timeout": 20},  # older ddgs
            {"timeout": 20},                                  # ddgs >=9
            {},                                               # bare
        )
        last_exc: Exception | None = None
        for kwargs in attempts:
            try:
                with DDGS(**kwargs) as ddgs:
                    return list(ddgs.text(query, region="uk-en", max_results=10))
            except TypeError as exc:
                last_exc = exc  # unsupported kwarg for this version; try a simpler call
                continue
        if last_exc:
            raise last_exc
        return []

    def _host_whitelisted(self, url: str) -> bool:
        host = (urlparse(url).hostname or "").lower()
        return any(host == d or host.endswith("." + d) or host.endswith(d) for d in self.whitelist)

    def check(self, company_name: str, suffix: str) -> tuple[str, list[str]]:
        """
        Returns (status, offending_urls).

        status is one of:
          PASS         - all top results are registries/aggregators -> no footprint
          REJECTED     - a commercial/social/services result was found
          CHECK_FAILED - the search could not be completed (never a guess)
        """
        if not self._available:
            return "CHECK_FAILED", []

        from ddgs import DDGS

        query = f'"{company_name}" {suffix}'.strip()
        # be polite between engine hits
        time.sleep(self.delay + random.uniform(0, 1.0))
        try:
            results = list(self._run_search(DDGS, query))
        except Exception as exc:  # network / block / captcha
            print(f"    [search] {exc.__class__.__name__}: {str(exc)[:120]}", file=sys.stderr)
            return "CHECK_FAILED", []

        if not results:
            # No indexed pages at all -> genuinely no footprint.
            return "PASS", []

        offenders = [
            r.get("href", "")
            for r in results
            if r.get("href") and not self._host_whitelisted(r["href"])
        ]
        if offenders:
            return "REJECTED", offenders[:5]
        return "PASS", []


# --------------------------------------------------------------------------- #
# Assembly helpers
# --------------------------------------------------------------------------- #

def format_address(addr: dict[str, Any] | None) -> str:
    if not addr:
        return ""
    parts = [
        addr.get("premises"),
        addr.get("address_line_1"),
        addr.get("address_line_2"),
        addr.get("locality"),
        addr.get("region"),
        addr.get("postal_code"),
        addr.get("country"),
    ]
    return ", ".join(p for p in parts if p)


def build_company(item: dict[str, Any]) -> Company:
    return Company(
        name=item.get("company_name", "").strip(),
        crn=item.get("company_number", "").strip(),
        incorporated=item.get("date_of_creation", ""),
        sic_codes=item.get("sic_codes", []) or [],
        address=format_address(item.get("registered_office_address")),
        company_type=item.get("company_type", ""),
        status=item.get("company_status", ""),
    )


def type_suffix(company_type: str) -> str:
    return "LLP" if company_type == "llp" else "Ltd"


def write_csv(path: str, companies: list[Company]) -> None:
    header = [
        "№", "Company Name", "CRN", "Incorporation Date",
        "SIC Code & Description", "Registered Office Address",
        "Directors / PSC Names", "Footprint Check Status",
    ]
    with open(path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        writer.writerow(header)
        for i, c in enumerate(companies, 1):
            writer.writerow([
                i, c.name, c.crn, c.incorporated, c.sic_label(),
                c.address, " | ".join(c.owners) or "—", c.footprint_status,
            ])


def markdown_preview(companies: list[Company], limit: int = 10) -> str:
    cols = ["№", "Company Name", "CRN", "Incorporated", "SIC", "Directors / PSC", "Footprint"]
    lines = ["| " + " | ".join(cols) + " |", "| " + " | ".join(["---"] * len(cols)) + " |"]
    for i, c in enumerate(companies[:limit], 1):
        owners = ", ".join(o.split(" (")[0] for o in c.owners) or "—"
        sic = ", ".join(c.sic_codes)
        lines.append(
            f"| {i} | {c.name} | {c.crn} | {c.incorporated} | {sic} | {owners} | {c.footprint_status} |"
        )
    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #

def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--api-key", default=os.environ.get("CH_API_KEY", ""),
                   help="Companies House API key (or set CH_API_KEY).")
    p.add_argument("--from-date", default="2012-01-01", help="incorporated_from (YYYY-MM-DD).")
    p.add_argument("--to-date", default=date.today().isoformat(), help="incorporated_to (YYYY-MM-DD).")
    p.add_argument("--sic", nargs="+", default=list(SIC_DESCRIPTIONS.keys()), help="SIC codes.")
    p.add_argument("--limit", type=int, default=50,
                   help="Max companies to fetch from Companies House (footprint checks are slow).")
    p.add_argument("--out", default="verified_uk_legal_firms.csv", help="Output CSV path.")
    p.add_argument("--search-delay", type=float, default=2.0, help="Base seconds between search queries.")
    p.add_argument("--no-footprint", action="store_true",
                   help="Skip the search step (base list + owners only).")
    p.add_argument("--include-failed", action="store_true",
                   help="Keep companies whose footprint check could not complete (CHECK_FAILED).")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    if not args.api_key:
        print(
            "ERROR: no Companies House API key.\n"
            "  1. Register a free key: https://developer.company-information.service.gov.uk/\n"
            "  2. export CH_API_KEY=your_key   (or pass --api-key)\n",
            file=sys.stderr,
        )
        return 2

    try:
        client = CompaniesHouseClient(args.api_key)
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    checker = FootprintChecker(delay=args.search_delay)
    if not args.no_footprint and not checker._available:
        print("WARNING: `ddgs` not installed — footprint checks will report CHECK_FAILED.\n"
              "         pip install ddgs", file=sys.stderr)

    print(f"[1/3] Companies House advanced search "
          f"(SIC={','.join(args.sic)}, {args.from_date}..{args.to_date}, "
          f"types={','.join(COMPANY_TYPES)}, limit={args.limit})", file=sys.stderr)

    try:
        raw_items = list(client.advanced_search(
            sic_codes=args.sic,
            company_types=COMPANY_TYPES,
            incorporated_from=args.from_date,
            incorporated_to=args.to_date,
            max_results=args.limit,
        ))
    except PermissionError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 3

    companies = [build_company(it) for it in raw_items]
    print(f"      found {len(companies)} candidate companies", file=sys.stderr)

    print("[2/3] Fetching active directors / PSCs …", file=sys.stderr)
    for c in companies:
        try:
            c.owners = client.active_owners(c.crn)
        except Exception as exc:
            print(f"    [{c.crn}] officers error: {exc}", file=sys.stderr)
            c.owners = []

    verified: list[Company] = []
    if args.no_footprint:
        for c in companies:
            c.footprint_status = "SKIPPED"
        verified = companies
    else:
        print("[3/3] Digital-footprint check …", file=sys.stderr)
        for c in companies:
            status, offenders = checker.check(c.name, type_suffix(c.company_type))
            c.footprint_status = "PASS (no footprint)" if status == "PASS" else status
            tag = {"PASS": "✔ PASS", "REJECTED": "✘ has footprint", "CHECK_FAILED": "… check failed"}[status]
            print(f"    {tag}: {c.name}"
                  + (f"  -> {offenders[0]}" if offenders else ""), file=sys.stderr)
            if status == "PASS" or (status == "CHECK_FAILED" and args.include_failed):
                verified.append(c)

    write_csv(args.out, verified)
    print(f"\nSaved {len(verified)} companies -> {args.out}", file=sys.stderr)

    print("\n### Verified UK legal firms with no digital footprint (preview)\n")
    print(markdown_preview(verified, limit=10))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
