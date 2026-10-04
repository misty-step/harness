#!/bin/sh
# Capability inventory only. This lane never installs packages on runner-01.
set -eu
printf '%s\n' \
  'Follow-up for runner-01: replace Pi 0.87.1 plain RPC with the reviewed durable bridge.' \
  'Provision Node >=24, rg, and the locked pi-runtime npm dependencies through the runner owner.' \
  'Supply SUMMON_PI_MODELS_MODULE with createSummonModels() returning the selected native pi-ai Models and CredentialStore.' \
  'Keep credentials at their native owner; do not copy credentials or select a provider fallback.' \
  'Use config.extension=/absolute/source/agent-config/candidates/summon/pi-runtime/durable-rpc.ts.' \
  'Port and exercise the Rust owner/DO composition on runner-01 before enabling dispatch.' \
  'Port this slice to private misty-step/summon after access is available; compare protocol, authentication, context loading and dependency pins.'
