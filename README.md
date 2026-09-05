# DSH Desktop

把**本地 DeepSeek Harness（dsh web）**放进一个**独立原生窗口**，双击即用：不再需要手动开浏览器标签，也无官方桌面客户端里那些“市场 / Pro / 能量计费 / 会员推销”等冗余。

- 复用你自己本机安装的 `@deepseek-ai/dsh`，数据仍在你自己的 `~/.dsh`。**不上传、不改你的账号**。
- 关窗进托盘、进程后台常驻；单实例；托盘一键退出。

---

## 长话短说（快速开始）

先决条件：已装 **Node.js LTS** 与 **`@deepseek-ai/dsh`**

```bash
# 1) 装 DSH 本体（如尚未装）
npm i -g @deepseek-ai/dsh

# 2) 运行一键安装（Windows：双击 setup.cmd 亦可）
powershell -NoProfile -ExecutionPolicy Bypass -File setup.ps1
```

安装器会：
1. 检测 `node` 与 `@deepseek-ai/dsh`；
2. 在库内 `runtime\` 准备好 Electron（没有则自动联网下载，GitHub/npmmirror 镜像自动选快的，首次约百余 MB）；
3. 在**桌面与开始菜单**创建「DSH Desktop」快捷方式。

装好后：**双击桌面的“DSH Desktop”**，即弹出独立窗口显示你自己的 DSH 界面（会自启并接管 `127.0.0.1:3080`，随后托盘常驻）。

> 也可随时手动快速启动：`run-client.cmd`

---

## 目录结构

```
dsh-desktop/
├─ main.cjs            客户端主程序（Electron）
├─ package.json        元信息 / 脚本
├─ setup.ps1 / setup.cmd   一键安装入口
├─ run-client.cmd      免装式快速启动（开发用）
├─ assets/
│  ├─ bili-icon.ico    快捷方式/任务栏图标
│  └─ icon.png         托盘图（自动缩到 16px）
├─ README.md
├─ LICENSE             MIT
└─ .gitignore
```
> `runtime/`、`node_modules/`、`*.log`、`state.json` 均不入库（安装时动态生成）。

---

## 工作原理（是什么/为什么这样）

`dsh web` 的鉴权方式是 **一次性 token 拼在启动地址里**：

```
dsh web: http://127.0.0.1:3080/?token=xxxx
```

只开裸的 `http://127.0.0.1:3080/` 会得到 `401 … reopen the URL printed by dsh web`。本客户端做的正是：
1. 自启 `node …\@deepseek-ai\dsh\lib\bin.js web --no-open`；
2. 从它的标准输出**截获那条带着 token 的 URL**；
3. 把内嵌窗口导航到**那个地址** → 于是有内容、可交互，无需登录页 / 云账号 / 会员推销。

（`--no-open` 保证 dsh 不再自己开一个默认浏览器标签。）

其它：
- **托盘常驻**：关窗只隐藏到托盘，进程保持后台运行；再次双击唤出，托盘右键可刷新 / 退出。
- **单实例**：第二次启动只把已有窗口带到前台，不会开一堆。
- **记忆复用**：记住自启的后端与 token；托盘内一直运行时再次打开是秒回。

---

## 注意事项 / Troubleshooting

- **首次正式启动会接管 :3080**：若 :3080 已被另一个 `dsh web`（例如你在终端手动起过、或浏览器那套）占用，客户端会先停掉它（只停 `node …bin.js web`，绝不杀无关进程）再自启接管。因此若当前正有依赖 :3080 的页面/会话，请在离开后再启动本客户端。
- **窗口长时间停在“正在启动 dsh web 后端…”**：
  - 确认 `npm ls -g @deepseek-ai/dsh` 存在，且 `node` 在 PATH；
  - 结束该实例，重新双击快捷方式即可。
- **端口被占导致闪退**：日志 `…\.dsh\client\dsh-desktop.log` 若有 `EADDRINUSE`，说明还有旧 `dsh web` 没退干净，先托盘点“退出”或任务管理器结束占用 :3080 的 `node …bin.js web`，再启动。
- **Electron 不在你机器上 / 装不了**：确认网络可达 GitHub 或 npmmirror；公司代理需允许上述域名。
- **隐私**：此库只含代码与图标，**不包含**你的 API Key / token / `~/.dsh` 数据；那些都在本机，不入库。请勿把 `~/.dsh` commit 进仓库。
- 本工程面向“干净自托管”的本地 dsh web；它与官方云计算版 / DS Harness 电脑版是不同账号体系，本工程**不会**连那套云服务。

### 赞助我
如果这个项目对你有帮助，请支持一下孩子，帮助孩子喂养自己大肥鱼。

<img src="assets/WePay.jpg" width="200" alt="微信赞赏码" />
<img src="assets/AliPay.jpg" width="200" alt="支付宝赞赏码" />

---

## License

[MIT](./LICENSE)

> 说明：本仓库仅为一个第三方独立包装工具，与 `@deepseek-ai/dsh` 无关联；“DeepSeek Harness” 商标与相关产品版权归其各自所有者。
