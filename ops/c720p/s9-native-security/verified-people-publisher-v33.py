"""Publish one approved batch incrementally; exits when its analysis completes."""
import sys,time
from pathlib import Path
sys.path.insert(0,'/home/jespern/c720p-home-hub/bin')
import s9_verified_people_v33 as people
import s9_sd_proxy_extension as proxy
import s9_archive_delete_v1 as deletion
people.review._sd_rows=lambda:{k:v for k,v in proxy.rows().items() if k not in deletion.deleted()}
def main():
 for _ in range(720):
  added=people.advance_registry();status=people.read('status.json',{})
  if added:print('VERIFIED_APPEARANCES_PUBLISHED',added,flush=True)
  if status.get('phase')=='complete':print('APPROVED_BATCH_PUBLISHED',flush=True);return
  time.sleep(20)
 raise RuntimeError('analysis_not_finished_within_four_hours')
if __name__=='__main__':main()
