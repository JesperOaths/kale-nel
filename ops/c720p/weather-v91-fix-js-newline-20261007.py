from pathlib import Path
import shutil,datetime
p=Path('/opt/homeassistant/config/www/c720p-weather-compact.html')
stamp=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
b=Path('/home/jespern/c720p-backups')/f'weather-v91-jsfix-{stamp}.html'
shutil.copy2(p,b)
s=p.read_text(encoding='utf-8')
bad='function fmtHpa(v){let n=Number(v);return isFinite(n)?Math.round(n)+" hPa":"-- hPa"}\\nfunction metricHtml'
if bad not in s:
    raise SystemExit('expected literal \\n bug not found')
s=s.replace(bad,'function fmtHpa(v){let n=Number(v);return isFinite(n)?Math.round(n)+" hPa":"-- hPa"}\nfunction metricHtml',1)
p.write_text(s,encoding='utf-8')
print('BACKUP='+str(b))
print('WEATHER_JS_LITERAL_NEWLINE_FIXED=1')
