# Palladium Law Limited — Website

Fully static website for Palladium Law Limited. No build step, no frameworks,
no third-party integrations — plain HTML, CSS and vanilla JavaScript. Upload the
contents of this directory to any static hosting (or the root of a domain) and
it works as-is.

## Structure

```
index.html                  Home
about.html                  About Us
services.html               Expertise / Services (6 practice areas)
team.html                   Our Team
faq.html                    FAQ (10 questions, accordion)
contact.html                Contact + enquiry form
knowledge/
  index.html                Knowledge / article listing
  how-we-assess-a-financial-dispute.html
  documents-commonly-required-for-an-initial-review.html
  what-clients-can-expect-during-the-process.html
legal/
  privacy-policy.html
  website-terms.html
  regulatory-information.html   (includes Company Information)
  complaints.html
assets/
  css/style.css             Single stylesheet (design system + responsive)
  js/main.js                Nav, scroll animations, accordion, form behaviour
```

## Company data used (verified at Companies House, Aug 2026)

- Palladium Law Limited, company number **12855412**
- Incorporated 3 September 2020, status Active
- Registered office: Fulford House, Newbold Terrace, Leamington Spa, England, CV32 4EA
- "Check Our Company" links point to:
  https://find-and-update.company-information.service.gov.uk/company/12855412

No SRA number, licences, testimonials, success rates, client counts or awards
are claimed anywhere on the site, per the brief.

## Items awaiting client input (marked with TODO/comments in the HTML)

1. **Team profiles** — `team.html` contains a ready, commented-out card template.
   When photographs and approved bios arrive, populate the `.team-grid` and
   remove the interim statement. Photos should be 4:5 portrait, ~800×1000px.
2. **Direct email / phone** — `contact.html` has a commented-out block for
   confirmed contact details. Until then the page directs enquiries to the form.
3. **Form delivery** — by design the form performs no external calls and shows a
   success message client-side. Wiring submissions to an agreed destination
   (e.g. a simple mailto backend or host-provided form handler) is a separate,
   to-be-agreed step per the brief.

## Local preview

Any static server works, e.g.:

```
npx serve palladium-law
# or
python3 -m http.server -d palladium-law 8080
```
