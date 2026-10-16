# PayPal 订阅接入预留

本版本没有调用 PayPal API，不创建真实订单、不扣款。购买入口关闭，服务端 `/api/billing/subscribe` 返回明确的未开通错误。会员权限演示接口只在 `DEMO_MODE=true` 时存在。

后续真实接入必须与正式账户系统一起实现，不能继续以匿名演示 Cookie 作为计费账户。

## 建议的数据与接口

- 新增 users / subscriptions / billing_events 表，保存用户 ID、PayPal subscription ID、plan ID、状态、当前结算周期与已处理事件 ID。
- Basic 与 Premium 各建一个 PayPal Product/Plan，后台管理价格与币种；客户端只能提交内部 plan key，价格和 PayPal Plan ID 从服务端读取。
- `/api/billing/subscribe` 创建或返回用户对应订阅审批信息。
- `/api/billing/webhook` 通过 PayPal 官方验签方法验证通知，校验商户/计划映射，并按 event ID 幂等处理。
- 后端只根据已验证的 ACTIVE 订阅状态赋予权益；浏览器回跳、客户端按钮与本地存储都不能授予真实权限。
- 处理首次激活、续费、暂停、取消、过期、失败以及重复/乱序事件。增加主动状态核对任务。
- `/api/billing/cancel` 由已登录用户取消自己的订阅，并按业务规则处理本周期剩余权益。

## 必需配置

通过安全的云端密钥设置提供 PayPal client ID / secret、Webhook ID、sandbox/live 模式及两个 Plan ID。真实凭据不得放在前端、Git、日志或本文档里。

先完成 sandbox 订阅、取消、重复通知、伪造通知、失败支付等测试，再独立启用 live 环境。仅填写凭据不代表本版本已有真实支付能力。
