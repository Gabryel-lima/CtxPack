#!/usr/bin/env bash
# Shell deployment fixture with orchestration helpers.

deploy() {
  run_checks
}

run_checks() {
  printf '%s\n' "ok"
}

main() {
  deploy
}

main "$@"