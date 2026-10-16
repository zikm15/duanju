# 开源组件及素材说明

本项目优先使用允许商业使用的成熟开源组件，并保留其许可证。具体版本以 `package-lock.json` 为准。

| 组件 | 用途 | 许可证 |
| --- | --- | --- |
| React / React DOM | 用户界面 | MIT |
| Express | HTTP 服务 | MIT |
| Multer | 上传处理 | MIT |
| Zod | 输入校验 | MIT |
| Helmet | HTTP 安全头 | MIT |
| express-rate-limit | 管理登录限流 | MIT |
| Lucide | 界面图标 | ISC |
| SQLite | 数据存储（Node.js 内置接口） | Public Domain |
| Vite | 开发与构建 | MIT |
| TypeScript | 类型检查 | Apache-2.0 |
| Playwright | 浏览器验证及素材渲染 | Apache-2.0 |

其他间接运行依赖主要为 MIT、ISC、BSD-3-Clause。完整安装依赖的许可证文件位于各自 `node_modules` 包目录，应在分发相关组件时保留。

浏览器界面使用系统字体，不从第三方加载字体或跟踪脚本。海报、剧名、简介和样例视频为本次实现生成的原创演示素材，不包含引入的影视片段，也不表示已获得任何真人短剧内容授权。

云端 FFmpeg 用于生成演示素材和探测上传格式，不打包到网页；当前系统 FFmpeg 构建包含 GPL 组件。若将其二进制随产品分发，应单独满足对应构建许可证。H.264 等格式涉及的专利许可，应根据实际商业发行地区与使用方式另行评估。
