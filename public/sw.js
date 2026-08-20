// 极简 Service Worker：让应用可作为 PWA 安装；不缓存页面，避免干扰登录门禁
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
