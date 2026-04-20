v492 apply order

1. Upload the files from this flat zip.
2. Run the separate SQL file:
   gejast_v492_ballroom_pikken_presence_version_followup.sql

What this patch covers
- ballroom daily reset at 06:00 Amsterdam with full clear of king, admitted members, and pending applications from the previous cycle
- ballroom king/entry now route through a beer-request verification gate first
- pikken sticky bar now shows ready/total on the far right
- pikken reconnect button appears when the current player belongs to the live match
- pikken player cards grey out disconnected participants based on backend presence
- common version watermark source is now forced from gejast-config VERSION to reduce drift
- audit note included for the visible drink-request owner paths reviewed in this pass
