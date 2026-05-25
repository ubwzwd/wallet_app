import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LoginScreen } from '@/screens/LoginScreen';
import { RegisterScreen } from '@/screens/RegisterScreen';
import { HomeScreen } from '@/screens/HomeScreen';
import { useAuth } from '@/store/AuthContext';

/**
 * Simple navigation component
 * Shows Login/Register screens when not authenticated
 * Shows Home screen when authenticated
 */
export function Navigation() {
  const { isAuthenticated } = useAuth();
  const [activeScreen, setActiveScreen] = useState<'login' | 'register'>('login');

  if (isAuthenticated) {
    return <HomeScreen />;
  }

  return (
    <View style={styles.container}>
      {/* Tab Navigation */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, activeScreen === 'login' && styles.activeTab]}
          onPress={() => setActiveScreen('login')}
        >
          <Text style={[styles.tabText, activeScreen === 'login' && styles.activeTabText]}>
            Login
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeScreen === 'register' && styles.activeTab]}
          onPress={() => setActiveScreen('register')}
        >
          <Text style={[styles.tabText, activeScreen === 'register' && styles.activeTabText]}>
            Register
          </Text>
        </TouchableOpacity>
      </View>

      {/* Screen Content */}
      <View style={styles.content}>
        {activeScreen === 'login' ? <LoginScreen /> : <RegisterScreen />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  tabs: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  tab: {
    flex: 1,
    paddingVertical: 16,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    minHeight: 44,
    justifyContent: 'center',
  },
  activeTab: {
    borderBottomColor: '#0ea5e9',
  },
  tabText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#6b7280',
  },
  activeTabText: {
    color: '#0ea5e9',
  },
  content: {
    flex: 1,
  },
});

