#!/usr/bin/env python3
import glob, re, os, difflib
from datetime import datetime

base_dir = os.path.join(os.path.dirname(__file__), '..')
supabase_dir = os.path.join(base_dir, 'supabase')
pattern = os.path.join(supabase_dir, 'schema-*.sql')
files = glob.glob(pattern)

def sort_key(p):
    m = re.search(r'(\d+)', os.path.basename(p))
    if m:
        return (int(m.group(1)), os.path.basename(p))
    return (99999, os.path.basename(p))

files = sorted(files, key=sort_key)
regenerated_path = os.path.join(supabase_dir, 'schema-all-combined.regenerated.sql')
combined_header = f"-- Combined Schema — Regenerated from {len(files)} files on {datetime.utcnow().isoformat()}Z\n"

with open(regenerated_path, 'w', encoding='utf8') as out:
    out.write(combined_header)
    for f in files:
        out.write(f"\n-- ==== BEGIN: {os.path.basename(f)} ====\n")
        with open(f, 'r', encoding='utf8') as fh:
            out.write(fh.read())
        out.write(f"\n-- ==== END: {os.path.basename(f)} ====\n")

old_path = os.path.join(supabase_dir, 'schema-all-combined.sql')
diff_path = os.path.join(supabase_dir, 'schema-all-combined.diff')

# Read files as lines for diff
with open(old_path, 'r', encoding='utf8', errors='ignore') as fh:
    old_lines = fh.read().splitlines()
with open(regenerated_path, 'r', encoding='utf8', errors='ignore') as fh:
    new_lines = fh.read().splitlines()

udiff = list(difflib.unified_diff(old_lines, new_lines, fromfile='schema-all-combined.sql', tofile='schema-all-combined.regenerated.sql', lineterm=''))
with open(diff_path, 'w', encoding='utf8') as fh:
    if udiff:
        fh.write('\n'.join(udiff))
    else:
        fh.write('-- No differences found between existing combined file and regenerated output\n')

print('WROTE', regenerated_path)
print('WROTE', diff_path)
print('DIFF_LINES:', len(udiff))
