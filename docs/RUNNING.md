# 运行与部署

## 本机预览

Node.js 22.x，使用锁定的 npm 依赖：

```sh
npm ci
npm run preview
```

默认监听 `127.0.0.1:18767`，浏览器打开 `http://127.0.0.1:18767/`。首次使用自行注册账号。昵称不超过 30 字，密码至少 8 位；项目不提供公共账号或预置管理员。

默认持久目录为 `data/accounts-preview/`。设置 `OBJECT_STORIES_DATA` 可以改用另一个目录。数据库、上传文件与随机认证密钥均为运行数据，不提交 Git。

## 模型配置

`DEEPSEEK_API_KEY` 仅配置在服务端运行环境，可选用 `DEEPSEEK_MODEL` 指定服务支持的模型。`THEATER_LLM_ENABLED=false` 可关闭模型生成。

本地需要从文件读取配置时，可使用 Node 的环境文件参数：

```sh
node --env-file=.env.local server.js
```

该文件由运行者创建并保留在本机；`.env.local` 已被 Git 忽略。不要把密钥写进浏览器脚本、公开 README 或 Docker 镜像。

缺少配置、请求异常或输出未通过校验时，剧场会使用并标注规则生成。模型对话不等同于用户记录，不会自动成为新的记忆。

## Vercel 账号版

静态目录为 `web/`，API 入口为 `api/index.js`。建议项目设置：

| 设置 | 值 |
| --- | --- |
| Node.js | `22.x` |
| Framework | Other / 无框架 |
| Root Directory | 仓库根目录 |
| Install Command | `npm ci` |
| Build Command | 留空 |
| Output Directory | `web` |

完整账号版需要以下服务端环境变量与持久服务：

| 变量 | 用途 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 连接，保存账号、成员关系和记忆 |
| `BETTER_AUTH_URL` | 当前部署的正式站点 origin，例如 `https://your-project.vercel.app` |
| `BETTER_AUTH_SECRET` | 至少 32 字符的随机认证密钥 |
| `BLOB_READ_WRITE_TOKEN` | 私有 Vercel Blob 媒体存储 |
| `DEEPSEEK_API_KEY` | 可选，启用模型剧场 |

先在已配置上述环境变量的运行环境中执行 `node scripts/migrate-accounts.js`，再发布与验证注册、登录、成员权限、上传、记忆和剧场流程。账号版使用 PostgreSQL；Vercel 的函数临时文件系统不作为 SQLite 持久目录。

API 仍保留早期演示身份模式：没有 `DATABASE_URL` 时会使用该入口。发布完整账号版时必须验证 `/api/health` 的 `identity_mode` 为 `account`，不能把演示身份当成真实账号。

管理员由运行者对已注册的具体账号显式指定，不自动提升首个注册用户。

## 长运行容器与子路径

单实例、持久磁盘的长运行容器可使用 SQLite。数据目录需可写且挂载到持久磁盘；同一数据库不同时运行多份实例。

校园风格的 `/apps/thingamingos/` 子路径包：

```sh
node scripts/build-campus.mjs thingamingos data/campus-release/example
cd data/campus-release/example
```

在这个生成目录中使用 Dockerfile 构建。不要直接拿仓库根目录的原始静态资源搭配校园 Docker 默认路径：生成步骤会统一改写静态资源、API、邀请链接、媒体、认证 Cookie 和 PWA scope。

默认容器监听 `0.0.0.0:3000`，数据目录为 `/mydata/data/thingamingos`，运行环境文件在该持久目录外置加载。具体域名和挂载由部署方配置；Docker 镜像仍需在目标平台实际构建验证。

## 验证

```sh
npm run check
npm test
python3 -m unittest discover -s tests -p test_local.py
```

测试覆盖账号与成员权限、并发持久化、素材访问、剧场引用、语言切换、播放进度与子路径部署。浏览器需另外检查 iPhone 尺寸、照片转换、音频开关与真实听感。
