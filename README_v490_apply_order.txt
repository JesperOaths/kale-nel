v490 apply order

1. Upload the files from this flat zip to the repo / site.
2. Run the separate SQL file:
   gejast_v490_pikken_name_speed_followup.sql

What changed in this patch:
- index homepage version drift fixed to the shared v490 line
- login/request dropdowns now fill from local cache immediately and refresh scoped names in the background
- gejast-config scoped name helpers now cache per-scope login/request name lists
- SQL now finalizes stale live Pikken games even when player rows are gone, by falling back to game state player snapshots
- SQL cleanup still removes empty/stale lobbies, but live games with 10+ rounds now try to finalize before deletion
