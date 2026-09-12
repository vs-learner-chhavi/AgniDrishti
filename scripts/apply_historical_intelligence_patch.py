"""
scripts/apply_historical_intelligence_patch.py

Applies the two minimum-necessary integration edits for Historical
Intelligence directly to your local repository files:

  1. app/page.tsx
     - adds the HistoricalIntelligence import
     - replaces the ENTIRE old "04 · HISTORICAL INTELLIGENCE" <section>
       (the synthetic Day 1..Day 10 bars) with <HistoricalIntelligence .../>

  2. app/globals.css
     - appends the new .hi* styles used by components/HistoricalIntelligence.tsx
       (does not touch or remove any existing rule, including the now-unused
       .historyGrid/.historyLead/.historyNumber/.historyTimeline rules --
       leaving dead CSS behind is harmless and safer than guessing which
       other selectors might still reference them)

WHY A SCRIPT INSTEAD OF ME EDITING THE FILES DIRECTLY
-------------------------------------------------------
This assistant does not have your actual app/page.tsx / app/globals.css on
disk -- only fragments surfaced by semantic search over the attached
project. Hand-reconstructing either file from those fragments and shipping
a full replacement risked silently dropping code I never saw. This script
instead performs a small, surgical, byte-exact edit against YOUR real
files and fails loudly (raises, changes nothing) if it can't find an
unambiguous anchor to edit -- it will never silently corrupt your file.

USAGE
-----
    python scripts/apply_historical_intelligence_patch.py

Run from the repository root, after copying in the other new/modified
files from this delivery (see CHANGES.md). Safe to re-run: it detects
whether the patch is already applied and skips it.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PAGE_PATH = REPO_ROOT / "app" / "page.tsx"
CSS_PATH = REPO_ROOT / "app" / "globals.css"

IMPORT_MARKER = "from '@/components/LiveMap';"
IMPORT_LINE = "\nimport HistoricalIntelligence from '@/components/HistoricalIntelligence';"

NEW_HISTORY_SECTION = (
    '<section id="history" className="section sectionBlock">'
    '<SectionHeading kicker="04 · HISTORICAL INTELLIGENCE" '
    'title="Persistence turns heat into context." '
    'text="Real NASA FIRMS observations for the selected source -- recurrence, '
    'baseline behaviour and change, not a synthetic trend."/>'
    '<HistoricalIntelligence eventId={selected.id} latitude={selected.lat} '
    'longitude={selected.lon} brightnessK={selected.brightness}/>'
    "</section>"
)


def patch_page_tsx() -> None:
    if not PAGE_PATH.exists():
        raise FileNotFoundError(f"Could not find {PAGE_PATH}")
    src = PAGE_PATH.read_text(encoding="utf-8")

    if "components/HistoricalIntelligence" in src and 'id="history"' in src and "HistoricalIntelligence eventId" in src:
        print(f"[skip] {PAGE_PATH} already patched.")
        return

    # --- 1. Add the import (once) ---
    if IMPORT_MARKER not in src:
        raise ValueError(
            f"Could not find the anchor import line ({IMPORT_MARKER!r}) in {PAGE_PATH}. "
            "Add manually: " + IMPORT_LINE.strip()
        )
    if "components/HistoricalIntelligence" not in src:
        src = src.replace(IMPORT_MARKER, IMPORT_MARKER + IMPORT_LINE, 1)

    # --- 2. Replace the whole old history <section> ---
    start = src.find('<section id="history"')
    if start == -1:
        raise ValueError(
            f'Could not find <section id="history" ...> in {PAGE_PATH}. '
            "The Historical Intelligence section may already have been modified -- "
            "please integrate HistoricalIntelligence.tsx into it manually."
        )
    end_marker = '<section id="alerts"'
    end = src.find(end_marker, start)
    if end == -1:
        raise ValueError(
            f'Found the start of the history section but not the following {end_marker!r} '
            f"in {PAGE_PATH}. Refusing to guess the section boundary -- please integrate manually."
        )

    old_section = src[start:end]
    if "historyTimeline" not in old_section and "HistoricalIntelligence" not in old_section:
        # Unexpected shape -- don't blindly overwrite something we don't recognise.
        raise ValueError(
            "The content between <section id=\"history\"> and <section id=\"alerts\"> "
            "did not look like the expected synthetic history block or an already-patched "
            "one. Refusing to overwrite -- please integrate manually. First 200 chars:\n"
            + old_section[:200]
        )

    src = src[:start] + NEW_HISTORY_SECTION + "\n  " + src[end:]
    PAGE_PATH.write_text(src, encoding="utf-8")
    print(f"[ok] Patched {PAGE_PATH}")


HI_CSS_MARKER = "/* === Historical Intelligence (Section 04) additions === */"

HI_CSS_BLOCK = f"""
{HI_CSS_MARKER}
.hiRoot{{padding:22px;border:1px solid #1b3248;border-radius:14px;background:linear-gradient(145deg,rgba(11,27,44,.96),rgba(5,15,26,.97));box-shadow:0 20px 65px rgba(0,0,0,.16);display:flex;flex-direction:column;gap:16px}}
.hiLoading,.hiEmpty{{min-height:160px;display:grid;place-items:center;justify-items:center;gap:7px;color:#5d7890;font-size:9px;text-align:center;padding:20px}}
.hiEmpty b{{color:#a9bfd0;font-size:12px}}
.hiProvenance{{display:flex;align-items:center;gap:7px;color:#617c93;font-size:8px;letter-spacing:.3px}}
.hiProvenance svg{{flex:none;color:#4fc9ea}}
.hiCardHead{{display:flex;align-items:center;gap:7px;margin-bottom:10px}}
.hiCardHead svg{{color:#4fc9ea;flex:none}}
.hiCardHead .label{{font-size:8px;letter-spacing:1px;color:#8aa2b4}}
.hiCardHead em{{margin-left:auto;color:#5c8298;font-size:8px;font-style:normal}}
.hiInfoTag{{display:inline-flex;align-items:center;gap:4px;color:#5fc9ea;cursor:help}}
.hiInfoTag svg{{color:#5fc9ea}}
.hiTimelineCard{{border:1px solid #183047;border-radius:12px;background:#081827;padding:16px}}
.hiChart{{width:100%}}
.hiEmptyInline{{color:#5d7890;font-size:9px;text-align:center;padding:30px 0}}
.hiTooltip{{display:flex;flex-direction:column;gap:4px;padding:10px 12px;border:1px solid #2b4a63;border-radius:8px;background:rgba(6,18,30,.97);box-shadow:0 12px 35px rgba(0,0,0,.4);font-size:8px;color:#cfe3ef;min-width:150px}}
.hiTooltip b{{font-size:9px;color:#eafcff;letter-spacing:.5px}}
.hiTooltip>span{{color:#7e96aa;margin-bottom:2px}}
.hiTooltip div{{display:flex;justify-content:space-between;gap:12px}}
.hiTooltip em{{color:#6f899f;font-style:normal}}
.hiTooltip strong{{color:#dff6ff;font-weight:700}}
.hiLegend{{display:flex;flex-wrap:wrap;gap:14px;margin-top:10px;padding-top:10px;border-top:1px solid #152a3d}}
.hiLegend>span{{display:flex;align-items:center;gap:5px;color:#7e96aa;font-size:7px;letter-spacing:.6px}}
.hiLegend i{{width:7px;height:7px;border-radius:2px;display:inline-block}}
.hiLegendMuted{{color:#4f6b80!important}}
.hiLegendMuted i{{background:#182c40;border:1px solid #26415a}}
.hiDaySnapshot{{margin-top:14px;padding-top:14px;border-top:1px solid #152a3d}}
.hiSnapshotGrid{{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}}
.hiSnapshotGrid>div{{border:1px solid #183047;border-radius:8px;background:#0a1c2c;padding:10px;text-align:center}}
.hiSnapshotGrid b{{display:block;font-size:14px;color:#64d4f4}}
.hiSnapshotGrid small{{display:block;color:#647d95;font-size:7px;margin-top:4px;letter-spacing:.4px}}
.hiSummaryGrid{{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}}
.hiCard{{border:1px solid #183047;border-radius:12px;background:#081827;padding:14px}}
.hiCard:hover{{border-color:#2b4a63}}
.hiCardHero{{grid-column:1/-1}}
.hiHeroBody{{display:flex;align-items:center;gap:28px;flex-wrap:wrap}}
.hiCardHero .hiPersistenceHeadline{{font-size:44px;margin-bottom:0}}
.hiKeyValRowsWide{{flex:1;min-width:220px;display:grid;grid-template-columns:repeat(2,1fr);gap:8px 26px;margin-bottom:0}}
.hiCardMuted{{display:flex;flex-direction:column;gap:6px}}
.hiKeyValRows{{display:flex;flex-direction:column;gap:7px;margin-bottom:8px}}
.hiKeyValRows>div{{display:flex;justify-content:space-between;gap:10px;font-size:8px;color:#7e96aa}}
.hiKeyValRows strong{{color:#dbeefb;font-size:9px}}
.hiPersistenceHeadline{{font-size:26px;font-weight:900;color:#64d4f4;letter-spacing:-1px;margin-bottom:10px}}
.hiPersistenceHeadline small{{display:block;color:#5c8298;font-size:8px;font-weight:500;letter-spacing:.5px;margin-top:2px}}
.hiStatusPill{{display:inline-block;font-size:7px;font-weight:900;letter-spacing:1px;padding:5px 8px;border-radius:5px;border:1px solid #2b4358;margin-bottom:6px}}
.hiStatusPill.hi-low{{color:#58dfb7;background:#10281f;border-color:#255d49}}
.hiStatusPill.hi-moderate{{color:#ffc267;background:#2c2316;border-color:#5b4828}}
.hiStatusPill.hi-high{{color:#f28b38;background:#2c1e12;border-color:#5b4020}}
.hiStatusPill.hi-extreme{{color:#ff816b;background:#2d181b;border-color:#66302c}}
.hiMuted{{color:#71879d;font-size:8px;line-height:1.6;margin:0}}
.hiFootnote{{color:#536e83;font-size:7px;margin-top:4px}}
.hiSatRow{{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}}
.hiSatBadge{{font-size:8px;font-weight:800;padding:5px 8px;border-radius:6px;border:1px solid #255d49;background:#10281f;color:#58dfb7}}
.hiDisclaimer{{color:#4f6b80;font-size:7px;line-height:1.6;border-top:1px solid #182f43;padding-top:12px;margin:0}}
@media(max-width:1050px){{.hiSummaryGrid{{grid-template-columns:repeat(2,1fr)}}}}
@media(max-width:700px){{.hiSummaryGrid{{grid-template-columns:1fr}}.hiSnapshotGrid{{grid-template-columns:1fr 1fr}}.hiHeroBody{{flex-direction:column;align-items:flex-start;gap:14px}}.hiKeyValRowsWide{{grid-template-columns:1fr}}}}
"""


def patch_globals_css() -> None:
    if not CSS_PATH.exists():
        raise FileNotFoundError(f"Could not find {CSS_PATH}")
    src = CSS_PATH.read_text(encoding="utf-8")
    marker_pos = src.find(HI_CSS_MARKER)
    if marker_pos == -1:
        # First-time install: append.
        src = src.rstrip("\n") + "\n" + HI_CSS_BLOCK
        CSS_PATH.write_text(src, encoding="utf-8")
        print(f"[ok] Appended Historical Intelligence styles to {CSS_PATH}")
        return

    # Upgrade in place: this assumes the HI block, once appended, is the
    # last thing in the file (true for a fresh install and for every
    # previous run of this script) -- replace from the marker to EOF.
    before = src[:marker_pos].rstrip("\n")
    new_src = before + "\n" + HI_CSS_BLOCK
    if new_src == src.rstrip("\n") + "\n" or src[marker_pos:].strip() == HI_CSS_BLOCK.strip():
        print(f"[skip] {CSS_PATH} Historical Intelligence styles already up to date.")
        return
    CSS_PATH.write_text(new_src, encoding="utf-8")
    print(f"[ok] Updated Historical Intelligence styles in {CSS_PATH}")


if __name__ == "__main__":
    try:
        patch_page_tsx()
        patch_globals_css()
    except Exception as exc:  # noqa: BLE001
        print(f"[FAILED] {exc}", file=sys.stderr)
        sys.exit(1)
    print("\nDone. Review the diff (git diff app/page.tsx app/globals.css) before committing.")
