# 中华账簿

文林望中华学校教师联谊会财务管理 App。React + TypeScript + Vite 界面，Vercel Node API，Google Apps Script 与私有 Google Sheets 持久保存。

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

Google Sheets 包含“账目事件”和“账本设置”。事件列依次为事件编号、账目编号、版本、操作、日期、类型、分类、项目、金额 RM、往来人、备注、状态、操作人、记录时间、来源、初次记录时间。设置键至少为 `openingDate`、`openingRM`、`sourceNote`。

每次修改追加一个版本，读取最新版本组成账簿；写入锁防止同时覆盖，事件编号防止重试重复，版本号检测并发修改。作废保持原始金额并保留历史。请通过 App 操作，直接编辑 Google Sheet 会绕过 App 的验证及事件记录。

## 部署

```sh
npx vercel link
# 添加上述四项服务器环境变量后
npx vercel --prod
```

在 Vercel 连接本 GitHub 仓库的 `main` 分支，可自动部署后续提交。正式站点不支持离线提交；同步失败时保留表单，使用同一事件编号重试。财政报表选择“打印 / 保存 PDF”，在浏览器打印窗口选择“另存为 PDF”。

## 数据与权限

真实财务数据、原 Excel、账户密码、`.env`、Apps Script 密钥均不进入 GitHub 或静态资源。公开演示只有虚构数据。正式查询必须登录，HTTP-only 签名会话 12 小时到期，服务器校验角色、来源、金额和日期，登录频率在 Apps Script 缓存中限制。Google Sheets 的文件所有者仍可直接编辑表格，因此操作记录不是不可篡改的审计系统。

导入只采用核对后的累计报表，按实际日期归属。早期年份中无法核对的日期和结转保留在原始档案，不能作为新收入重复导入。新增期间无需新增月表。
