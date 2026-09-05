import crypto from 'node:crypto';

// Delivery contract: first non-empty line is the title. Count body code points, not UTF-16 units.
export function analyzeChapterLength(text, policy) {
  const original=String(text ?? '');
  const lines=original.replace(/^\uFEFF/u,'').replace(/\r\n?/g,'\n').trim().split('\n');
  const body=lines.slice(1).join('\n');
  const counts={han:(body.match(/\p{Script=Han}/gu)||[]).length,visible:[...body.replace(/\s/gu,'')].length};
  const failures=[], reviews=[];
  const result=(decision)=>({decision,counts,policy:policy??null,draftSha256:crypto.createHash('sha256').update(original,'utf8').digest('hex'),failures,reviews});
  if(policy===undefined||policy===null){
    reviews.push({code:'CHAPTER_LENGTH_NOT_CONFIGURED',evidence:'No approved book-specific target; this is not a length pass.'});
    return result('NOT_CONFIGURED');
  }
  const object=typeof policy==='object'&&!Array.isArray(policy);
  const unset=object&&policy.min===null&&policy.max===null&&policy.approved===false;
  if(!object||policy.version!==1||!['han','visible'].includes(policy.metric)||!['review','reject'].includes(policy.enforcement)
    ||typeof policy.approved!=='boolean'||(!unset&&(!Number.isSafeInteger(policy.min)||!Number.isSafeInteger(policy.max)||policy.min<=0||policy.max<policy.min))){
    failures.push({code:'INVALID_CHAPTER_LENGTH_POLICY',evidence:'Require version 1, han/visible, positive integer min <= max, review/reject and boolean approved.'});
    return result('INVALID_POLICY');
  }
  if(unset||!policy.approved){
    reviews.push({code:'CHAPTER_LENGTH_NOT_CONFIGURED',evidence:'Target has not been confirmed for this book.'});
    return result('NOT_CONFIGURED');
  }
  const actual=counts[policy.metric];
  if(actual<policy.min||actual>policy.max){
    const issue={code:'CHAPTER_LENGTH_OUT_OF_RANGE',evidence:{actual,min:policy.min,max:policy.max,metric:policy.metric}};
    (policy.enforcement==='reject'?failures:reviews).push(issue);
    return result(policy.enforcement==='reject'?'REJECT':'REVIEW_REQUIRED');
  }
  return result('PASS');
}
