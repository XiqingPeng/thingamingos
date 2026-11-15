# AI 与第三方声明

## AI 辅助制作

- 代码、交互和文档使用 Codex / 大语言模型辅助设计、实现与修订，并通过自动化测试和浏览器操作检查实际行为。
- 房间场景图为本项目使用生成式图像工具制作的原创素材，位于 `web/assets/`。没有使用《星露谷物语》《动物森友会》等游戏的官方画面或音乐文件。
- 背景音乐与交互音效是本项目的原创音序，使用浏览器 Web Audio 合成，不包含第三方游戏录音或原曲采样。
- 配置 DeepSeek 后，小剧场的表达由模型结合用户记录生成。记忆的作者、关联人物及确认状态由程序保存；模型台词不会自动写回记忆。
- 照片转像素图标采用浏览器内的图像处理规则算法，包含缩采样、调色与背景处理；这一功能不调用 AI 绘图服务。

## 第三方组件

依赖版本以 `package-lock.json` 为准；组件保留各自的许可证。

| 组件 | 用途 | 项目 |
| --- | --- | --- |
| Better Auth | 账号、会话及管理员接口 | https://github.com/better-auth/better-auth |
| Vercel AI SDK | 模型调用与结构化输出 | https://github.com/vercel/ai |
| DeepSeek provider | 可选模型服务连接 | https://github.com/vercel/ai |
| Vercel Blob SDK | 私有媒体及早期演示存储 | https://github.com/vercel/storage |
| node-postgres | PostgreSQL 连接 | https://github.com/brianc/node-postgres |

## 像素字体

使用 **Fusion Pixel 12px Proportional**，来源为 [TakWolf/fusion-pixel-font](https://github.com/TakWolf/fusion-pixel-font)，固定版本 `2026.11.10`。

字体文件、OFL 声明、所包含字体的许可证以及下载来源记录保留在 `web/fonts/`。字体许可证适用于字体组件，不代表本项目整体代码获得相同许可。

## 数据与用户素材

仓库中的演示名称与测试记忆是合成样例。用户上传的私人照片、视频、账号数据库、模型密钥和内部开发交接记录均不进入公开仓库。

使用者上传素材前应确认自己拥有使用权限。照片、故事与人物标注来自用户输入；程序不根据照片推断赠送关系或其他人的确认。

## 验证方式

自动化测试验证身份权限、记录归属、确认状态、记忆引用和失败回退；浏览器检查上传、像素转换、界面语言、移动布局及声音控制。目标部署仍需检查真实运行环境和外部服务配置。

本仓库尚未指定整体代码许可证。
