# 🚀 如何启动前端

## 方法 1：直接启动（推荐）

```bash
cd /home/ubwzwd/Coding/side_projects/wallet_app/frontend
npm run web
```

浏览器会自动打开 `http://localhost:8081`

## 方法 2：查看所有平台选项

```bash
cd /home/ubwzwd/Coding/side_projects/wallet_app/frontend
npm start
```

然后按 `w` 键打开 Web 版本

## 🛠️ 故障排除

### 如果端口 8081 被占用：

```bash
# 查找占用端口的进程
lsof -i :8081

# 杀死进程
kill -9 <PID>
```

### 如果出现缓存问题：

```bash
# 清除 Expo 缓存
npx expo start --clear
```

### 如果依赖有问题：

```bash
# 重新安装依赖
rm -rf node_modules package-lock.json
npm install
```

## ✅ 验证运行

启动后，你应该看到：
- ✅ "Web Bundled" 消息
- ✅ 浏览器自动打开
- ✅ 显示蓝色卡片：🎉 Wallet App

## 📝 开发技巧

- **热更新**：保存文件后浏览器自动刷新
- **调试**：按 `F12` 打开浏览器开发者工具
- **停止服务器**：按 `Ctrl+C`

