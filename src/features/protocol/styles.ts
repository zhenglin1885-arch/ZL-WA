// Scoped to the opt-in protocol view. Original web pages never receive these rules.
export const protocolChatStyles = `
.protocol-chat{--pc-bg:#fff;--pc-panel:#f6f5f3;--pc-text:#111b21;--pc-muted:#667781;--pc-line:#e9edef;--pc-active:#f0f2f5;--pc-accent:#008069;font-family:Arial,"Microsoft YaHei",sans-serif;line-height:1.4;position:relative;isolation:isolate}
.protocol-chat--dark{--pc-bg:#111b21;--pc-panel:#202c33;--pc-text:#e9edef;--pc-muted:#aebac1;--pc-line:#303d45;--pc-active:#2a3942;--pc-accent:#00a884}
.protocol-chat,.protocol-chat *{box-sizing:border-box}
/* Upstream reset assigns height:100% to every div. Native chat descendants
   need natural height; only the two scroll regions grow with flex. */
.protocol-chat div{height:auto}
.protocol-chat button{padding:7px 10px;margin:3px 2px;border:1px solid var(--pc-line);border-radius:8px;background:var(--pc-bg);color:var(--pc-text);font:inherit;line-height:1.3;cursor:pointer;flex-shrink:0}
.protocol-chat button:hover:not(:disabled){background:var(--pc-active)}
.protocol-chat button:focus-visible,.protocol-chat input:focus-visible,.protocol-chat textarea:focus-visible,.protocol-chat summary:focus-visible{outline:2px solid var(--pc-accent);outline-offset:2px}
.protocol-chat button:disabled{opacity:.45;cursor:default}
.protocol-chat__bubble{user-select:text}
.protocol-chat input,.protocol-chat textarea{user-select:text;padding:10px 14px;border:1px solid var(--pc-line);border-radius:12px;background:var(--pc-bg);color:var(--pc-text);font:inherit;line-height:1.4;min-width:0}
.protocol-chat .protocol-chat__sidebar{background:var(--pc-bg);border-color:var(--pc-line)!important;padding:0!important;color:var(--pc-text)}
.protocol-chat__account{padding:18px 16px 8px;flex-shrink:0}
.protocol-chat__title{display:flex;align-items:center;justify-content:space-between;gap:8px}
.protocol-chat__title h3{font-size:24px;font-weight:700;letter-spacing:-.5px}
.protocol-chat__title button{border:0;border-radius:50%;font-size:23px;width:40px;height:40px;padding:0}
.protocol-chat__title button:last-child{background:var(--pc-text);color:var(--pc-bg)}
.protocol-chat__account-status{font-size:12px;color:var(--pc-muted);margin:4px 0}
.protocol-chat__connection-menu{font-size:13px;padding:0}
.protocol-chat__connection-menu>summary{display:none}
.protocol-chat details>summary{cursor:pointer;color:var(--pc-muted);padding:3px 6px;list-style:none}
.protocol-chat .protocol-chat__search{background:var(--pc-panel);border:0;border-radius:24px;width:calc(100% - 32px)!important;margin:8px 16px!important;font-size:14px;padding:12px 16px}
.protocol-chat__new-chat{padding:8px 16px;display:flex;gap:4px;flex-shrink:0}
.protocol-chat__new-chat input{width:100%;font-size:13px}
.protocol-chat__filters{display:flex;gap:5px;padding:4px 16px 12px;flex-shrink:0;flex-wrap:wrap}
.protocol-chat__filters button{border-radius:20px;font-size:13px;margin:0;padding:7px 12px;color:var(--pc-muted)}
.protocol-chat__filters button[aria-pressed=true]{background:#d9fdd3;color:#075e54;border-color:#d9fdd3}
.protocol-chat__chat-list{overflow-y:auto;min-height:0;flex:1;padding:0 6px 8px;scrollbar-width:thin}
.protocol-chat__chat-row{position:relative;border-radius:9px;min-width:0}
.protocol-chat .protocol-chat__chat-button{display:flex!important;gap:12px;align-items:center;border:0;border-radius:9px;padding:12px 10px!important;margin:0!important;background:transparent!important;color:var(--pc-text)!important;min-height:82px}
.protocol-chat .protocol-chat__chat-button:hover,.protocol-chat .protocol-chat__chat-button[aria-pressed=true]{background:var(--pc-active)!important}
.protocol-chat__avatar{width:46px;height:46px;flex:0 0 46px;border-radius:50%;background:#dfe5e7;color:#64747b;display:flex;align-items:center;justify-content:center;font-size:19px;font-weight:600;overflow:hidden}
.protocol-chat__avatar img{width:100%;height:100%;object-fit:cover}
.protocol-chat__row-content{min-width:0;flex:1;display:block}
.protocol-chat__row-title{display:flex;align-items:center;gap:6px}
.protocol-chat__row-title strong{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;font-size:16px}
.protocol-chat__row-time{font-size:11px;color:var(--pc-muted);flex-shrink:0}
.protocol-chat__remark{display:block;font-size:12px;color:var(--pc-accent);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-height:16px}
.protocol-chat__preview{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--pc-muted)}
.protocol-chat__preview>span:first-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1}
.protocol-chat__unread{border-radius:20px;background:#25d366;color:#073b21;font-size:11px;min-width:19px;padding:1px 5px;text-align:center;font-weight:600}
.protocol-chat__row-actions{position:absolute;right:4px;top:45px;z-index:2;background:var(--pc-bg);border:1px solid var(--pc-line);border-radius:8px;font-size:12px}
.protocol-chat__row-actions:not([open]){border:0;background:transparent}
.protocol-chat__row-actions>summary{padding:3px 6px}
.protocol-chat__row-actions[open]{box-shadow:0 4px 15px #0002}
.protocol-chat__row-actions[open] button{display:block;border:0;margin:0;width:100%;text-align:left}
.protocol-chat__conversation{background:var(--pc-panel);position:relative;overflow:hidden;color:var(--pc-text)}
.protocol-chat__header{display:flex;align-items:center;gap:12px;padding:12px 20px;background:var(--pc-bg);border-bottom:1px solid var(--pc-line);flex-shrink:0;min-height:66px}
.protocol-chat__header strong{display:block;font-size:16px;font-weight:600}
.protocol-chat__header small{font-size:12px;color:var(--pc-muted)}
.protocol-chat__messages{flex:1;min-height:0;overflow-y:auto;padding:18px 6%;scrollbar-width:thin}
.protocol-chat__messages .protocol-chat__bubble{background:var(--pc-bg);border:0!important;border-radius:8px!important;box-shadow:0 1px 1px #0002;padding:9px 12px!important;min-width:120px;width:fit-content;font-size:14px}
.protocol-chat__messages .protocol-chat__bubble--own{background:#d9fdd3;color:#111b21}
.protocol-chat--dark .protocol-chat__messages .protocol-chat__bubble--own{background:#005c4b;color:#e9edef}
.protocol-chat__bubble>small{font-size:11px;color:var(--pc-muted);display:block;margin-bottom:4px}
.protocol-chat__message-actions{display:flex;gap:3px;margin-top:4px;flex-wrap:wrap}
.protocol-chat__message-actions button{font-size:11px;padding:2px 5px;margin:0;background:transparent;border:0;color:var(--pc-muted)}
.protocol-chat__composer{padding:10px 16px;background:var(--pc-bg);border-top:1px solid var(--pc-line);flex-shrink:0;max-height:45%;overflow-y:auto}
.protocol-chat__composer>textarea{background:var(--pc-panel);border:0;width:100%;min-height:46px!important;max-height:130px;resize:vertical;font-size:14px}
.protocol-chat__toolbar{display:flex;gap:3px;flex-wrap:wrap;align-items:center}
.protocol-chat__toolbar button{font-size:13px;padding:6px 9px;border:0;background:transparent}
.protocol-chat__toolbar button[aria-label="发送消息"]{margin-left:auto;background:#008069;color:#fff;border-radius:22px;min-width:70px}
.protocol-chat__composer>small{font-size:11px;color:var(--pc-muted)}
.protocol-chat__empty{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;text-align:center;color:var(--pc-muted);font-size:14px;padding:24px}
.protocol-chat__empty strong{font-size:26px;color:var(--pc-text);font-weight:500}
.protocol-chat__welcome-icon{width:100px;height:100px;border-radius:28px;display:flex;align-items:center;justify-content:center;background:#d9fdd3;color:#008069;font-size:50px}
.protocol-chat__latest{position:absolute;right:24px;bottom:190px;box-shadow:0 2px 8px #0002;font-size:12px!important;z-index:2}
.protocol-chat__conversation>p[role=status]{background:var(--pc-bg);padding:7px 20px;font-size:12px;flex-shrink:0;max-height:80px;overflow:auto}
.protocol-chat audio,.protocol-chat video{max-width:100%}
@media(max-width:1000px){.protocol-chat .protocol-chat__sidebar{width:260px!important;min-width:190px!important}.protocol-chat__row-time{display:none}.protocol-chat__messages{padding:12px 4%}}
`;
