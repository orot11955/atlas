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

path.write_text(source, encoding='utf-8')
print('Schedule snapshot patch matcher hardened.')
