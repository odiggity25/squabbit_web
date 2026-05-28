#!/usr/bin/env bash
# Rebuild llms-full.txt from the squabbit_cloud AI knowledge base.
# Run after refreshing the in-app AI help KB so external LLM crawlers stay in sync.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KB_DIR="${SQUABBIT_KB_DIR:-$HOME/code/squabbit_cloud/functions/src/knowledge}"
OUT="$SCRIPT_DIR/llms-full.txt"

if [[ ! -d "$KB_DIR" ]]; then
    echo "Knowledge base directory not found: $KB_DIR" >&2
    exit 1
fi

declare -a SECTIONS=(
    "01-setup-and-lifecycle.md|Setup and Lifecycle"
    "02-scoring-formats.md|Scoring Formats"
    "03-handicaps.md|Handicaps"
    "04-flights-teams-pairings.md|Flights, Teams, Pairings, and Tee Times"
    "05-score-entry-and-stats.md|Score Entry and Stats"
    "06-leaderboards-and-output.md|Leaderboards and Output"
    "07-communication-and-feed.md|Communication and Feed"
    "08-settings-errors-faq.md|Settings, Errors, and FAQ"
)

{
    printf '# Squabbit - Full Product Knowledge Base\n\n'
    printf '> This is the full product knowledge base used by Squabbits in-app AI assistant. It covers every feature, format, setting, and edge case in Squabbit. AI models and search crawlers can use this as the authoritative reference for what Squabbit does.\n\n'
    printf 'Companion to /llms.txt. Source of truth for the in-app AI assistant. Homepage: https://www.squabbitgolf.com\n'

    for entry in "${SECTIONS[@]}"; do
        file="${entry%%|*}"
        title="${entry##*|}"
        if [[ ! -f "$KB_DIR/$file" ]]; then
            echo "Missing knowledge file: $KB_DIR/$file" >&2
            exit 1
        fi
        printf '\n---\n\n# %s\n\n' "$title"
        cat "$KB_DIR/$file"
    done
} > "$OUT"

echo "Wrote $OUT ($(wc -l < "$OUT") lines)"
