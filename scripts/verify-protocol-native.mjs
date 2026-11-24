import assert from 'node:assert/strict';
// Exercise the real privileged IPC and real utility processes using synthetic local messages only.
// The caller must supply an application instance with a disposable QA data directory.
export async function verifyProtocolBackend(evaluate) {
  const result = await evaluate(`(async()=>{
    const ipc=require('electron').ipcRenderer;
    const remote=require('@electron/remote');const fs=require('node:fs');const path=require('node:path');const {randomUUID}=require('node:crypto');
    const ids=['protocol-native-a-'+randomUUID(),'protocol-native-b-'+randomUUID()];
    const root=path.join(remote.app.getPath('userData'),'protocol-accounts');
    const owner='5511999999999@c.us',jid='5511888888888@c.us';
    try{
      const a=await ipc.invoke('protocol-request',ids[0],'state');
      const b=await ipc.invoke('protocol-request',ids[1],'state');
      if(a.status!=='idle'||b.status!=='idle')throw Error('Unexpected initial state');
      await ipc.invoke('protocol-request',ids[0],'stop');
      const seed={identity:{ownerId:owner,ownerIds:[owner],nickname:'QA Test',phone:'5511999999999'},chats:[{id:jid,name:'QA Contact',group:false,unread:0,timestamp:1795520000}],messages:[[jid,[{key:{id:'QA-RESTORE',remoteJid:jid,fromMe:false},message:{conversation:'QA SYNTHETIC MESSAGE'},messageTimestamp:1795520000,status:2}]]],contacts:[],pendingGroups:[]};
      fs.writeFileSync(path.join(root,ids[0],'messages.json'),JSON.stringify(seed),{mode:0o600});
      const restored=await ipc.invoke('protocol-request',ids[0],'state');
      const message=await ipc.invoke('protocol-request',ids[0],'messages',{jid});
      const isolated=await ipc.invoke('protocol-request',ids[1],'state');
      if(restored.ownerId!==owner||restored.status!=='idle'||message[0]?.id!=='QA-RESTORE'||isolated.chats.length)throw Error('Profile isolation failed');
      const diagnostics=JSON.stringify(await ipc.invoke('protocol-request',ids[0],'diagnostics'));
      if(diagnostics.includes(owner)||diagnostics.includes('QA SYNTHETIC MESSAGE'))throw Error('Diagnostic privacy failed');
      let invalid=false;try{await ipc.invoke('protocol-request','../escape','state');}catch{invalid=true;}if(!invalid)throw Error('Account path validation failed');
      await ipc.invoke('protocol-request',ids[0],'stop');
      const second=await ipc.invoke('protocol-request',ids[0],'state');
      if(second.chats.length!==1||second.status!=='idle')throw Error('Worker restart failed');
      const backend=remote.app.isPackaged?path.join(process.resourcesPath,'protocol-backend'):path.join(remote.app.getAppPath(),'..','tools','protocol-backend');
      const req=require('node:module').createRequire(path.join(backend,'package.json'));
      const jpeg=await req('sharp')({create:{width:2,height:2,channels:3,background:{r:20,g:40,b:60}}}).jpeg().toBuffer();
      if(!jpeg.length)throw Error('Image codec failed');
      const voiceFile=path.join(root,ids[0],'qa-voice.ogg');
      await new Promise((resolve,reject)=>require('node:child_process').execFile(req('ffmpeg-static'),['-v','error','-nostdin','-f','lavfi','-i','sine=frequency=440:duration=0.1','-ac','1','-c:a','libopus','-y',voiceFile],{timeout:20000,windowsHide:true},error=>error?reject(error):resolve()));
      if(fs.readFileSync(voiceFile).subarray(0,4).toString()!=='OggS')throw Error('Voice codec failed');
      const videoFile=path.join(root,ids[0],'qa-video.mp4');
      await new Promise((resolve,reject)=>require('node:child_process').execFile(req('ffmpeg-static'),['-v','error','-nostdin','-f','lavfi','-i','color=c=black:s=32x32:d=0.1','-c:v','libx264','-pix_fmt','yuv420p','-y',videoFile],{timeout:20000,windowsHide:true},error=>error?reject(error):resolve()));
      if(!fs.readFileSync(videoFile).subarray(0,32).includes(Buffer.from('ftyp')))throw Error('Video codec failed');

      return {workerStarted:true,isolatedProfiles:true,persistedWorkerReload:true,diagnosticsRedacted:true,accountPathsValidated:true,imageCodec:true,voiceCodec:true,videoCodec:true,realPhoneLoginVerified:false};
    }finally{for(const id of ids){await ipc.invoke('protocol-request',id,'stop').catch(()=>{});fs.rmSync(path.join(root,id),{recursive:true,force:true});}}
  })()`);
  assert(result, 'Protocol native verification returned no result');
  for (const key of [
    'workerStarted',
    'isolatedProfiles',
    'persistedWorkerReload',
    'diagnosticsRedacted',
    'accountPathsValidated',
    'imageCodec',
    'voiceCodec',
    'videoCodec',
  ])
    assert.equal(result[key], true, key);
  assert.equal(result.realPhoneLoginVerified, false);
  return result;
}
