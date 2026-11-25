# ZL-WA 7.3.9 test19 · 登录关闭原因诊断修正

本包修正 test18 的诊断筛选遗漏，尚未验证用户账号恢复关联。保留原 WhatsApp 网页、界面、登录方式和已验证的业务逻辑，不引入新连接后台或额外登录窗口。

## 本次发现

官方公开代码的关闭原因分成两组：`WASocketCloseReason.CommsCloseReason`（22 类传输层原因）与 `WAWebAppCommsCloseReason.AppCommsCloseReason`（25 类登录/应用层原因）。test18 只保留前者，后者会被筛选成 `null`。已使用公开模块定义复现这个遗漏，并验证修正后完整通过页面观察、隔离桥、主界面留存和诊断导出。

新增保留的原因包括 `registration_failure`、`client_failure_not_authorized`、`client_failure_client_too_old`、`stream_error_code_515`、`stream_error_code_516`、`page_unload`、`refresh_qr` 等固定枚举。类别存在不代表故障账号实际发生了该事件；主动刷新、正常重启也会关闭连接，必须结合完整时间线判断。

新版 `connection.format` 为 5，继续在同一账号页面导航后保留有限事件。未知值仍记录为 `null`，并附带固定的 `payloadKind` 类型，区分缺少参数、字符串或对象。带 `reason` 数据字段的对象只筛选已知枚举，不调用 getter。不复制原始 reason、错误消息、验证码、二维码、凭据、Cookie、密钥或聊天内容，不拦截登录、不自动重试关联、不替换浏览器或官方原生 API。

## 测试步骤

1. 完全退出旧软件后安装本包。
2. 使用刚才新建的普通 WhatsApp 会话，按原界面正常扫码一次。
3. 如果仍失败或返回二维码，先不要手动刷新；打开右侧“代理”，点击“检查并复制发送诊断”，将完整日志发回。

不需要删除账号、清除旧会话数据、修改代理或使用 Console。

这是独立的 Windows 未签名诊断测试包，不推送正式更新，未发布 Mac。它修复的是诊断遗漏，不宣称已修复真实账号的登录故障。
