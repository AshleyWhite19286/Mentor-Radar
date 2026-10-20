"""Create a reviewable source bundle, excluding local data, keys and dependencies."""
import pathlib,zipfile
root=pathlib.Path(__file__).resolve().parent.parent
out=root/'dist'/'mentor-radar-stage1.zip'
out.parent.mkdir(exist_ok=True)
excluded={'node_modules','.next','.next-production','.git','dist','test-results','playwright-report','__pycache__'}
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as archive:
 for p in sorted(root.rglob('*')):
  relative=p.relative_to(root)
  if not p.is_file() or any(x in excluded for x in relative.parts):continue
  if p.name.startswith('local.sqlite') or p.name.endswith('.tsbuildinfo'):continue
  if p.name.startswith('.env') and p.name!='.env.example':continue
  archive.write(p,pathlib.Path('mentor-radar')/relative)
print(out)
