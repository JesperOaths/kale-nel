#!/usr/bin/env python3
"""Private read-only diagnosis for Outfit Comparisons and Automatic Person.

Queries only authenticated localhost metadata, never any media/images/vectors.
Emits aggregate counts; names, clip IDs and identities are NEVER printed.
"""
from collections import Counter,defaultdict
from pathlib import Path
from urllib.parse import urlencode
import json
import re
import urllib.error
import urllib.request
ROOT='http://127.0.0.1:8795'
CLIP=re.compile(r'^motion_[0-9]{13}[.]mp4$')

def get(path,maxbytes=6500000):
    try:
        with urllib.request.urlopen(ROOT+path,timeout=23) as r:
            raw=r.read(maxbytes+1)
            if len(raw)>maxbytes:raise RuntimeError('response_exceeded_limit')
        doc=json.loads(raw)
        if isinstance(doc,dict):return doc
    except (ValueError,urllib.error.HTTPError,urllib.error.URLError,TimeoutError):
        return None
    return None

def listing(folder):
    items=[];offset=0
    for i in range(220):
        q=urlencode({'workflow':'clip_folders_v40','tab':'approved',
                     'folder':folder,'offset':offset,'limit':24})
        report=get('/new/api/visual-review?'+q)
        if not isinstance(report,dict) or report.get('ok') is not True or not isinstance(report.get('items'),list):
            raise RuntimeError('approved_review_page_unavailable')
        items.extend(report['items'])
        offset+=len(report['items'])
        if offset>=int(report.get('total',0)):return items
        if not report['items']:raise RuntimeError('incomplete_approved_pagination')
    raise RuntimeError('approved_review_limit')

def main():
    sd=get('/new/api/saved')
    if not sd or sd.get('archive_mode')!='S9-microSD-only':
        raise RuntimeError('verified_sd_archive_unavailable')
    events={x.get('clip_no'):x for x in sd.get('events',[]) if isinstance(x,dict) and
            CLIP.fullmatch(str(x.get('clip_no','')))}
    base=get('/new/api/visual-review?workflow=clip_folders_v40&tab=inbox&offset=0&limit=24')
    manual=get('/new/api/s9-manual-recording-links')
    if not base or not manual or not isinstance(manual.get('items'),dict):
        raise RuntimeError('person_review_index_unavailable')
    grouped=defaultdict(set)
    for folder in base.get('folders',[]):
        if not isinstance(folder,dict) or not isinstance(folder.get('id'),str):continue
        name=folder['id']
        if int(folder.get('approved_clips') or 0)>0:
            for row in listing(name):
                clip=row.get('clip')
                if clip in events:grouped[name].add(clip)
    for key,entry in manual['items'].items():
        if not key.startswith('sd:') or key[3:] not in events or not isinstance(entry,dict):continue
        for folder in (entry.get('folders') if isinstance(entry.get('folders'),list) else
                       [entry.get('folder')] if entry.get('folder') else []):
            if isinstance(folder,str):grouped[folder].add(key[3:])
    claimed=set.union(set(),*grouped.values())
    refs=[]
    for person,clips in grouped.items():
        for name in sorted(clips):
            item=events.get(name,{})
            if item.get('person_count')==1 and not item.get('frames_with_distinct_multiple_person_boxes'):
                refs.append(name);break
    refs=refs[:8]
    counts=Counter()
    for clip in refs:
        result=get('/new/api/appearance-multivector?'+urlencode({'clip':clip}),250000)
        if not result or result.get('ok') is not True:
            counts['model_api_not_ready']+=1;continue
        if result.get('appearance_only') is not True or result.get('verified_same_person') is not False:
            counts['model_result_contract_fail']+=1;continue
        counts['references_with_results']+=1
        hits=result.get('results')
        if not isinstance(hits,list):counts['result_shape_invalid']+=1;continue
        counts['raw_rankings']+=len(hits)
        for hit in hits:
            if not isinstance(hit,dict) or hit.get('source')!='s9_sd' or hit.get('human_review_required') is not True:
                counts['invalid_provenance']+=1;continue
            cand=str(hit.get('clip_name',''))
            score=hit.get('similarity_percent')
            if cand not in events or type(score) not in (float,int):
                counts['outside_archive_or_invalid_score']+=1;continue
            if score>=80:counts['score_at_least_80']+=1
            if score>=65:counts['score_at_least_65']+=1
            if score<80:counts['drop_under_original_80']+=1
            if cand in claimed:
                counts['drop_already_approved']+=1;continue
            if abs(int(cand[7:20])-int(clip[7:20]))>72*60*60*1000:
                counts['drop_outside_72_hours']+=1;continue
            observed=events[cand]
            if observed.get('person_count')!=1 or observed.get('frames_with_distinct_multiple_person_boxes'):
                counts['drop_multiple_or_unconfirmed_people']+=1;continue
            if score<80:
                counts['otherwise_eligible_under_80']+=1
            else:
                counts['eligible_under_current_filter']+=1
    auto=get('/new/api/automatic-person')
    result={'read_only':True,'sd_originals':len(events),'reviewed_source_people':len(grouped),
       'reviewed_clip_references':len(claimed),'single_person_refs_sampled':len(refs),
       'outfit_filter_counts':dict(counts),
       'automatic_status':auto.get('status') if auto else 'unavailable',
       'automatic_rows':len(auto.get('items',[])) if auto else 0,
       'media_accessed':False,'review_writes':0,'camera_apk_modified':False}
    print('SECURITY_OUTFIT_PERSON_V72 '+json.dumps(result,sort_keys=True),flush=True)
if __name__=='__main__':main()
