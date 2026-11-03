# 理财收益看板（Cloudflare Pages + Functions + D1）

一个自用的理财收益看板：手动录入买入/赎回，自动抓取公开净值，计算持仓收益、当日万收、XIRR、月/年视图。

> **免责声明**：本项目不读取、不登录、不操作任何银行账户；收益为根据「手动录入交易 + 公开净值」的估算，不等同于银行官方收益。仅建议个人自用。

## 功能

- 多产品持仓：买入、赎回、调整、待确认
- 公开净值自动同步（招商银行理财公开接口），支持手动粘贴兜底
- 当日收益、持仓收益、持仓利率、年化 XIRR
- 日/月/年日历视图，支持「按更新日 / 按自然日」两种口径
- 本月/上月年化、年视图月收益与月年化
- 单日万收曲线（红涨绿跌）
- 交易记录（按月分组，买入/赎回/调整）
- 访问密码门（可选，推荐开启）

## 技术架构

- 前端：原生 HTML/CSS/ES Module，无构建步骤
- 后端：Cloudflare Pages Functions
- 数据库：Cloudflare D1（SQLite）
- 部署：Cloudflare Pages

## 前置条件

- 一个 Cloudflare 账号（免费版即可）
- 一个 GitHub 账号（方式一需要）
- 本机安装 Node.js 18+（方式二需要）

---

## 部署方式一：GitHub + Cloudflare Pages（推荐）

### 1. 把代码放到 GitHub

- 新建一个仓库（建议 **Private**）
- 把本项目**文件夹里的内容**上传上去（不要多套一层目录）
- 确认仓库里**没有** `node_modules/`、`exp.json`、`.dev.vars`

### 2. 创建 D1 数据库

Cloudflare 控制台 → **Workers & Pages** → **D1** → **Create database**

- 名称随意，例如 `licai-netvalue-db`
- 创建后记下 **Database ID**

### 3. 建表

进入刚创建的 D1 → **Console**，把 `schema.sql` 的全部内容粘贴进去执行。

或者在本地执行：

```bash
npx wrangler d1 execute licai-netvalue-db --remote --file=./schema.sql
```

### 4. 创建 Pages 项目并连接 GitHub

Cloudflare 控制台 → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**

- 选择你的仓库
- 框架预设：**None**
- 构建命令：**留空**
- 构建输出目录：**public**

### 5. 绑定 D1

Pages 项目 → **Settings** → **Functions** → **D1 database bindings**

- Variable name：**DB**
- D1 database：选择第 2 步创建的库

### 6. 设置访问密码（强烈建议）

Pages 项目 → **Settings** → **Variables and Secrets** → 添加：

- 类型：**Secret**
- 名称：**APP_PASSWORD**
- 值：你自己设定的密码

> 不设置 `APP_PASSWORD` 时，站点是**公开可读写**的，任何人拿到网址都能看和改。

### 7. 部署

回到 **Deployments**，点 **Retry deployment** 或重新推送一次代码。

部署完成后访问 `https://<项目名>.pages.dev`，输入密码即可。

---

## 部署方式二：本地 wrangler

```bash
npm install
npx wrangler login
```

创建 D1：

```bash
npx wrangler d1 create licai-netvalue-db
```

把输出的 `database_id` 填到 `wrangler.toml`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "licai-netvalue-db"
database_id = "你的-database-id"
```

建表：

```bash
npx wrangler d1 execute licai-netvalue-db --remote --file=./schema.sql
```

设置密码：

```bash
npx wrangler pages secret put APP_PASSWORD --project-name=你的项目名
```

部署：

```bash
npm run deploy
# 等价于 npx wrangler pages deploy public --project-name=你的项目名
```

---

## 首次使用

1. 打开站点，输入 `APP_PASSWORD`
2. 「新增持仓」：填产品代码（如 `135005A`）、名称、风险等级、交易时间（T+1/T+2）、最短持有期
3. 保存后会自动同步该产品净值（也可点「同步净值」手动触发）
4. 进入产品详情 →「买入」：填买入时间、净值计算时间、确认时间、本金、净值，保存
5. 赎回：填提交申请时间、净值计算时间、完成时间、比例（可点「全部」）或金额，保存

> 产品代码需为招商银行理财公开接口可查到的代码；查不到时可用「手动粘贴净值」兜底。

---

## 数据安全（重点）

**代码仓库里没有任何个人数据**，所有人下载到的都是同一份空代码。

每个人部署时：

- 用的是**自己的 Cloudflare 账号**
- 创建的是**自己的 D1 数据库**
- 设置的是**自己的访问密码**

因此：

- 你的持仓、交易、净值只存在**你自己的 D1** 里
- 别人的实例是全新的空库，看不到你的数据
- 你的实例也访问不到别人的库

需要注意的几点：

1. **必须设置 `APP_PASSWORD`**，否则拿到网址的人可以读写你的数据
2. 建议再叠加一层 **Cloudflare Access**（Zero Trust → Access → Applications）
3. 不要把 `exp.json`、`.dev.vars` 提交到 GitHub（本项目 `.gitignore` 已排除）
4. 仓库建议设为 **Private**，避免代码被随意复制（虽然代码本身不含数据）
5. 定期用「导出备份」下载一份 JSON 留存

> 结论：**数据隔离是成立的**——数据只在你自己的库里。但「隔离」不等于「自动安全」，密码门和 Access 仍然要开。

---

## 备份与迁移

- 页面「操作 → 导出备份」会下载完整 JSON（产品、交易、净值）
- 换账号/换库时：新库执行 `schema.sql` → 页面「导入恢复」
- 导入前系统会自动导出当前数据作为备份

---

## 常见问题

**Q：国内打开很慢？**
A：`pages.dev` 在国内没有优化线路，跨境访问会慢。项目已做本地缓存与渐进加载，第二次打开会快很多；根治只能换国内云（需要备案）。

**Q：净值同步失败？**
A：上游接口偶发不可用，稍后重试，或用「手动粘贴净值」。非 SA 类产品可能查不到，需手动维护。

**Q：T+1 / T+2 是什么？**
A：产品的净值可见滞后天数。项目里「按更新日」会把收益按 T+N 个工作日归到可见日，「按自然日」只算净值当天。

**Q：改了代码怎么更新线上？**
A：推送到 GitHub 会自动重新部署；或本地执行 `npm run deploy`。

---

## 目录结构

```
public/            前端（index.html、login.html、css、js、_headers）
functions/         后端（_middleware.js 密码门、api/*、_lib/*）
scripts/           计算引擎单测
schema.sql         D1 建表语句
wrangler.toml      Cloudflare 配置（D1 ID 需替换）
package.json
```

## 测试

```bash
npm test
```
