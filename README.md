# Mineradio · 酷狗概念版二创版

> 本仓库是 [XxHuberrr/Mineradio](https://github.com/XxHuberrr/Mineradio)（v2.2.0，GPL-3.0）的**二创分支**，当前版本 **2.2.1**，
> 核心改动：**将原版酷狗接口整体替换为酷狗概念版接口**（移植自 [Super-55/super_music_mineradio_basic](https://github.com/Super-55/super_music_mineradio_basic)），**实现 Hi-Res 音质播放**（最高 Hi-Res → 无损 → 高品质 → 标准逐档自动降级），并附带每日 VIP 自动领取与 QQ 音乐自动换源。
>
> 应用名沿用 **Mineradio**（二创版识别为 `KugouConcept`），但使用独立的 appId（`com.mineradio.kugou`）、安装目录（`MineradioKugouConcept`）与数据目录，**可与官方原版同时安装、互不影响**。

![Mineradio 暗场启动页](./docs/assets/readme/cinema-beat-smoke.png)

## 本二创做了什么（重点改动）

### ① 酷狗接口 → 酷狗概念版接口（整体替换）

- **原版的酷狗链路全部推翻重写为概念版链路**：概念版网关（`appid 3116` / `clientver 11440`）、专用签名与请求头体系，冲突时概念版完全覆盖原版酷狗
- 登录收敛为**扫码登录**，头像、昵称等账号信息正常回显
- 概念版歌单导入与搜索结果正常展示；歌名与 QQ 音乐显示对齐（剥离「歌手 - 」文件名前缀）

### ② Hi-Res 音质播放（本二创重点实现）

- **最高支持 Hi-Res 音质播放**：VIP 探测链重构，以真实探测结果决定可用品质
- **逐档自动降级**：Hi-Res → 无损 → 高品质 → 标准，高档取流失败自动落到下一档，不会卡死也不会假降级
- 修复 Hi-Res 取流参数（quality 需传 `high`）、relate 反查逐档补齐 hash、TTL 缓存反查结果
- 音质探测与降级策略的实现参考了 [hoowhoami/EchoMusic](https://github.com/hoowhoami/EchoMusic) 的行为逻辑

### ③ 每日 VIP 自动领取

- 打开应用自动领取每日 VIP（按天防重、静默执行），支持广告任务与时长上报两条路径；领取思路参考了 [YTDB0/echo-auto-vip](https://github.com/YTDB0/echo-auto-vip)
- 登录面板新增「**自动插件**」节点，点击弹出信息面板：打卡领取规则、自动化设置（持久化）、运行日志，按钮集中在头像下方一行

### ④ QQ 音乐自动换源到酷狗

- QQ 音乐歌曲无音源时**自动换源到酷狗**，歌名严格匹配
- 换源播放真正出声后自动收起主页，不再遮挡歌词舞台

### 其他修复

- 构建配置修正（`build.files` 覆盖 `kugou-account-bridge.js`）
- 测试链路语义同步为概念版（酷狗 4 套件 19/19 通过）

## 已知限制

- **更新检测指向本仓库 Releases**（`package.json` → `mineradio.update`），不会再把用户引到原版安装包。当前二创版本号为 `2.2.1`（高于上游 `2.2.0`），只有在本仓库发布更高版本后，应用内才会提示更新；新旧版本也可以直接到 [Releases](https://github.com/YOLOk0i/Mineradio-KugouConcept/releases) 手动下载
- 母带（viper 加密格式）音质不保证可用，上限为 Hi-Res / 无损
- 若上游更新，需手动合入改动
- 仅供学习交流，请遵守各音乐平台的用户协议与版权规则

## 使用

```bash
npm install
npm start          # 开发运行
npm run build:win  # 生成 Windows NSIS 安装包（dist/）
```

普通用户无需自己构建：直接到 [Releases](https://github.com/YOLOk0i/Mineradio-KugouConcept/releases) 下载 `Mineradio-2.2.1-KugouConcept-Setup.exe` 安装即可。

---

以下为上游原版 README 内容（保留作说明）：

# Mineradio

![Mineradio 暗场启动页](./docs/assets/readme/cinema-beat-smoke.png)

Mineradio 是一款 Windows 桌面沉浸式音乐播放器，把搜索播放、歌词舞台、粒子视觉、3D 歌单架和完整桌面模式组合成一个更接近现场感的私人音乐空间。

## 当前版本

当前版本：`2.2.0`，状态：正式版。

> 安全提示：`v1.0.10` 及更早旧安装包不再建议继续安装或传播。

## 核心特性

- 首页包含每日推荐、平台推荐、继续听、听歌画像和我的歌单入口
- 完整桌面模式保留播放器、主页、歌单和桌面交互
- 支持本地 MP4 与 Wallpaper Engine 视觉内容
- 播放后切换到 Emily / 默认播放态视觉，歌词舞台与粒子舞台同步工作
- 基于节奏的电影镜头视觉系统
- 面向长播客和 DJ 曲目的专属视觉模式
- 歌词舞台、自定义歌词、歌词位置与视觉控制
- 自定义专辑封面上传与裁剪
- 右键唤起 3D 歌单架，支持歌单队列浏览
- 网易云音乐账号、搜索、歌单、播客等体验接入
- QQ 音乐搜索、登录态与音源补充接入
- GitHub Releases 更新检测与下载入口

## 开发运行

```bash
npm install
npm start
npm run build:win
```

桌面版入口由 Electron 主进程加载本地服务。`npm run build:win` 会生成 Windows NSIS 安装包，产物位于 `dist/`。

## 第三方音乐平台说明

Mineradio（含本二创）不是网易云音乐、QQ 音乐、酷狗音乐或腾讯音乐娱乐集团的官方客户端，也不隶属于任何音乐平台。

项目中的第三方平台接入仅用于个人学习、本地客户端体验和用户自有账号的播放辅助。请遵守对应平台的用户协议、版权规则和会员权益规则。项目不会提供绕过付费、绕过会员、破解音质或重新分发音乐内容的能力。

## 用户数据与隐私

登录 Cookie、搜索历史、自定义封面、自定义歌词、节奏分析缓存等数据只保存在本机用户数据目录或浏览器本地存储中，不会提交到仓库。更多说明见 [PRIVACY.md](./PRIVACY.md)。

## 致谢

- [XxHuberrr/Mineradio](https://github.com/XxHuberrr/Mineradio) —— 原版软件的设计与实现（GPL-3.0）
- [Super-55/super_music_mineradio_basic](https://github.com/Super-55/super_music_mineradio_basic) —— 酷狗概念版接口二创（GPL-3.0），本项目酷狗链路的移植来源
- [hoowhoami/EchoMusic](https://github.com/hoowhoami/EchoMusic) —— 音质探测与逐档降级策略的参考实现
- [YTDB0/echo-auto-vip](https://github.com/YTDB0/echo-auto-vip) —— 每日 VIP 自动领取/打卡思路的参考

## 版权与授权

Copyright (C) 2026 XxHuberrr.

本项目（二创分支）采用 GPL-3.0-only 授权。详见 [LICENSE](./LICENSE)。

MR Logo、Mineradio 名称、界面视觉设计与原创视觉表达归原作者所有；第三方依赖和第三方服务分别遵循其各自授权与服务条款。
