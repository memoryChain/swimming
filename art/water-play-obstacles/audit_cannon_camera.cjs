const fs=require('fs');const {audit}=require('../../tests/helpers/cannon-venue-review.cjs');
const result={withArchitecture:audit(),withoutCeiling:audit({ignoreCeiling:true})};
const out=process.argv.includes('--before')?'cannon-occlusion-before.json':'cannon-occlusion-audit.json';
fs.writeFileSync(require('path').join(__dirname,out),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
