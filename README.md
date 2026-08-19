# Spotify Controller

网页控制 Spotify 播放（**只控制不播放**）。通过 [Spotify Web API](https://developer.spotify.com/documentation/web-api/) 控制你其他设备（手机 / 电脑 / 音箱）上的播放，浏览器本身不负责播放音频。

## 功能

- 显示当前播放歌曲（封面、歌名、歌手）
- 播放 / 暂停 / 上一首 / 下一首
- 音量调节
- 进度条拖动（seek）
- 显示并切换当前播放设备
- 🔍 搜索歌曲并点歌（点击直接播放 / ＋加入队列）

## 技术栈

- Node.js + Express 后端
- 原生 HTML / CSS / JS 前端
- axios 调用 Spotify Web API

## 使用步骤

1. 到 [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) 创建 App，拿到 **Client ID** 和 **Client Secret**
2. 在 App 设置里添加 Redirect URI：`http://localhost:3000/callback`
3. 克隆仓库并安装依赖：
   ```bash
   git clone https://github.com/beacondes/spotify-controller.git
   cd spotify-controller
   npm install
   ```
4. 复制 `.env.example` 为 `.env` 并填写你的 CLIENT_ID / CLIENT_SECRET
5. 启动：`npm start`
6. 打开 http://localhost:3000 点击「登录 Spotify」授权
7. 在手机 / 电脑上先播放一首歌，再回到网页即可控制

## 注意事项

- 需要一个正在播放的设备（手机 Spotify App、桌面客户端等）
- 设备长时间无活动会被 Spotify 标记为 inactive，控制会失败，请先在该设备上激活播放
- 免费账号不支持 Spotify Web API 的播放控制（需要 Premium）
