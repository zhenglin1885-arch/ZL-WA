/* eslint-disable no-console -- Real Chromium media preview regression. */
import assert from 'node:assert/strict';
import { evaluate, socket } from './account-tools-cdp.mjs';

try {
  const result = await evaluate(`(async()=>{
    const React=require('react');
    const {createRoot}=require('react-dom/client');
    const ipc=require('electron').ipcRenderer;
    const original=ipc.invoke;
    const file='./features/accountTools/BulkMediaPreview';
    delete require.cache[require.resolve(file)];
    const Preview=require(file).default;
    const node=document.createElement('div');
    node.style.cssText='position:fixed;inset:20px;z-index:2147483000;background:white;color:black';
    document.body.append(node);
    const root=createRoot(node);
    const tick=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    const wait=async check=>{const deadline=Date.now()+5000;while(!check()){if(Date.now()>deadline)throw Error('Preview timed out: '+node.innerText);await new Promise(r=>setTimeout(r,30))}};
    const canvas=document.createElement('canvas');canvas.width=64;canvas.height=36;
    const context=canvas.getContext('2d');context.fillStyle='#634cff';context.fillRect(0,0,64,36);
    const image=canvas.toDataURL('image/png');
    const stream=canvas.captureStream(12);
    const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});
    const parts=[];
    recorder.ondataavailable=event=>parts.push(event.data);
    const stopped=new Promise(r=>{recorder.onstop=r});
    recorder.start();await new Promise(r=>setTimeout(r,200));context.fillStyle='#22cc88';context.fillRect(0,0,64,36);await new Promise(r=>setTimeout(r,150));recorder.stop();await stopped;stream.getTracks().forEach(track=>track.stop());
    const movie=await new Promise(r=>{const reader=new FileReader();reader.onload=()=>r(reader.result);reader.readAsDataURL(new Blob(parts,{type:'video/webm'}))});
    let reads=0;
    let late;
    ipc.invoke=function(channel,...args){
      if(channel==='account-tools-media-read'&&args[0].startsWith('qa-preview-')){
        reads++;
        if(args[0]==='qa-preview-late')return new Promise(r=>{late=r});
        if(args[0]==='qa-preview-error')return Promise.reject(Error('synthetic preview failure'));
        return Promise.resolve(args[0]==='qa-preview-video'?movie:image);
      }
      return original.call(this,channel,...args);
    };
    const media=(id,mime)=>({id:'qa-preview-'+id,mime,name:id,size:1024});
    try {
      root.render(React.createElement(Preview,{media:media('image','image/png'),type:'image'}));
      await wait(()=>node.querySelector('img')?.naturalWidth===64);
      const img=node.querySelector('img');
      if(img.getBoundingClientRect().width>190)throw Error('Image preview grew beyond thumbnail bounds');
      root.render(React.createElement(Preview,{media:media('video','video/webm'),type:'video'}));
      await wait(()=>node.querySelector('video')?.videoWidth===64);
      const video=node.querySelector('video');
      if(!video.controls||video.autoplay||video.preload!=='metadata'||!video.paused||video.getBoundingClientRect().width>336)throw Error('Video preview controls/size/autoplay incorrect');
      await video.play();
      root.render(React.createElement(React.Fragment));await tick();
      if(!video.paused||video.getAttribute('src')!==null)throw Error('Removed preview keeps media playback/resources');
      root.render(React.createElement(Preview,{media:media('late','image/png'),type:'image'}));
      await wait(()=>Boolean(late));
      root.render(React.createElement(Preview,{media:media('image','image/png'),type:'image'}));
      await wait(()=>node.querySelector('img')?.naturalWidth===64);
      late('data:image/png;base64,broken');await tick();
      if(node.querySelector('img')?.naturalWidth!==64)throw Error('Old file response replaced current preview');
      root.render(React.createElement(Preview,{media:media('error','video/webm'),type:'video'}));
      await wait(()=>node.textContent.includes('暂时无法预览此附件'));
      const before=reads;
      root.render(React.createElement(Preview,{media:media('document','application/pdf'),type:'document'}));await tick();
      if(reads!==before||node.querySelector('.bulk-media-preview'))throw Error('Document/audio UI changed');
      return {image:true,video:true,noAutoplay:true,cleanup:true,staleFileIgnored:true,failedPreviewKeepsAttachment:true,otherTypesUnchanged:true};
    } finally {
      root.unmount();node.remove();ipc.invoke=original;
    }
  })()`);
  assert(Object.values(result).every(Boolean));
  console.log(
    'PASS image/video previews, real video metadata/playback, removal cleanup, selection race protection, failure fallback and untouched document types',
    result,
  );
} finally {
  socket.close();
}
