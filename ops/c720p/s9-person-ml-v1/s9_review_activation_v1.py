"""All-or-nothing manual-review handler activation for private 8795.

Do not call until signed 8794 review-open, pinned video, loaded callback, and
ticket forwarding are deployed and physically accepted. Roll back as a unit.
"""
import s9_manual_recording_links as registry
import s9_manual_original_byte_attestor_v252 as bytes_v252
import s9_manual_review_open_ticket_v1 as tickets
import s9_reviewed_media_session_v1 as sessions
import s9_original_review_http_hooks_v1 as endpoints
import s9_forward_manual_writer_v1 as writer

class Refused(RuntimeError):pass

def activate(H,rows,*,original_delegate,source_resolver,relay_review_routes_verified=False):
 if not relay_review_routes_verified or not callable(original_delegate) or not callable(source_resolver):
  raise Refused('signed_relay_and_original_provider_not_accepted')
 attestor=bytes_v252.IndependentOriginalAttestor()
 binder=registry.binding_protocol()
 t=tickets.Tickets(max_active=64,lifetime_seconds=300,verify_deadline_seconds=180)
 opened=sessions.OpenSessions(t,binder,attestor,max_active=16,lifetime=480)
 # Both write and playback attach only to this one in-process token registry.
 # The canonical recording-links V1 store/lock/audit remain authoritative.
 endpoints.install(H,sessions=opened,original_delegate=original_delegate,
                   verified_source=source_resolver)
 future=writer.install(H,registry,rows,attestor,binder,t)
 return dict(forward_only=True,writer=future,open_sessions=opened,
    historical_reviews_backfilled=False,automatic_identity_matching=False)
