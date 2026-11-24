const $ = id => document.getElementById(id);
const labels = { idle: '尚未连接', connecting: '正在连接', qr: '请扫码登录', connected: '协议连接已建立；请继续验证收发和重启恢复', disconnected: '连接已断开', reconnecting: '正在进行有限次数重连', stopped: '已断开，登录资料保留', error: '连接失败，请复制诊断', 'storage-error': '登录资料保存失败，连接已停止' };
let state = {}, sending = false;
function render(update) {
  if (update.message) {
    const row = document.createElement('p'); row.textContent = `${update.message.jid}\n${update.message.text}`;
    $('messages').prepend(row); while ($('messages').children.length > 30) $('messages').lastChild.remove(); return;
  }
  state = update; $('status').textContent = (labels[state.status] || state.status) + (state.lastCode ? `（代码 ${state.lastCode}）` : '');
  $('counts').textContent = `同步事件 ${state.syncEvents || 0} · 收到消息 ${state.received || 0} · 发送返回编号 ${state.sent || 0}`;
  $('qr').hidden = !state.qr; if (state.qr) $('qr').src = state.qr; else $('qr').removeAttribute('src');
  $('start').disabled = ['connecting', 'qr', 'connected', 'reconnecting'].includes(state.status);
  $('send').disabled = state.status !== 'connected' || sending;
}
window.probe.onState(render);
window.probe.invoke('state').then(render);
for (const action of ['start','stop','diagnostics']) $(action).onclick = async () => {
  $(action).disabled = true;
  try { await window.probe.invoke(action); if (action === 'diagnostics') $('notice').textContent = '诊断已复制，不包含二维码、密钥、手机号或消息正文。'; }
  catch { $('notice').textContent = '操作失败，请重试或重新启动工具。'; }
  finally { $(action).disabled = false; render(state); }
};
$('send').onclick = async () => {
  sending = true; render(state); $('notice').textContent = '正在提交一次消息，请勿重复发送。';
  try { await window.probe.invoke('send', $('number').value.trim(), $('text').value); $('notice').textContent = '已返回消息编号。请让收件人确认实际收到。'; }
  catch (error) { $('notice').textContent = /INVALID_NUMBER/.test(error.message) ? '请输入带国家码的有效手机号码。' : /INVALID_TEXT/.test(error.message) ? '请输入 1–2000 字的测试文字。' : '发送未确认。请先检查收件人是否收到，工具不会自动重发。'; }
  finally { sending = false; render(state); }
};
