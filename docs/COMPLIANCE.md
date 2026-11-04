# The Necro-Oracle — Compliance Checklist, Self-Evaluation & Disqualification Risks

Source of truth: Kiroween 2026 Official Rules (kiroween.devpost.com/rules), read on Nov 3, 2026. If the rules page changes, the rules win over this file. Re-read the rules on Day 27 and Day 31.

Key dates (Pacific Time → Chile, UTC-3):
- Submission period: Oct 30, 2026 9:00 am PT → **Dec 4, 2026 2:00 pm PT = Dec 4, 19:00 Chile**. No extensions, no late submissions.
- Kiro credit request form (4,000 credits, one time): **by Dec 1, 2026 12:00 pm PT**; codes must be redeemed by Dec 4; redeemed credits expire Dec 31, 2026. → **Request on Day 1–2.**
- Judging: Dec 16, 2026 → Jan 29, 2027. **The app must stay up and free to test through Jan 29, 2027.**
- Winners announced around Feb 3, 2027.

---

## A. Eligibility
| # | Requirement | How we comply | Evidence | ✔ |
|---|---|---|---|---|
| A1 | Age of majority where the entrant resides | Fernando is an adult | — | ☐ |
| A2 | Country not excluded | Chile is **not** in the excluded list (excluded include Quebec, Argentina, Australia, Brazil, Indonesia, Italy, Philippines, Russia, UAE, OFAC-sanctioned…) | Rules §3 | ☐ |
| A3 | Not an employee/agent of AWS/Devpost or a judge's employer | Confirm | — | ☐ |
| A4 | Regional availability of Kiro features/models | Check kiro.dev regional restrictions for Chile; the app does not rely on Kiro features at runtime | — | ☐ |
| A5 | No financial/preferential support from AWS/Devpost for this project | None | — | ☐ |

## B. Project requirements
| # | Requirement | How we comply | Evidence | ✔ |
|---|---|---|---|---|
| B1 | **Working software application built using Kiro** (IDE/CLI/Web/Crew) | Built in Kiro IDE (specs, hooks, steering, agents, MCP, PBT) + Kiro CLI (headless in CI, custom agents) | `/.kiro/**`, commit history, `docs/KIRO_USAGE.md` | ☐ |
| B2 | **"Insufficient use of Kiro" = disqualification** | ≥ 8 specs, ≥ 6 hooks, ≥ 8 steering files, ≥ 4 custom agents, ≥ 4 MCP servers incl. our own, PBT enabled, CLI headless workflow, Kiro Power. Commit `.kiro` changes alongside code daily | `/.kiro`, Action logs | ☐ |
| B3 | Submitted to one category | **Frankenstein** | Devpost form | ☐ |
| B4 | **New project**, built during the Submission Period (after Oct 30, 2026 9:00 am PT) | Repo created Nov 3, 2026; first commit = Kiro steering + specs; no code reused from older projects | Git history from Nov 3 | ☐ |
| B5 | Disclose any pre-existing code/work (frameworks, libs, templates are allowed) | `docs/DISCLOSURES.md`: create-next-app scaffold, OSS libraries (list with licenses), PD card scans, any templates, fixture repos authored by Fernando during the period, third-party dead repos used only as *demo targets* (not part of our code) | `docs/DISCLOSURES.md` | ☐ |
| B6 | Runs consistently on its intended platform and functions as shown in video/text | Web (desktop browsers) is the primary platform; CLI/MCP as secondary. DEMO replay fallback, uptime check, smoke e2e run daily in CI | Playwright e2e in CI | ☐ |
| B7 | Third-party SDKs/APIs/data used per their terms | GitHub API (ToS; machine account allowed; PRs only on our fork), OSV.dev, PyPI JSON API, npm registry, E2B, Inngest, Upstash, Vercel, Amazon Bedrock, Amazon Polly — list in DISCLOSURES with ToS links | `docs/DISCLOSURES.md` | ☐ |
| B8 | Original work, owned by entrant, no IP violations | Own code; MIT license; PD art; no copyrighted music | — | ☐ |

## C. Submission requirements
| # | Requirement | How we comply | ✔ |
|---|---|---|---|
| C1 | **URL to the functional application** | `https://necro-oracle.vercel.app` (or custom domain). No login needed. If any credential is needed (e.g. ritual quota bypass), give it only in the private "testing instructions" field | ☐ |
| C2 | Free, unrestricted access for judges until judging ends (Jan 29, 2027) | Judge key raises quota; global circuit breaker + DEMO replay so it never "dies"; costs within free tiers/credits | ☐ |
| C3 | **Text description** of features and functionality | Devpost story (English): pitch, problem, audience, how it works, deck table, verification gates, surfaces, Kiro usage summary | ☐ |
| C4 | **Demo video < 3 minutes**, shows the project functioning on its platform, **public on YouTube**, link in form | Target 2:45; screen capture of real runs (not mockups); visibility set to Public (not Unlisted or Private) | ☐ |
| C5 | No third-party trademarks or copyrighted music/material in the video without permission | Self-made or royalty-free-with-license audio (keep license file); no "Rider-Waite" name; GitHub/AWS logos only incidentally on screen; no copyrighted film clips | ☐ |
| C6 | **Public GitHub repo** (not GitLab/Bitbucket) with all source, assets, and instructions to run | `github.com/<fernando>/necro-oracle`; README with setup, env vars list, `pnpm dev`, sandbox template build, fixture repos | ☐ |
| C7 | **Open-source license file**, detectable and visible in the repo's About section | `LICENSE` (MIT) at root, GitHub shows "MIT license" in About; third-party notices in `THIRD_PARTY_NOTICES.md` | ☐ |
| C8 | **`/.kiro` directory at the repo root**, NOT in `.gitignore` (any subfolder either) | CI check `scripts/check-kiro-dir.sh`: fails if `.kiro` missing, empty, or matched by `git check-ignore` | ☐ |
| C9 | Category (and bonus categories) identified | Frankenstein + Blog + Social Blitz (+ Best Kiro Crew App if built; + Best Demo is automatic) | ☐ |
| C10 | **Write-up on how Kiro was used** covering IDE/CLI/Web/Crew differences, custom agents, hooks, specs vs vibe coding, steering strategy, MCP, PBT, powers | `docs/KIRO_USAGE.md` + summary in Devpost; each section with concrete examples, numbers (e.g. "PBT found 4 bugs"), screenshots | ☐ |
| C11 | **English** for all materials (or translations) | Repo, video (English voice-over or English subtitles burned in), write-up, testing instructions in English | ☐ |
| C12 | Bonus — **Blog**: public post on a third-party platform during the period, mentions it's written **as part of the Kiroween 2026 hackathon**, URL in form | dev.to / Medium / Hashnode post | ☐ |
| C13 | Bonus — **Social Blitz**: post that **starts with `#KiroweenHackathon26`**, shares favorite thing about Kiro and how it changed the approach to development, posted during the period, link in form | X and/or LinkedIn, written by Fernando in his own words, with the "card of fate" image or a short clip | ☐ |
| C14 | Bonus — **Best Kiro Crew App** (optional): Crew app in a **separate GitHub repo** (same GitHub account), created during the period, with a write-up of its features | `necro-oracle-crew` repo (only if L3 is reached) | ☐ |
| C15 | Submit before the deadline; draft saved early | Draft on Devpost by Day 20; final submission Day 31 (Dec 3) | ☐ |

## D. Asset licensing checklist
| Asset | Source | License status | Action |
|---|---|---|---|
| Card art | 1909 "Roses & Lilies" RWS scans by Pamela Colman Smith on Wikimedia Commons | Public domain in the US (published 1909) and in life+70 countries (Smith †1951) | Keep each file's Commons URL + PD tag in `assets/cards/SOURCES.md`; never use U.S. Games 1971+ or "Universal Waite" recolors; don't use the "Rider-Waite" trademark |
| Phosphor-dithered cards, borders, sigils | Made by Fernando via `card-forge` | Own work → MIT/CC-BY | — |
| Fonts | e.g. VT323, IBM Plex Mono (OFL) | SIL OFL | Include license |
| Sounds/music (UI + video) | Self-made, or royalty-free with explicit license | Keep license text | No copyrighted music |
| TTS voice | Amazon Polly / Web Speech | Covered by AWS service terms | Credit in README |
| Demo target repos | Public repos with OSS licenses (only read & forked to our coven account) + fixture repos authored by Fernando | Respect each license; don't redistribute non-licensed code | Prefer licensed repos for public demos |

---

## E. Self-evaluation against the 5 judging criteria (each 20%)

| Criterion | What judges look for (rules) | Our honest target (/10) | How to max it out |
|---|---|---|---|
| **Potential Impact** | Real problem, real audience, demonstrated solution, useful/intuitive/accessible, "would someone use this?" | 8 | Show a **real** abandoned py2 repo revived with a real PR and green tests; quantify (files migrated, tests passing before/after, divergences caught). Show daily-use surfaces: GitHub Action comment on a PR, `necro read` in a terminal, `necro-mcp` inside Kiro. Accessibility: clickable commands, screen-reader-friendly terminal, reduced motion |
| **Technological Implementation (Kiro)** | Thorough and skillful Kiro use, thoughtful AI-dev strategy, variety of tools used impactfully, deep understanding, experimentation | 9–10 | 8+ specs (feature + bugfix + quick spec; requirements-first and design-first), chained hooks, layered steering (always/fileMatch/auto/manual), 4+ custom agents with least-privilege permissions, our own MCP server used *by Kiro while building*, PBT tied to EARS requirements, Kiro CLI headless in CI, Kiro Power packaging, optional Crew app. Write-up with **metrics and before/after anecdotes** (bugs PBT caught, hooks that prevented mistakes) |
| **Design** | Complete, coherent product experience, intuitive, polished, intentional | 8–9 | Tarot is the information architecture (spreads, orientation, evidence on card faces); consistent CRT design system; fast first reading (< 20 s); every error rendered in-world ("The spirits are silent: GitHub rate limit") with a clear next step; mobile-acceptable layout |
| **Innovation / Idea** | Creative, novel, unusual technologies or public resources combined uniquely | 9 | Differential testing **across two real runtimes** (py2.7 vs py3.12) + mutation testing as proof of resurrection; downgrade-only AI judge; self-evolving grimoires; oracle as MCP for other agents; PD 1909 art + OSV + PyPI public data |
| **Presentation** | Video shows end-to-end working project; pitch says problem/audience/why; easy to follow; creative & memorable | 8–9 | Script in KIRO_PLAYBOOK.md; real footage; voice of the oracle; captions; 3 acts (diagnosis → ritual → proof+PR) + 25 s of Kiro usage; also eligible for **Best Demo** if top 10% overall |

---

## F. Risks that could disqualify or sink the project

| Risk | Type | Mitigation |
|---|---|---|
| `.kiro` missing, ignored, or only partially committed | **Disqualifying** | CI check (C8) + pre-submission manual check on a fresh clone |
| "Insufficient use of Kiro" judgment | **Disqualifying** | Daily Kiro artifacts committed; `docs/KIRO_USAGE.md` written incrementally (a log entry per day); screenshots of specs/hooks/PBT |
| Code or work predating Oct 30, 2026 | **Disqualifying** | New repo, first commit Nov 3; DISCLOSURES for libraries/templates; do not copy old personal projects |
| No license visible in About section | **Disqualifying** | `LICENSE` at root on Day 1; check the About sidebar shows it |
| App not working when judges test (Dec 16 – Jan 29) | **Sinks score / may disqualify** | DEMO replay, circuit breaker, uptime monitor, keep free-tier limits in mind (E2B one-time $100 credit, Inngest 50k executions/month), freeze deploys after submission except hotfixes |
| Video > 3 min, private, or showing mockups | **Sinks / rule violation** | 2:45 target; Public on YouTube; real footage only |
| Copyrighted music/art/trademarks | **Rule violation** | Section D; no "Rider-Waite" name; no copyrighted songs |
| Materials not in English | **Rule violation** | Everything in English; Spanish only in Fernando's private notes (e.g. KIRO_PLAYBOOK.md should **not** be committed to the public repo, or be kept clearly as a personal note) |
| Third-party API ToS breach (e.g. spamming PRs upstream, scraping) | **Rule violation** | PRs only to our fork; rate limits; official APIs only |
| Secrets leaked in repo or video | Security / embarrassment | `PreToolUse` hook guarding `.env*`, secret scan in CI, blur terminal env in video |
| Credits run out (Kiro or LLM) | Sinks progress | Request Kiro credits Day 1; Mock LLM provider for tests; cache LLM calls by hash |
| Scope collapse (mutant ambition) | Sinks project | L0 bulletproof core by Day 10; cut rules in DESIGN.md §10 |
| Late submission (Devpost outage, upload issues) | **Disqualifying** | Draft by Day 20; final submit Day 31 (Dec 3); Dec 4 only for emergencies, before 19:00 Chile |
