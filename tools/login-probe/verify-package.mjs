import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const exe=resolve(process.argv[2]);
const profile=await mkdtemp(join(tmpdir(),'zl-probe-native-'));
async function run() {
  await new Promise((resolveRun,reject)=>{
    const child=spawn(exe,['--smoke-test'],{env:{...process.env,ZL_PROBE_TEST_DATA:profile},stdio:'ignore'});
    const timer=setTimeout(()=>{child.kill();reject(Error('Native startup timeout'));},60000);
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.on('exit',code=>{clearTimeout(timer);code===0?resolveRun():reject(Error(`Native startup exit ${code}`));});
  });
}
await run(); await run();
const startup=JSON.parse(await readFile(join(profile,'startup-pass.json'),'utf8'));
const resume=JSON.parse(await readFile(join(profile,'resume-pass.json'),'utf8'));
assert.equal(startup.passed,true);assert.equal(resume.passed,true);
assert.equal(startup.packaged,true);assert.equal(resume.packaged,true);
assert.equal(startup.native,'win32');
await writeFile('native-verification.json',JSON.stringify({startup,resume,realPhoneLoginVerified:false},null,2));
console.log('PASS: native packaged startup, isolated renderer IPC, credential disk restoration, restart. Real phone pairing: unverified.');
