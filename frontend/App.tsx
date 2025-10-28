import { StatusBar } from 'expo-status-bar';
import { Text, View } from 'react-native';

export default function App() {
  return (
    <View className="flex-1 bg-white items-center justify-center p-4">
      <View className="bg-primary-500 p-6 rounded-lg shadow-lg">
        <Text className="text-white text-2xl font-bold text-center mb-2">
          🎉 Wallet App
        </Text>
        <Text className="text-white text-base text-center">
          Frontend environment is ready!
        </Text>
        <Text className="text-white text-sm text-center mt-2 opacity-80">
          NativeWind + Expo + TypeScript ✅
        </Text>
      </View>
      <StatusBar style="auto" />
    </View>
  );
}
