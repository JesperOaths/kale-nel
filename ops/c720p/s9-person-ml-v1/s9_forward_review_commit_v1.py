"""Forward-only binding transaction across trusted review ticket and canonical lock.

Never backfill old decisions, never create a separate store, never accept a
browser-supplied SHA. Hashing occurs outside the canonical store lock; recheck
source revision and CAS while holding the lock before durable readback.
"""
class Denied(RuntimeError):pass

def prepare_then_commit(*,source,name,review_ticket,expected_revision,tickets,
                        attestor,binding_protocol,locked_write):
 if type(expected_revision) is not int or expected_revision<0:
  raise Denied('review_revision_required')
 reserved=tickets.begin(review_ticket,source,name)
 try:
  # V252 verifies full SD/Drive original bytes. It may take many seconds.
  # Its verified timestamp must follow hashing, not precede the request.
  binding=binding_protocol.bind_new_decision(source,name,attestor)
  tickets.match_proof(review_ticket,binding)
  def revalidate():
   binding_protocol.require_unchanged(binding,attestor)
   tickets.match_proof(review_ticket,binding)
  result=locked_write(expected_revision,binding,revalidate)
  if not isinstance(result,dict) or result.get('persisted') is not True or result.get('revision')!=expected_revision+1:
   raise Denied('durable_readback_unverified')
  tickets.consumed(review_ticket)
  return result
 except BaseException:
  tickets.abort(review_ticket)
  raise
