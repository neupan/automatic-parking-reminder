# 🅿️ 停车缴费提醒

一个轻量级 PWA 应用，帮你在小区停车 12 小时到期前自动提醒缴费离场，避免多花冤枉钱。

## 📖 背景

小区停车费规则：

| 时长 | 费用 |
|------|------|
| 12 小时以内 | ¥5 |
| 12 ~ 24 小时 | ¥10 |

晚上 9-10 点泊车入库，次日早上 9-10 点出发，经常恰好卡在 12 小时临界点。其实提前缴费后有 15 分钟出库时间，完全来得及省下 ¥5。这个小工具就是解决这个痛点。

## ✨ 功能

- 🚗 **一键记录泊车时间** — 到达车库后点一下即可
- ⏱ **实时倒计时** — 环形进度条动态展示剩余时间
- 🔔 **到期前 20 分钟提醒** — 浏览器通知 + 振动，留足缴费出库时间
- 💰 **费用状态** — 实时显示当前处于 ¥5 还是 ¥10 区间
- ✏️ **修改入库时间** — 忘记点击可事后手动调整
- 📋 **停车历史** — 自动记录每次停车时长和费用
- 🌙 **深色主题** — 夜间泊车、早起使用都护眼
- 📱 **PWA 支持** — 添加到手机主屏幕，像原生 App 一样使用
- 📶 **离线可用** — Service Worker 缓存，无网络也能正常使用

## 📸 截图

| 空闲状态 | 计时状态 |
|---------|---------|
| ![空闲状态](screenshots/idle.png) | ![计时状态](screenshots/active.png) |

## 🚀 快速开始

### 本地运行

```bash
# 克隆项目
git clone https://github.com/your-username/automatic-parking-reminder.git
cd automatic-parking-reminder

# 启动本地服务器（任选其一）
npx -y serve .
# 或
python3 -m http.server 3000
```

浏览器打开 `http://localhost:3000` 即可使用。

### 手机访问

1. 确保手机和电脑在同一局域网
2. 手机浏览器访问 `http://<电脑IP>:3000`
3. 添加到主屏幕：
   - **iOS**: Safari → 分享按钮 → 添加到主屏幕
   - **Android**: Chrome → 菜单 → 添加到主屏幕

### 部署到 GitHub Pages

```bash
git init
git add .
git commit -m "init: parking reminder PWA"
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

在 GitHub 仓库 **Settings → Pages → Source** 选择 `main` 分支，即可获得永久在线地址。

## 📂 项目结构

```
automatic-parking-reminder/
├── index.html          # 主页面
├── style.css           # 深色主题样式（玻璃拟态 + 渐变动画）
├── app.js              # 核心业务逻辑（计时、通知、存储）
├── sw.js               # Service Worker（离线缓存 + 后台通知）
├── manifest.json       # PWA 配置（图标、主题色、启动方式）
├── icon-192.png        # 应用图标 192×192
├── icon-512.png        # 应用图标 512×512
├── screenshots/        # 截图
└── README.md
```

## 🔔 提醒策略

```
泊车入库                                          12小时到期
  │                                                  │
  │  ──────── 正常（青紫色）────────                   │
  │                        │                          │
  │                   剩余 < 1小时（黄橙色）           │
  │                              │                    │
  │                         剩余 < 20分钟（红色脉冲）  │
  │                              │                    │
  │                          发送通知📱               │
  │                              │    15分钟出库窗口   │
  │                              ├────────────────────┤
```

- **到期前 > 1 小时**：青紫渐变，正常状态
- **到期前 < 1 小时**：黄橙渐变，温和提醒
- **到期前 < 20 分钟**：红色脉冲动画 + 发送浏览器通知 + 振动
- **超过 12 小时**：显示超时时长，费用变为 ¥10

## ⚙️ 技术栈

- **纯前端**：HTML + CSS + JavaScript，零依赖
- **存储**：localStorage 持久化
- **通知**：Web Notification API
- **离线**：Service Worker + Cache API
- **PWA**：Web App Manifest

## 📝 注意事项

- iOS 设备需要 **iOS 16.4+** 且必须 **添加到主屏幕** 后才支持通知推送
- 浏览器后台通知效果因系统和浏览器而异，建议早上出门前打开 App 确认状态
- 所有数据存储在本地浏览器中，清除浏览器数据会丢失历史记录

## 📄 License

MIT
