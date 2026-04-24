(function(){
  function pageSnapshot(){const scripts=document.scripts.length;const images=document.images.length;const perf=performance&&performance.getEntriesByType?performance.getEntriesByType('resource'):[];const resources=perf.map(r=>({name:r.name.split('/').pop(),duration:Math.round(r.duration||0),transferSize:r.transferSize||0})).sort((a,b)=>b.duration-a.duration).slice(0,25);return{ok:true,script_count:scripts,image_count:images,resource_count:perf.length,heavy_page:scripts>35||images>40,slowest_resources:resources};}
  window.GEJAST_PERF_GUARDS={pageSnapshot};
})();
