# Android 开发指南 - 使用 Expo Go

## 📱 方式一：使用 Expo Go（推荐，完全免费）

### 步骤 1：在手机上安装 Expo Go

1. 打开手机的 Google Play Store
2. 搜索 "**Expo Go**"
3. 安装应用（完全免费，无需会员）

### 步骤 2：启动 Expo 开发服务器

在终端中运行以下命令：

```bash
# 进入前端目录
cd /home/ubwzwd/code/wallet_app/frontend

# 加载 Node.js 环境
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# 启动 Expo（会显示二维码）
npx expo start
```

**启动成功后你会看到：**
- 一个二维码
- 局域网 URL: `exp://192.168.x.x:8081`
- 按键说明（按 `a` 打开 Android，按 `w` 打开 Web 等）

### 步骤 3：在手机上连接

**方式 A：扫描二维码**
1. 打开手机上的 Expo Go 应用
2. 点击 "Scan QR Code"
3. 扫描终端中显示的二维码

**方式 B：手动输入 URL**
1. 确保手机和电脑在同一个 Wi-Fi 网络
2. 打开 Expo Go
3. 点击 "Enter URL manually"
4. 输入终端中显示的 URL（类似：`exp://192.168.1.72:8081`）

### 步骤 4：开始开发！

- ✅ 修改代码后，应用会自动刷新（热重载）
- ✅ 摇动手机可以打开开发者菜单
- ✅ 可以查看控制台日志
- ✅ 完全免费，无限制使用

---

## 🔧 常见问题

### 问题 1：无法连接

**解决方案：**
```bash
# 使用局域网模式
npx expo start --lan

# 或使用隧道模式（需要安装 ngrok，但不需要同一网络）
npm install -g @expo/ngrok
npx expo start --tunnel
```

### 问题 2：端口被占用

**解决方案：**
```bash
# 清理进程
pkill -f "expo"
pkill -f "metro"

# 重新启动
npx expo start --clear
```

### 问题 3：包版本警告

**解决方案：**
```bash
# 更新 Expo
npm install expo@latest

# 清除缓存
npx expo start --clear
```

---

## 🎯 开发流程

### 日常开发循环

1. **启动服务器**
   ```bash
   cd frontend
   npx expo start
   ```

2. **在手机上打开应用**（Expo Go 扫码）

3. **修改代码** → 保存 → **自动刷新** ✨

4. **调试**
   - 摇动手机 → 开发者菜单
   - 选择 "Debug Remote JS" 查看日志

### 测试不同功能

- **测试登录**：使用 `user@test.com / password123`
- **测试注册**：创建新账号
- **测试财务账户**：添加银行卡、信用卡等
- **测试交易**：记录收入和支出
- **测试多货币**：使用不同货币创建交易

---

## 📊 后端 API 状态

确保后端服务器正在运行：

```bash
# 检查后端
curl http://localhost:8000/health

# 应该返回：
# {"status":"healthy","environment":"development","version":"0.1.0"}
```

如果后端没有运行：

```bash
cd /home/ubwzwd/code/wallet_app/backend
export PATH="/home/ubwzwd/.local/bin:$PATH"
poetry run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

---

## 🚀 方式二：使用 Android 模拟器（可选）

如果你想使用模拟器，需要安装 Android Studio：

### 安装 Android Studio

```bash
# 下载 Android Studio
wget https://redirector.gvt1.com/edgedl/android/studio/ide-zips/2023.3.1.18/android-studio-2023.3.1.18-linux.tar.gz

# 解压
sudo tar -xzf android-studio-*.tar.gz -C /opt/

# 启动
/opt/android-studio/bin/studio.sh
```

### 配置模拟器

1. 打开 Android Studio
2. 工具 → Device Manager
3. 创建新虚拟设备（推荐：Pixel 5, Android 13）
4. 启动模拟器

### 在模拟器中运行

```bash
cd frontend

# Expo 会自动检测模拟器
npx expo start

# 按 'a' 键在 Android 模拟器中打开
```

---

## 💡 性能优化建议

### 开发环境优化

```bash
# 使用生产模式测试性能
npx expo start --no-dev --minify

# 清除所有缓存
watchman watch-del-all  # 如果安装了 watchman
npx expo start --clear
rm -rf node_modules
npm install
```

### 减少重载时间

在 `package.json` 中添加：

```json
{
  "expo": {
    "experiments": {
      "tsconfigPaths": true
    }
  }
}
```

---

## 📝 调试技巧

### 查看日志

**在 Expo Go 中：**
- 摇动手机 → "Show Developer Menu" → "Debug Remote JS"

**在终端中：**
```bash
# 前端日志会直接显示在终端

# 后端日志
tail -f /home/ubwzwd/code/wallet_app/backend/app.log
```

### 远程调试

1. 在 Expo Go 中打开开发者菜单
2. 选择 "Debug Remote JS"
3. 在浏览器中打开 http://localhost:19000/debugger-ui
4. 打开浏览器开发者工具（F12）
5. 查看 Console 标签

---

## 🎓 学习资源

- [Expo 官方文档](https://docs.expo.dev/)
- [React Native 文档](https://reactnative.dev/)
- [Expo Go 使用指南](https://docs.expo.dev/get-started/expo-go/)

---

## ✅ 检查清单

开始开发前确认：

- [ ] 手机已安装 Expo Go
- [ ] 手机和电脑在同一 Wi-Fi（或使用 tunnel 模式）
- [ ] 后端服务器运行中（http://localhost:8000）
- [ ] 数据库运行中（PostgreSQL 容器）
- [ ] 前端服务器运行中（npx expo start）
- [ ] 可以扫描二维码或手动输入 URL

---

**祝开发顺利！** 🎉

如有问题，检查：
1. 终端输出的错误信息
2. Expo Go 应用中的错误提示
3. 后端 API 是否正常响应

