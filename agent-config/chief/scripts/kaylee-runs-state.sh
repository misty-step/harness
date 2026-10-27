#!/usr/bin/env bash
# Hermes cron monitor for Kaylee's Boat workers: stable output (no ages or
# timestamps) so an unchanged fleet skips the agent run entirely. A failure to
# read workers exits nonzero and surfaces as a cron error, never as "no change".
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
kaylee-dispatch list | cut -f1,2,3,5,6,7
