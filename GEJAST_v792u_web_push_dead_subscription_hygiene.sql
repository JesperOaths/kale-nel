-- GEJAST v792u — make scheduled web-push failure hygiene authoritative
--
-- Final certification found durable endpoint_gone/410 failures whose target subscriptions
-- remained claimable because the scheduled claim payload omitted its claim token/worker
-- metadata. The dispatcher therefore fell back to legacy mark RPCs that only marked the
-- job and did not disable the dead endpoint. This migration makes the normal scheduled
-- claim payload carry its authoritative claim metadata, hardens both current and legacy
-- mark paths to maintain subscription health, and reconciles already-proven dead endpoints
-- without sending any additional notification.
--
-- No frontend change; VERSION remains v792.

BEGIN;

CREATE OR REPLACE FUNCTION public.claim_web_push_jobs_v2(
  max_jobs integer DEFAULT 25,
  worker_id_input text DEFAULT 'dispatcher'::text,
  claim_token_input uuid DEFAULT gen_random_uuid()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_items jsonb := '[]'::jsonb;
BEGIN
  WITH picked AS (
    SELECT j.id
      FROM public.web_push_jobs j
      JOIN public.web_push_subscriptions s ON s.id = j.target_subscription_id
     WHERE j.status = 'queued'
       AND coalesce(j.trigger_kind, '') <> 'admin_targeted_test'
       AND s.disabled_at IS NULL
     ORDER BY j.created_at ASC, j.id ASC
     LIMIT greatest(coalesce(max_jobs, 25), 1)
     FOR UPDATE OF j SKIP LOCKED
  ), claimed AS (
    UPDATE public.web_push_jobs j
       SET status = 'claimed',
           claimed_at = now(),
           updated_at = now(),
           claim_token = claim_token_input,
           claimed_by = worker_id_input,
           claim_expires_at = now() + interval '15 minutes',
           attempt_count = coalesce(j.attempt_count, 0) + 1
     WHERE j.id IN (SELECT id FROM picked)
     RETURNING j.*
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'job_id', c.id,
    'claim_token', c.claim_token,
    'claimed_by', c.claimed_by,
    'target_subscription_id', c.target_subscription_id,
    'target_player_id', c.target_player_id,
    'target_player_name', c.target_player_name,
    'title', c.title,
    'body', c.body,
    'target_url', c.target_url,
    'endpoint', s.endpoint,
    'p256dh_key', s.p256dh_key,
    'auth_key', s.auth_key,
    'site_scope', c.site_scope,
    'target_scope', c.site_scope,
    'trigger_kind', c.trigger_kind,
    'request_kind', c.request_kind,
    'request_id', c.request_id,
    'notification_tag', c.notification_tag,
    'require_interaction', c.require_interaction,
    'vibrate_pattern', c.vibrate_pattern,
    'trace_id', c.trace_id
  ) ORDER BY c.created_at ASC, c.id ASC), '[]'::jsonb)
    INTO v_items
    FROM claimed c
    JOIN public.web_push_subscriptions s ON s.id = c.target_subscription_id;

  INSERT INTO public.web_push_job_attempts(job_id, worker_id, claim_token, stage, status)
  SELECT c.id, worker_id_input, claim_token_input, 'claim', 'ok'
    FROM public.web_push_jobs c
   WHERE c.claim_token = claim_token_input;

  RETURN jsonb_build_object('ok', true, 'claim_token', claim_token_input, 'items', v_items);
END
$function$;

CREATE OR REPLACE FUNCTION public.mark_web_push_job_sent_v763(
  job_id_input bigint,
  claim_token_input uuid,
  worker_id_input text,
  provider_message_id_input text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sub_id bigint;
BEGIN
  UPDATE public.web_push_jobs
     SET status = 'sent',
         sent_at = now(),
         marked_at = now(),
         updated_at = now(),
         error_stage = null,
         error_code = null,
         error_text = null,
         provider_message_id = provider_message_id_input
   WHERE id = job_id_input
     AND claim_token = claim_token_input
     AND claimed_by = worker_id_input
   RETURNING target_subscription_id INTO v_sub_id;

  IF v_sub_id IS NULL THEN
    RAISE EXCEPTION 'CLAIM_MISMATCH';
  END IF;

  INSERT INTO public.web_push_job_attempts(job_id, worker_id, claim_token, stage, status)
  VALUES (job_id_input, worker_id_input, claim_token_input, 'mark_sent_v763', 'ok');

  UPDATE public.web_push_subscriptions
     SET updated_at = now(),
         last_success_at = now(),
         last_error = null,
         failure_count = 0,
         is_active = true
   WHERE id = v_sub_id
     AND disabled_at IS NULL;

  RETURN jsonb_build_object('ok', true, 'job_id', job_id_input);
END
$function$;

CREATE OR REPLACE FUNCTION public.mark_web_push_job_failed_v763(
  job_id_input bigint,
  claim_token_input uuid,
  worker_id_input text,
  error_stage_input text,
  error_code_input text,
  error_text_input text,
  disable_subscription_input boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sub_id bigint;
BEGIN
  UPDATE public.web_push_jobs
     SET status = 'failed',
         failed_at = now(),
         marked_at = now(),
         updated_at = now(),
         error_stage = left(coalesce(error_stage_input, ''), 80),
         error_code = left(coalesce(error_code_input, ''), 80),
         error_text = left(coalesce(error_text_input, ''), 1000)
   WHERE id = job_id_input
     AND claim_token = claim_token_input
     AND claimed_by = worker_id_input
   RETURNING target_subscription_id INTO v_sub_id;

  IF v_sub_id IS NULL THEN
    RAISE EXCEPTION 'CLAIM_MISMATCH';
  END IF;

  INSERT INTO public.web_push_job_attempts(job_id, worker_id, claim_token, stage, status, error_code, error_text)
  VALUES (
    job_id_input,
    worker_id_input,
    claim_token_input,
    coalesce(error_stage_input, 'send'),
    'failed',
    left(coalesce(error_code_input, ''), 80),
    left(coalesce(error_text_input, ''), 1000)
  );

  UPDATE public.web_push_subscriptions
     SET updated_at = now(),
         last_error = left(coalesce(error_text_input, ''), 500),
         failure_count = coalesce(failure_count, 0) + 1,
         disabled_at = CASE
           WHEN disable_subscription_input THEN coalesce(disabled_at, now())
           ELSE disabled_at
         END,
         is_active = CASE
           WHEN disable_subscription_input THEN false
           ELSE is_active
         END
   WHERE id = v_sub_id;

  RETURN jsonb_build_object(
    'ok', true,
    'job_id', job_id_input,
    'disabled_subscription', disable_subscription_input
  );
END
$function$;

-- Keep the dispatcher's legacy fallback safe as defense in depth. These signatures and
-- defaults are already public contracts; only subscription-health side effects are added.
CREATE OR REPLACE FUNCTION public.mark_web_push_job_sent_v3(
  job_id_input bigint DEFAULT NULL::bigint,
  provider_message_id_input text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sub_id bigint;
BEGIN
  UPDATE public.web_push_jobs
     SET status = 'sent',
         sent_at = now(),
         marked_at = now(),
         updated_at = now(),
         error_stage = null,
         error_code = null,
         error_text = null,
         provider_message_id = provider_message_id_input
   WHERE id = job_id_input
   RETURNING target_subscription_id INTO v_sub_id;

  IF v_sub_id IS NOT NULL THEN
    UPDATE public.web_push_subscriptions
       SET updated_at = now(),
           last_success_at = now(),
           last_error = null,
           failure_count = 0,
           is_active = true
     WHERE id = v_sub_id
       AND disabled_at IS NULL;
  END IF;

  RETURN jsonb_build_object('ok', true, 'job_id', job_id_input);
END
$function$;

CREATE OR REPLACE FUNCTION public.mark_web_push_job_failed_v3(
  job_id_input bigint DEFAULT NULL::bigint,
  error_stage_input text DEFAULT NULL::text,
  error_code_input text DEFAULT NULL::text,
  error_text_input text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sub_id bigint;
  v_disable boolean := lower(coalesce(error_code_input, '')) IN ('endpoint_gone', 'subscription_auth_invalid');
BEGIN
  UPDATE public.web_push_jobs
     SET status = 'failed',
         failed_at = now(),
         marked_at = now(),
         updated_at = now(),
         error_stage = left(coalesce(error_stage_input, ''), 80),
         error_code = left(coalesce(error_code_input, ''), 80),
         error_text = left(coalesce(error_text_input, ''), 2000)
   WHERE id = job_id_input
   RETURNING target_subscription_id INTO v_sub_id;

  IF v_sub_id IS NOT NULL THEN
    UPDATE public.web_push_subscriptions
       SET updated_at = now(),
           last_error = left(coalesce(error_text_input, ''), 500),
           failure_count = coalesce(failure_count, 0) + 1,
           disabled_at = CASE WHEN v_disable THEN coalesce(disabled_at, now()) ELSE disabled_at END,
           is_active = CASE WHEN v_disable THEN false ELSE is_active END
     WHERE id = v_sub_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'job_id', job_id_input, 'disabled_subscription', v_disable);
END
$function$;

-- Reconcile only subscriptions with durable provider evidence that their latest delivery
-- result is endpoint_gone and with no later successful delivery. This is data-derived and
-- intentionally contains no subscription IDs.
WITH gone AS (
  SELECT j.target_subscription_id,
         max(j.failed_at) AS latest_gone_at,
         count(*)::integer AS gone_count,
         (array_agg(left(coalesce(j.error_text, 'endpoint_gone'), 500)
                    ORDER BY j.failed_at DESC NULLS LAST, j.id DESC))[1] AS latest_error
    FROM public.web_push_jobs j
   WHERE j.target_subscription_id IS NOT NULL
     AND lower(coalesce(j.status, '')) = 'failed'
     AND lower(coalesce(j.error_code, '')) = 'endpoint_gone'
   GROUP BY j.target_subscription_id
), proven_dead AS (
  SELECT g.*
    FROM gone g
   WHERE NOT EXISTS (
     SELECT 1
       FROM public.web_push_jobs s
      WHERE s.target_subscription_id = g.target_subscription_id
        AND lower(coalesce(s.status, '')) = 'sent'
        AND coalesce(s.sent_at, s.updated_at, s.created_at) > g.latest_gone_at
   )
)
UPDATE public.web_push_subscriptions s
   SET is_active = false,
       disabled_at = coalesce(s.disabled_at, p.latest_gone_at, now()),
       failure_count = greatest(coalesce(s.failure_count, 0), p.gone_count),
       last_error = coalesce(nullif(p.latest_error, ''), 'endpoint_gone'),
       updated_at = now()
  FROM proven_dead p
 WHERE s.id = p.target_subscription_id
   AND s.disabled_at IS NULL;

DO $verify$
DECLARE
  v_claim_src text;
  v_failed_src text;
  v_sent_src text;
  v_legacy_failed_src text;
BEGIN
  SELECT prosrc INTO v_claim_src
    FROM pg_proc
   WHERE oid = to_regprocedure('public.claim_web_push_jobs_v2(integer,text,uuid)');
  SELECT prosrc INTO v_failed_src
    FROM pg_proc
   WHERE oid = to_regprocedure('public.mark_web_push_job_failed_v763(bigint,uuid,text,text,text,text,boolean)');
  SELECT prosrc INTO v_sent_src
    FROM pg_proc
   WHERE oid = to_regprocedure('public.mark_web_push_job_sent_v763(bigint,uuid,text,text)');
  SELECT prosrc INTO v_legacy_failed_src
    FROM pg_proc
   WHERE oid = to_regprocedure('public.mark_web_push_job_failed_v3(bigint,text,text,text)');

  IF position('''claim_token'', c.claim_token' IN v_claim_src) = 0
     OR position('''claimed_by'', c.claimed_by' IN v_claim_src) = 0
     OR position('''target_subscription_id'', c.target_subscription_id' IN v_claim_src) = 0 THEN
    RAISE EXCEPTION 'v792u scheduled claim does not expose authoritative claim/target metadata';
  END IF;

  IF position('failure_count = coalesce(failure_count, 0) + 1' IN v_failed_src) = 0
     OR position('is_active = CASE' IN v_failed_src) = 0
     OR position('disabled_at = CASE' IN v_failed_src) = 0 THEN
    RAISE EXCEPTION 'v792u current failure marker does not maintain subscription health';
  END IF;

  IF position('last_success_at = now()' IN v_sent_src) = 0
     OR position('failure_count = 0' IN v_sent_src) = 0 THEN
    RAISE EXCEPTION 'v792u current success marker does not maintain subscription health';
  END IF;

  IF position('endpoint_gone' IN v_legacy_failed_src) = 0
     OR position('is_active = CASE' IN v_legacy_failed_src) = 0 THEN
    RAISE EXCEPTION 'v792u legacy fallback still leaves proven-dead subscriptions claimable';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.web_push_subscriptions s
      JOIN LATERAL (
        SELECT max(j.failed_at) AS latest_gone_at
          FROM public.web_push_jobs j
         WHERE j.target_subscription_id = s.id
           AND lower(coalesce(j.status, '')) = 'failed'
           AND lower(coalesce(j.error_code, '')) = 'endpoint_gone'
      ) g ON g.latest_gone_at IS NOT NULL
     WHERE s.disabled_at IS NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public.web_push_jobs ok
          WHERE ok.target_subscription_id = s.id
            AND lower(coalesce(ok.status, '')) = 'sent'
            AND coalesce(ok.sent_at, ok.updated_at, ok.created_at) > g.latest_gone_at
       )
  ) THEN
    RAISE EXCEPTION 'v792u proven-dead web-push subscription remains enabled';
  END IF;
END
$verify$;

COMMIT;
