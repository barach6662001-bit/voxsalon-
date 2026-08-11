# UK company research tools

Standalone data-engineering utilities (unrelated to the VoxSalon app — they live
under `tools/` so they stay isolated). Two scripts, different jobs:

| Script | Question it answers | Needs API key? |
|---|---|---|
| **`find_web_leads.py`** ← *start here for sales* | Which trading firms have **no website but are reachable**? | **No** — free bulk file |
| `find_uk_legal_firms.py` | Which firms have **zero digital footprint**, and who are their directors? | Yes (`CH_API_KEY`) |

---

## `find_web_leads.py` — leads for web / telephony services

Targets the commercially useful segment:

```
trading  +  no website of its own  +  a contact channel exists  ->  HOT_LEAD
```

Uses the **free Companies House bulk data product** (~470 MB, ~5.7 M companies,
no API key, refreshed monthly), so there is no registration step at all.

Verdicts, ranked best-first in the CSV:

| Verdict | Meaning | Worth pitching? |
|---|---|---|
| `HOT_LEAD` | Trading, no own site, but listed in a directory / regulator register / social | **Yes** |
| `NO_PRESENCE` | Nothing online at all | Hard — no way to make contact |
| `WEAK_SITE` | Only a Wix/WordPress.com-style page | Yes — upgrade pitch |
| `HAS_WEBSITE` | Already has its own domain | No |
| `CHECK_FAILED` | Search unavailable | Re-run |

```bash
pip install -r requirements.txt
python find_web_leads.py --check 60
# useful options:
#   --stats-only                    # aggregate counts, no search
#   --postcode-prefix M L S1        # local outreach only
#   --sic 69100 69102               # narrow the sector
#   --include-non-trading           # also keep DORMANT / NO ACCOUNTS FILED
#   --search-delay 3                # be gentler on the search engine
```

**Why "no phone / no contact form at all" is the wrong filter for sales:** a firm
with no website, no phone and no listing is a firm you cannot pitch. In the legal
SIC band most such records are dormant shells or formation-agent registrations.
Measured on the August 2026 register: of 18,125 active Ltd/LLP firms in SIC 69xxx
incorporated since 2012, **5,869 (32%) are DORMANT or have NO ACCOUNTS FILED** —
no operations, no budget, not customers. This script drops them by default.

Outreach is subject to **UK GDPR and PECR**: screen marketing calls against the
TPS/CTPS, identify yourself, and honour opt-outs.

---

## `find_uk_legal_firms.py` — zero-footprint research (API)

## What it does

1. **Companies House Advanced Search API** — pulls companies matching:
   - SIC codes `69100`, `69101`, `69102`, `69109`
   - `company_status = active` (this also covers *dormant / non-trading* companies —
     "dormant" is an **accounts** category in Companies House, **not** a company
     status, so dormant/non-trading firms are still returned under `active`)
   - `company_type` in `ltd`, `llp`
   - incorporated between `--from-date` (default `2012-01-01`) and `--to-date` (default today)
   - Rate limited to Companies House's **600 requests / 5 min**, with `Retry-After` /
     exponential backoff on HTTP 429.
2. **Owners** — `/company/{crn}/officers` (active, non-resigned directors/members) plus
   active `/persons-with-significant-control`.
3. **Digital-footprint check** — searches `"Company Name" Ltd|LLP` and inspects the top
   10 results. A company **PASSES** only if every result is a government registry or a
   recognised aggregator (`gov.uk`, `endole.co.uk`, `companycheck.co.uk`, `bizdb.co.uk`,
   `opencorporates.com`). Any commercial site / social profile / services page → **REJECTED**.
   If the search cannot complete it is marked **CHECK_FAILED** (never a guess).
4. **Output** — `verified_uk_legal_firms.csv` plus a Markdown preview of the first ~10 to stdout.

## Setup

```bash
cd tools/uk-company-footprint
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Free API key: https://developer.company-information.service.gov.uk/
export CH_API_KEY="your_live_rest_key"
```

## Run

```bash
python find_uk_legal_firms.py --limit 50
# options:
#   --from-date 2012-01-01 --to-date 2026-08-11
#   --sic 69100 69101 69102 69109
#   --limit 200            # cap companies pulled (footprint checks are slow)
#   --search-delay 2.0     # seconds between search queries
#   --no-footprint         # base list + owners only, skip search
#   --include-failed       # keep CHECK_FAILED rows in the CSV
#   --out verified_uk_legal_firms.csv
```

## Output columns

`№ | Company Name | CRN | Incorporation Date | SIC Code & Description | Registered Office Address | Directors / PSC Names | Footprint Check Status`

## Important limitations & compliance

- **API key required.** Without a valid Companies House key every request is `401`.
- **Search is best-effort.** Public search engines rate-limit / block automated queries
  and may need proxies; expect some `CHECK_FAILED` rows and tune `--search-delay`.
  Scraping search results is subject to those engines' terms of service.
- **This does not run inside a locked-down CI/sandbox** whose egress is restricted to
  package registries — the search step needs open outbound HTTP. Run it locally.
- **Personal data / UK GDPR.** Officer and PSC names are public but are personal data.
  Companies House publishes them under specific terms; only process the output for a
  lawful, clearly-defined purpose, and follow the
  [Companies House API terms of use](https://developer.company-information.service.gov.uk/).
  A "no online presence" list of named individuals is data you are responsible for using
  lawfully (e.g. not for unsolicited bulk contact that breaches PECR/GDPR).
- **"No footprint" ≠ dormant/shell.** A missing website is a weak signal; verify before
  acting on any single record.
