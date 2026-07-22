export const demoStatus={vm:'offline',dashboard:'offline',bot:'offline',region:'North Central US',vmName:'kyodobot-server',version:'0.2.0'};
export function getStatus(){return Promise.resolve({...demoStatus,checkedAt:null})}
