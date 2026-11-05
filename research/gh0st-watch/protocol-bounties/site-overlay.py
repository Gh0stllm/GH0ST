"""Add Bounties discovery links to a complete copy of the GH0ST site."""

import argparse
from pathlib import Path


HOME_LINK = '<a class="roadmap-link" href="/roadmap/">Explore the roadmap <span>↗</span></a>'
BOUNTIES_LINK = '<a class="roadmap-link" href="/bounties/">Bounties preview <span>↗</span></a>'
LAUNCH_LINK = '<a class="roadmap-link" href="/bounties/">Open Bounties <span>↗</span></a>'
PLANNED_STATUS = '<span class="planned">○ Planned</span>'
PREVIEW_STATUS = '<span class="planned">◐ Preview</span>'
LAUNCH_STATUS = '<span class="planned">✓ Live</span>'
PLANNED_DESCRIPTION = 'Fund tasks, collect evidence-backed submissions and release escrowed rewards when the work is verified.'
PREVIEW_DESCRIPTION = 'Post tasks, submit evidence and review work. Reward escrow is planned.'
LAUNCH_DESCRIPTION = 'Sponsors lock GH0ST rewards on Robinhood Chain. The escrow pays the contributor after the creator approves their proof.'
CARD_LINK = '<br><a href="/bounties/">Open Bounties preview ↗</a>'
LAUNCH_CARD_LINK = '<br><a href="/bounties/">Open Bounties ↗</a>'


def replace_once(page, original, replacement):
    if page.count(original) != 1:
        raise ValueError(f"Expected one match for {original!r}")
    return page.replace(original, replacement, 1)


def homepage(page, launch=False):
    if launch:
        return replace_once(page, BOUNTIES_LINK, LAUNCH_LINK)
    return replace_once(page, HOME_LINK, HOME_LINK + '<br>' + BOUNTIES_LINK)


def roadmap(page, live_preview, launch=False):
    card_open = '<article class="protocol-card" id="bounties">'
    card_close = '</article>'
    if page.count(card_open) != 1:
        raise ValueError("Expected one Bounties roadmap card")
    before, remainder = page.split(card_open, 1)
    card, after = remainder.split(card_close, 1)
    if launch:
        card = replace_once(card, PREVIEW_STATUS, LAUNCH_STATUS)
        card = replace_once(card, PREVIEW_DESCRIPTION + CARD_LINK, LAUNCH_DESCRIPTION + LAUNCH_CARD_LINK)
        return before + card_open + card + card_close + after
    description = PLANNED_DESCRIPTION
    if live_preview:
        card = replace_once(card, PLANNED_STATUS, PREVIEW_STATUS)
        description = PREVIEW_DESCRIPTION
    card = replace_once(card, PLANNED_DESCRIPTION, description + CARD_LINK)
    return before + card_open + card + card_close + after


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, help='Original site root with index.html and roadmap/index.html')
    parser.add_argument('destination', type=Path, help='Separate overlay root')
    status = parser.add_mutually_exclusive_group()
    status.add_argument('--live-preview', action='store_true', help='Use Preview status after verifying the live backend')
    status.add_argument('--launch', action='store_true', help='Promote existing Preview copy after verifying the live escrow')
    args = parser.parse_args()
    if args.source.resolve() == args.destination.resolve():
        parser.error('Source and destination must be separate')

    home = homepage((args.source / 'index.html').read_text(encoding='utf-8'), args.launch)
    map_page = roadmap((args.source / 'roadmap/index.html').read_text(encoding='utf-8'), args.live_preview, args.launch)
    (args.destination / 'roadmap').mkdir(parents=True, exist_ok=True)
    (args.destination / 'index.html').write_text(home, encoding='utf-8')
    (args.destination / 'roadmap/index.html').write_text(map_page, encoding='utf-8')


if __name__ == '__main__':
    main()
