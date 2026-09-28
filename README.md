# 中华账簿

文林望中华学校财务管理 App：教师联谊会、家协、贩卖部三个独立账本，共用登录。React + TypeScript + Vite 界面，Vercel Node API，Google Apps Script 与私有 Google Sheets 持久保存。

支持记账、修改与作废、关键字与期间筛选、月度／半年／全年／自定义报告、A4 打印及另存 PDF、CSV 导出、操作记录、电脑与手机布局。

## 本地开发

```sh
npm ci
npm run start:local
# 另一个终端
npm run dev
npm test
npm run build
```

未配置正式账本时，可以进入虚构数据演示。演示操作仅保留在内存，刷新后重置，不写入正式 Google Sheets。

## 正式配置

复制 `.env.example` 为 `.env.local`，并在 Vercel 设置同名环境变量：

- `LEDGER_BACKEND_URL`：Apps Script Web App `/exec` 地址。
- `LEDGER_BACKEND_SECRET`：32 字节以上随机密钥，仅 Vercel 与 Apps Script 持有。
- `SESSION_SECRET`：独立的随机会话签名密钥。
- `LEDGER_USERS_JSON`：用户列表，每项含 `username`、`displayName`、`role`、`passwordHash`。角色可为 `admin`、`treasurer`、`viewer`。密码格式为 `salt:scrypt(password,salt,64).hex`，可通过 `server/security.ts` 的 `hashPassword()` 生成。禁止存入明文密码。

`gas/Code.js` 与 `gas/appsscript.json` 是后端源文件。在 Google Apps Script 项目加入未提交的 `Secrets.gs`，内容为 `function ledgerConfig_(){return {spreadsheetId:'实际ID',secret:'与Vercel一致的密钥'};}`。以拥有账本编辑权的账户部署，执行身份为部署者，Web App 允许匿名到达入口，但所有读写必须通过 HMAC 签名验证。网站不会向浏览器发送后端密钥。

Google Sheets 中，联谊会使用“账目事件”和“账本设置”，家协和贩卖部分别使用相应名称前缀的两个独立页签。服务器与 Apps Script 校验 `teachers`、`pta`、`store` 三个账本 ID，读写及幂等检查限定在选中账本内。事件列依次为事件编号、账目编号、版本、操作、日期、类型、分类、项目、金额 RM、往来人、备注、状态、操作人、记录时间、来源、初次记录时间。设置键至少为 `openingDate`、`openingRM`、`sourceNote`；`reviewNotes` 和 `balanceCheckpoints` 为 JSON 数组。

三个账本支持 2024 年起的记录与报表。已读取的账本在当前登录会话内按账本 ID 分开暂存，切换或页面回到前台时先显示对应账本，快照超过 15 秒即更新；过期网络响应会被忽略。保存后更新该账本快照，退出时清空所有快照，真实财务数据不写入 localStorage。账户内部转账使用 `transfer` 类型，可查询、修改、作废，但不计收入、支出或账本总余额；不同账本之间的转款则分别记录各账本的实际收支。

同一账号可在多台设备同时登录，各自持有独立的 12 小时会话；后登录不会令先前会话失效。多人修改同一笔时，旧版本会被拒绝并要求刷新。操作记录以账号显示操作人，因此需要区分个人责任时应给每位使用者分配独立账号。

历史资料存在疑点时，提示显示在 App 及 PDF 报告。`balanceCheckpoints` 的每项含 `date`、`amountCents`、`note`，表示有原始来源支持的某日承前结余。日期在结转点及之后的期间使用该承前金额；跨越结转点的报告把差额独立列示，不虚构收支。原始来源不完整的年份仍须财政核对，不能把报表自动计算当作已查账认证。

每次修改追加一个版本，读取最新版本组成账簿；写入锁防止同时覆盖，事件编号防止重试重复，版本号检测并发修改。作废保持原始金额并保留历史。请通过 App 操作，直接编辑 Google Sheet 会绕过 App 的验证及事件记录。

## 部署

```sh
npx vercel link
# 添加上述四项服务器环境变量后
npx vercel --prod
```

在 Vercel 连接本 GitHub 仓库的 `main` 分支，可自动部署后续提交。正式站点不支持离线提交；同步失败时保留表单，使用同一事件编号重试。财政报表选择“打印 / 保存 PDF”，在浏览器打印窗口选择“另存为 PDF”。全年与半年打印采用 A4 密排版，保留逐笔明细、分类汇总与结余；当前三个账本的年度报告经验证不超过两页。新增账目后的页数取决于实际笔数和内容长度。

同步排查：网页出现“连接暂时中断”时，查看 Vercel Function 日志中的 `Ledger transport retry` 阶段、HTTP 状态和耗时；出现“授权失败”时检查 Vercel 与 Apps Script 的密钥及 Web App 部署；出现“后端处理失败”时查看 Apps Script 的执行记录。`gas/Code.js` 的修改须在 Apps Script 重新部署 Web App 版本，单独部署 Vercel 不会更新 Google 端代码。日志记录操作类型、传输阶段、状态及错误类别，不记录账目或密钥。

## 数据与权限

真实财务数据、原 Excel、账户密码、`.env`、Apps Script 密钥均不进入 GitHub 或静态资源。公开演示只有虚构数据。正式查询必须登录，HTTP-only 签名会话 12 小时到期，服务器校验角色、来源、金额和日期，登录频率在 Apps Script 缓存中限制。Google Sheets 的文件所有者仍可直接编辑表格，因此操作记录不是不可篡改的审计系统。

正确登录不累计密码错误次数；连续 12 次密码错误后限制该来源及账户 15 分钟。密码是否正确仅由服务器计算，通过 HMAC 告知 Apps Script；浏览器不能自行声明验证成功。触发限制后，即使密码正确也须等待限制到期。登录验证与首个账本快照合并为一次 Google 请求。视觉素材、动效与性能调整见 [设计说明](design/README.md)。

导入按实际日期归属，排除重复累计版本及承前行；用户同意先导入并标记待核对的历史明细。照片被裁去的日使用明确标注的临时日期归月，须财政补正后才能用于准确日流水。原始来源与疑点保留在备注及账本说明，余额差额不能作为新收入重复导入。新增期间无需新增月表。
