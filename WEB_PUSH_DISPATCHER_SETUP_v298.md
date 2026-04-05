# WEB PUSH DISPATCHER SETUP v298

Run `web_push_dispatcher.js` on a cron/worker with these env vars:
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- WEB_PUSH_VAPID_PUBLIC_KEY
- WEB_PUSH_VAPID_PRIVATE_KEY
- WEB_PUSH_VAPID_SUBJECT

Required npm packages:
- web-push
- @supabase/supabase-js

Suggested loop:
- every 15 to 30 seconds
- or a small always-on worker

Flow:
1. browser bell button registers service worker + subscription
2. subscription stored through `register_web_push_subscription`
3. app queues pushes through `queue_test_web_push` or `queue_web_push_for_player`
4. dispatcher claims jobs with `claim_web_push_jobs`
5. dispatcher sends real Web Push
6. dispatcher marks sent/failed
