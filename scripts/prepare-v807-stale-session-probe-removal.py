from pathlib import Path
import subprocess

# Load the original deterministic v807 staging script from its immutable source commit,
# then make only the two proven builder precision corrections before executing it.
source_commit = '0f97b5f0fc4f9467db7bf6b235067054cfaf533d'
path = 'scripts/prepare-v807-stale-session-probe-removal.py'
source = subprocess.check_output(['git', 'show', f'{source_commit}:{path}'], text=True)

# Scorer formatting differs slightly from the original literal fixture. Replace by
# function boundaries so only fetchMyName() is touched.
old = """if old not in s: raise SystemExit('scorer stale fetchMyName block missing')
p.write_text(s.replace(old,new,1))

# 4) Make the v806 canonical runtime guard durable for newer releases.
"""
new = """start=s.index('  async function fetchMyName(token){')
end=s.index('  function show(', start)
p.write_text(s[:start]+new+s[end:])

# 4) Make the v806 canonical runtime guard durable for newer releases.
"""
if old not in source:
    raise SystemExit('immutable v807 scorer apply anchor missing')
source = source.replace(old, new, 1)

# The checker itself is emitted from a Python triple-quoted string. Preserve a
# literal JavaScript \n escape instead of letting Python turn it into a newline
# inside the JS string literal.
target = r"const analyticsBlock=between(analytics,'  async function resolveProfile(){','\n  const visitorId');"
replacement = r"const analyticsBlock=between(analytics,'  async function resolveProfile(){','\\n  const visitorId');"
if target not in source:
    raise SystemExit('immutable v807 checker newline anchor missing')
source = source.replace(target, replacement, 1)

exec(compile(source, path, 'exec'), {'__name__': '__main__', '__file__': path})
