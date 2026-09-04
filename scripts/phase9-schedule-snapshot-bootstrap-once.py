from pathlib import Path

path = Path('scripts/phase9-schedule-snapshot-once.py')
source = path.read_text(encoding='utf-8')

helper_marker = '\n\n# ---------------------------------------------------------------------------\n# Domain and persistence schema\n'
helper = '''\n\ndef indented_block(value: str, spaces: int = 8) -> str:\n    normalized = dedent(value).strip("\\n")\n    prefix = " " * spaces\n    return "\\n".join(prefix + line if line else "" for line in normalized.splitlines())\n'''

if 'def indented_block(' not in source:
    if helper_marker not in source:
        raise SystemExit('Unable to locate helper insertion marker.')
    source = source.replace(helper_marker, helper + helper_marker, 1)

start_marker = '''replace_once(\n    schedule_service,\n    dedent(\n        """\n                  try {'''
end_marker = '''\nreplace_once(\n    schedule_service,\n    "                  action: schedule.action,'''
start = source.find(start_marker)
end = source.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit('Unable to locate immutable schedule target patch block.')

section = source[start:end]
if section.count('dedent(') != 2:
    raise SystemExit(f'Expected two dedent calls in target block, found {section.count("dedent(")}')
section = section.replace('dedent(', 'indented_block(')
source = source[:start] + section + source[end:]

tail_start_marker = '\nworkflow_path = ".github/workflows/eventing-data-gate.yml"\n'
tail_end_marker = '\nprint("Phase 9 immutable schedule target patch applied.")\n'
tail_start = source.find(tail_start_marker)
tail_end = source.find(tail_end_marker, tail_start)
if tail_start < 0 or tail_end < 0:
    raise SystemExit('Unable to locate Eventing Data Gate patch tail.')

tail_end += len(tail_end_marker)
replacement_tail = r'''
workflow_path = ".github/workflows/eventing-data-gate.yml"


def replace_gate_count(
    sql: str,
    operator: str,
    old_value: int,
    new_value: int,
    label: str,
) -> None:
    old = f'''          test "$(psql "$DATABASE_URL" -Atc "{sql}")" {operator} {old_value}'''
    new = f'''          test "$(psql "$DATABASE_URL" -Atc "{sql}")" {operator} {new_value}'''
    replace_once(workflow_path, old, new, label)


replace_gate_count(
    "SELECT count(*) FROM outbox_events WHERE status = 'dispatched'",
    "-ge",
    8,
    10,
    "outbox count",
)
replace_gate_count(
    "SELECT count(*) FROM event_consumptions WHERE status = 'succeeded'",
    "-ge",
    8,
    10,
    "consumption count",
)
replace_gate_count(
    "SELECT count(*) FROM webhook_deliveries",
    "-eq",
    3,
    4,
    "delivery count",
)
replace_gate_count(
    "SELECT count(*) FROM webhook_deliveries WHERE status = 'succeeded'",
    "-eq",
    3,
    4,
    "delivery success count",
)
replace_gate_count(
    "SELECT count(*) FROM webhook_delivery_attempts WHERE status = 'succeeded'",
    "-eq",
    3,
    4,
    "attempt success count",
)
replace_gate_count(
    "SELECT count(*) FROM publication_schedules WHERE status = 'completed'",
    "-eq",
    1,
    2,
    "completed schedule count",
)
replace_gate_count(
    "SELECT count(*) FROM audit_logs WHERE action = 'content.publication-scheduled'",
    "-eq",
    2,
    3,
    "schedule audit count",
)

pending_schedule_assertion = '''          test "$(psql "$DATABASE_URL" -Atc "SELECT count(*) FROM publication_schedules WHERE status IN ('pending', 'processing', 'failed')")" -eq 0'''
target_assertions = pending_schedule_assertion + '''
          test "$(psql "$DATABASE_URL" -Atc "SELECT count(*) FROM publication_schedules WHERE action = 'publish' AND revision_id IS NOT NULL AND revision_number IS NOT NULL AND target_publication_id IS NULL")" -eq 1
          test "$(psql "$DATABASE_URL" -Atc "SELECT count(*) FROM publication_schedules WHERE action = 'withdraw' AND revision_id IS NULL AND revision_number IS NULL AND target_publication_id IS NOT NULL")" -eq 2
          test "$(psql "$DATABASE_URL" -Atc "SELECT count(*) FROM outbox_events WHERE aggregate_type = 'publication-schedule' AND event_type = 'publication.schedule.effect-applied'")" -eq 2'''
replace_once(
    workflow_path,
    pending_schedule_assertion,
    target_assertions,
    "schedule target database assertions",
)

print("Phase 9 immutable schedule target patch applied.")
'''

source = source[:tail_start] + replacement_tail + source[tail_end:]
path.write_text(source, encoding='utf-8')
print('Schedule snapshot patch matcher hardened.')
