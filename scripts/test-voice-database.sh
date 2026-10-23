#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
voice_test_dir=$(mktemp -d /private/tmp/nightwatch-voice-db.XXXXXX)
initdb -D "$voice_test_dir/data" -A trust --no-locale --encoding=UTF8 > "$voice_test_dir/init.log" 2>&1
trap 'pg_ctl -D "$voice_test_dir/data" stop -m fast > /dev/null 2>&1 || true' EXIT
pg_ctl -D "$voice_test_dir/data" -l "$voice_test_dir/server.log" -o "-F -k $voice_test_dir -h '' -p 55439" start
psql -h "$voice_test_dir" -p 55439 -d postgres -v ON_ERROR_STOP=1 \
  -f supabase/tests/voice_fixture.sql \
  -f supabase/migrations/0035_voice_followup.sql \
  -f supabase/tests/voice_followup.sql \
  -f supabase/migrations/0036_voice_pilot.sql \
  -f supabase/tests/voice_pilot.sql
