const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { transformSync } = require('esbuild');
/* WA-JS 4.7.1 calls a removed WhatsApp LID getter from every group send.
 * Adapt only our embedded library, without changing WhatsApp's native modules
 * or replaying a failed send. Refuse an unexpected upstream bundle at build time.
 */
module.exports = function prepareWhatsAppLibrary(source) {
  const legacy = 'return n.UserPrefs.getMeLidUserOrThrow()';
  if (
    !source.includes('wppconnect-team/wa-js v4.7.1') ||
    source.split(legacy).length !== 2
  )
    throw new Error(
      'Unexpected WhatsApp library: review the LID compatibility adapter',
    );
  const lidCompatible = source.replace(
    legacy,
    `/* ZL_WA_LID_COMPAT_V1 */
    const prefs = n.UserPrefs;
    const me = typeof prefs.getMaybeMeLidUser === 'function'
      ? prefs.getMaybeMeLidUser()
      : typeof prefs.getMeLidUserOrThrow === 'function'
        ? prefs.getMeLidUserOrThrow()
        : undefined;
    const server = me && (me.server || String(me._serialized || me).split('@')[1]);
    if (!me || server !== 'lid')
      throw Object.assign(new Error('WhatsApp LID identity unavailable; message not prepared'), {code: 'ZL_LID_UNAVAILABLE'});
    return me`,
  );
  // Compile the same self-contained reader used by the host; do not fork the
  // native WhatsApp modules or replace the page's require/event emitter.
  const compiled = transformSync(
    readFileSync(
      join(__dirname, '../src/features/accounts/nativeConnection.ts'),
      'utf8',
    ),
    { loader: 'ts', format: 'cjs', target: 'es2022' },
  ).code;
  const holder = { exports: {} };
  new Function('module', 'exports', compiled)(holder, holder.exports);
  const install = holder.exports.configureNativeConnection.toString();
  const socket = '(0,r(54993).exportModule)(t,{Socket:"Socket"},e=>e.Socket)';
  const main =
    'l.onInjected(function(){const e=t=>{(e=>e===d.StreamMode.MAIN||e===d.StreamMode.QR)(t)';
  if (
    lidCompatible.split(socket).length !== 2 ||
    lidCompatible.split(main).length !== 2
  )
    throw Error(
      'Unexpected WhatsApp connection module: review native compatibility',
    );
  return (
    `/* ZL_WA_NATIVE_CONNECTION_V1 */(${install})();` +
    lidCompatible
      .replace(
        socket,
        `(0,r(54993).exportModule)(t,{Socket:"Socket"},e=>e.Socket);const legacy=Object.getOwnPropertyDescriptor(t,"Socket").get;Object.defineProperty(t,"Socket",{configurable:true,enumerable:true,get(){const a=window.__zlWaNativeConnection;return a?.read().source==="backend-event-bus"?a.socket():legacy.call(this)}})`,
      )
      .replace(
        main,
        'l.onInjected(function(){const a=window.__zlWaNativeConnection;if(a?.read().source==="backend-event-bus"){a.onReady(()=>c.internalEv.emit("conn.main_ready"));return;}const e=t=>{(e=>e===d.StreamMode.MAIN||e===d.StreamMode.QR)(t)',
      ) +
    ';if(window.WPP)Object.defineProperty(window.WPP,"__zlNativeConnectionCompat",{value:1,configurable:true});'
  );
};
