---
name: primedrama-cloud-start
description: 在云端恢复、安装、启动和验证 PrimeDrama，保留 VIP 与现有数据。
---

只在云端 `/workspace/duanju` 工作，不使用 Windows。先读 `docs/使用说明.md`，核对 Git 状态及远端 `zikm15/duanju`。保留用户文件，不重置 main。

1. 若恢复到只有 README 的初始快照，先 `git fetch origin afterglow-v1-preview`。当前无本地工作分支且无改动时，可 `git switch -c afterglow-v1-preview FETCH_HEAD`；不要强制覆盖已有分支。已验证的新改动及时提交到预览分支保存。
2. Node.js 24、ffprobe 为运行前提；素材生成需要 Chromium、ffmpeg。依赖缺失运行 `bash scripts/install.sh`；报告具体失败命令，不将磁盘满或凭据缺失说成离线。
3. `npm run build` 后执行 `bash scripts/start-preview.sh`。先检查旧进程；更新代码时核对 PID 和命令后重启同一预览服务。日志 `.runtime/preview.log`。
4. 验证 `/api/health`、`/api/catalog`；运行 `npm test`、`npm run test:browser`。浏览器测试使用临时数据库和3101端口。
5. Home `/`、Discover `/discover`、Inbox `/inbox`、Profile `/profile`、VIP `/membership`、中文后台 `/admin`。
6. **保留 VIP 订阅**：前 N 集免费，Basic 全集有广告，Premium 全集无平台广告。免费范围须在服务端和媒体流接口校验。无金币、单集购买、广告解锁。
7. `DEMO_MODE=true` 才允许模拟会员；PayPal未连接，不真实扣款。正式环境关闭演示模式，配置至少16位独立管理密码，先接入账户和订阅验签。不要写出真实凭据。
8. `.runtime/` 的数据库和上传文件不得删除或提交GitHub。旧数据库/cookie名称为兼容保留。内置样片为原创虚构人物海报运镜，不是完整影视内容。
9. 容器操作遵循云端 runtime 技能，明确本地 Docker socket，保留代理和 CA。Buildx配置使用可写目录；磁盘紧张时只清理可再生成的构建缓存，不删除用户数据。
10. 当前工具没有 Sites 源码读取及公网发布能力。localhost仅供云端内部验证；真实公网部署见 `docs/公网部署.md`，不要猜测公开地址。
