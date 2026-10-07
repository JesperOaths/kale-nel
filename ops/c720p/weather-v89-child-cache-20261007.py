from pathlib import Path
p=Path('/opt/homeassistant/config/www/c720p-weather-row.html')
s=p.read_text(encoding='utf-8')
s=s.replace('/local/c720p-weather-compact.html?v=WEATHER_EDGE_SYNC_20260829_2207','/local/c720p-weather-compact.html?v=WEATHER_REFINED_V89_20261007')
p.write_text(s,encoding='utf-8')
print('WEATHER_CHILD_CACHE=V89')
