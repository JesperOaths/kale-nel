#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const source=fs.readFileSync('ops/c720p/s9-native-security/security-face-folders-v22.html','utf8');
const script=source.split('<script id="security-face-folders-v22">')[1]?.split('</script>')[0];
assert.ok(script,'expected HTML face-folder script');
new vm.Script(script,{filename:'security-face-folders-v22.html'});
const selector=script.split('function comparisonCandidate(face){')[1]?.split('function evidenceSummary(records){')[0];
const summary=script.split('function evidenceSummary(records){')[1]?.split('function renderFacePipelineSummary(){')[0];
assert.ok(selector&&summary,'v29 gates must exist');
const candidate=new Function('face','idOK','return (function comparisonCandidate(face){'+selector+'})(face);');
const idOK=/^(?:unknown_[0-9]{5}|known_candidate_[A-Za-z0-9_-]{1,55})$/;
const check=(face)=>candidate(face,idOK);
assert.equal(check({person_id:'unknown_00003',match_status:'anonymous_similarity_unverified'}),'unknown_00003');
assert.equal(check({person_id:'known_candidate_Sara',match_status:'reference_similarity_unverified'}),'known_candidate_Sara');
for(const face of [
 {person_id:'unknown_00003',match_status:'new_anonymous_candidate'},
 {person_id:'unknown_00003',match_status:'anonymous_similarity_unverified',face_crop_requires_manual_review:true},
 {person_id:'unknown_00003',match_status:'anonymous_similarity_unverified',face_crop_padded_context_only:true},
 {person_id:'unknown_00003',match_status:'reference_similarity_unverified'},
 {person_id:'known_candidate_Sara',match_status:'anonymous_similarity_unverified'},
 {person_id:'../../secret',match_status:'anonymous_similarity_unverified'},
 {person_id:'unknown_00003',match_status:'not_comparable_model_unavailable'},
 ])assert.equal(check(face),null,'unverified or invalid face cannot become linked candidate');
const count=new Function('records','clipOK','return (function evidenceSummary(records){'+summary+'})(records);');
const clips=[
 {clip_no:'motion_1792000000000.mp4',face_deep_review_version:'s9_onphone_36_samples_person_or_tile_v4',face_model_state:'available_on_phone',face_candidates:[{},{}]},
 {clip_no:'motion_1792000000001.mp4',face_deep_review_version:'s9_onphone_36_samples_person_or_tile_v3',face_model_state:'not_tested_no_usable_face',face_candidates:[]},
 {clip_no:'motion_1792000000002.mp4',face_model_state:'unavailable_on_phone'},
 {clip_no:'bad.mp4',face_deep_review_version:'s9_onphone_36_samples_person_or_tile_v4',face_candidates:[{},{}]}
];
assert.deepEqual(count(clips,/^motion_[0-9]{13}[.]mp4$/),{total:3,reviewed:1,pending:2,models:1,notTested:1,faces:2});
assert.match(script,/rec\.face_deep_review_version!=='s9_onphone_36_samples_person_or_tile_v4'/);
assert.match(script,/Number\(rec\.face_detector_raw_hits\)>0/);
assert.match(script,/new Set\(g\.entries\.map\(e=>e\.key\)\)\.size/);
assert.match(source,/id="facePipelineStatus"/);
assert.doesNotMatch(source,/innerHTML\s*=/);
console.log('S9_FACE_EVIDENCE_REVIEW_V29_TEST_PASS');
