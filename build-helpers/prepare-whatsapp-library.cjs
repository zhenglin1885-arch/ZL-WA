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
  return source.replace(
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
};
