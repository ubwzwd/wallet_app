# Wallet App - Frontend

前端应用基于 **Expo** (React Native + Web) 构建，使用 TypeScript 和 NativeWind (Tailwind CSS)。

## 🚀 快速开始

### 1. 安装依赖
```bash
npm install
```

### 2. 启动开发服务器

**Web 模式**（推荐用于 M1-M2 开发）：
```bash
npm run web
```
浏览器会自动打开 `http://localhost:8081`

**其他平台**：
```bash
npm start        # 显示 QR 码，可在 Expo Go 应用扫码
npm run android  # Android 模拟器
npm run ios      # iOS 模拟器（需要 macOS）
```

## 📁 项目结构

```
frontend/
  src/
    api/          # API 客户端和接口调用
    components/   # 可复用的 UI 组件
    screens/      # 页面组件
    hooks/        # 自定义 React Hooks
    store/        # 全局状态管理（如需要）
    types/        # TypeScript 类型定义
    utils/        # 工具函数
    constants/    # 常量配置
  App.tsx         # 应用入口
  app.json        # Expo 配置
  tailwind.config.js  # Tailwind CSS 配置
```

## 🛠️ 技术栈

- **Expo**: 跨平台开发框架
- **React Native**: UI 框架
- **TypeScript**: 类型安全
- **NativeWind**: Tailwind CSS for React Native
- **React Navigation**: 路由导航
- **TanStack Query**: 数据请求和缓存
- **React Hook Form + Zod**: 表单验证
- **Axios**: HTTP 客户端
- **AsyncStorage**: 本地数据存储

## 🔧 配置

API 地址配置在 `src/constants/config.ts`：
- **开发环境**: `http://localhost:8000/api/v1`
- **生产环境**: `https://api.yourapp.com/api/v1`

## 📝 开发指南

### 使用 NativeWind (Tailwind CSS)

```tsx
import { View, Text } from 'react-native';

function MyComponent() {
  return (
    <View className="flex-1 bg-white p-4">
      <Text className="text-xl font-bold text-primary-600">
        Hello World
      </Text>
    </View>
  );
}
```

### API 调用示例

```tsx
import { useQuery } from '@tanstack/react-query';
import { QUERY_KEYS } from '@/constants/config';

function useTransactions() {
  return useQuery({
    queryKey: [QUERY_KEYS.TRANSACTIONS],
    queryFn: async () => {
      const response = await fetch('/api/v1/transactions');
      return response.json();
    },
  });
}
```

## 🚢 部署

### 构建 Web 版本
```bash
npx expo export:web
```
生成的文件在 `web-build/` 目录，可上传到 S3 + CloudFront。

### 构建 Android APK
```bash
npx eas build --platform android
```

## 📚 相关文档

- [Expo 官方文档](https://docs.expo.dev/)
- [React Native 文档](https://reactnative.dev/)
- [NativeWind 文档](https://www.nativewind.dev/)
- [React Navigation 文档](https://reactnavigation.org/)
- [TanStack Query 文档](https://tanstack.com/query/latest)

