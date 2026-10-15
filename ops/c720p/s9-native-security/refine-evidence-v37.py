"""Narrowly patch the existing evidence view; never replace its live extensions."""
from pathlib import Path
import sys
def once(body,old,new):
 if body.count(old)!=1:raise ValueError('evidence_source_changed:'+old[:70])
 return body.replace(old,new,1)
def patch(body):
 if 'humanReviewV37' in body:raise ValueError('already_refined')
 body=once(body,' <label>Classification<select id="type">',' <label>Human review<select id="humanReviewV37"><option value="all">All recordings</option><option value="verified">Verified person / people</option><option value="no_people">Verified no people</option><option value="uncertain">Unsure</option><option value="unreviewed">Not human-reviewed</option></select></label>\n <label>Detector classification<select id="type">')
 body=once(body,'<section id="analytics"','<p id="humanSummaryV37" role="status"></p>\n<section id="analytics"')
 body=once(body,'loaded:false};','loaded:false,humanReview:null};')
 marker='function name(rec){'
 helper="""function humanLabel(rec){if(isStill(rec))return 'still';if(!state.humanReview)return 'unavailable';const row=state.humanReview.clips?.[name(rec)];return row&&row.bytes===Number(rec.size)?row.label||'unreviewed':'unreviewed'}
function humanText(rec){return {person:'Human verified · one person',people:'Human verified · people',no_people:'Human verified · no people',uncertain:'Human review · unsure',unreviewed:'Not human-reviewed',unavailable:'Human verification unavailable',still:'Still-only evidence'}[humanLabel(rec)]}
"""
 body=once(body,marker,helper+marker)
 body=once(body,"function matches(rec,ignoreHour=false){", "function matches(rec,ignoreHour=false){const human=$('humanReviewV37').value,label=humanLabel(rec);if(human==='verified'&&!['person','people'].includes(label)||!['all','verified'].includes(human)&&label!==human)return false;")
 body=once(body,"$('source').value='all';$('type').value='all';", "$('source').value='all';$('type').value='all';$('humanReviewV37').value='all';")
 body=once(body,"['search','period','from','through','source','type','order']", "['search','period','from','through','source','type','order','humanReviewV37']")
 old="const resp=await r.fetch('/new/api/saved',{cache:'no-store'});if(!resp.ok)throw Error('archive response '+resp.status);const d=await resp.json();"
 new="const [saved,human]=await Promise.allSettled(['/new/api/saved','/new/api/archive-review?source=sd'].map(async path=>{const response=await r.fetch(path,{cache:'no-store'});if(!response.ok)throw Error('archive response '+response.status);return response.json()}));state.humanReview=human.status==='fulfilled'&&human.value.ok?human.value:null;if(saved.status!=='fulfilled')throw saved.reason;const d=saved.value;"
 body=once(body,old,new)
 body=once(body,"function analytics(records){", "function analytics(records){const humanVideos=records.filter(r=>!isStill(r));$('humanSummaryV37').hidden=mode==='today';$('humanSummaryV37').textContent=state.humanReview?humanVideos.filter(r=>['person','people'].includes(humanLabel(r))).length+' human-verified recordings with people · '+humanVideos.filter(r=>humanLabel(r)==='unreviewed').length+' not human-reviewed in this filter':'Human verification unavailable. Detector results remain separate from human review.';")
 body=once(body,"labels.append(text('strong',fmt(rec)),text('small',CATEGORY[category(rec)]));", "labels.append(text('strong',fmt(rec)),text('small',humanText(rec)));if(mode==='evidence')labels.append(text('small','Detector: '+CATEGORY[category(rec)]));")
 body=once(body,"const quality=text('div','Loading original evidence…');", "host.append(text('p',humanText(rec),'note'));const quality=text('div','Loading original evidence…');")
 body=once(body,"const mf=text('div','');mf.id='metrics';host.append(mf);", "const modelEvidence=document.createElement('details');modelEvidence.append(text('summary','Detector observations and sampled frames'));host.append(modelEvidence);const mf=text('div','');mf.id='metrics';modelEvidence.append(mf);")
 body=once(body,"host.append(text('div',explanation(rec),'note'));", "modelEvidence.append(text('div',explanation(rec),'note'));")
 body=once(body,"host.append(sampleEvidence)}", "modelEvidence.append(sampleEvidence)}")
 body=once(body,"host.append(text('h3','Timed observations'));", "modelEvidence.append(text('h3','Timed observations'));")
 body=once(body,"host.append(timeline,text('p','Select an observation to seek the original. Tracks apply only inside this clip.'))", "modelEvidence.append(timeline,text('p','Select an observation to seek the original. Tracks apply only inside this clip.'))")
 body=once(body,"action(t.id+' · '", "action(t.id.replace('Person ','Track ')+' · '")
 body=once(body,"'Maximum simultaneous candidates'", "'Sampled concurrent candidates'")
 body=once(body,"'recorded_at_amsterdam','classification','duration_ms'", "'recorded_at_amsterdam','human_verification','classification','duration_ms'")
 body=once(body,"fmt(r),CATEGORY[category(r)],duration(r)", "fmt(r),humanLabel(r),CATEGORY[category(r)],duration(r)")
 duplicated="else if(mode==='evidence'){cs.append(text('span',samples(rec)?samples(rec)+' sampled frames':'No sampled review','chip'));if(score(rec)!==null)cs.append(text('span','Peak '+(score(rec)*100).toFixed(1)+'%','chip'+(category(rec)==='possible'?' possible':'')))}"
 body=once(body,duplicated,"else if(mode==='evidence'&&!samples(rec))cs.append(text('span','No sampled detector review','chip'));")
 body=body.replace('Repeated person evidence','Repeated detector candidate').replace('<h2>Evidence and review coverage</h2>','<h2>Detector review coverage</h2>')
 body=once(body,"if(!document.hidden)refresh()},60000)", "if(!document.hidden&&window.SecurityTabActive!==false)refresh()},60000)")
 return body
if __name__=='__main__':
 source=Path(sys.argv[1]);target=Path(sys.argv[2]);target.write_text(patch(source.read_text(encoding='utf-8')),encoding='utf-8')
