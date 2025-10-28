import React, { createContext, useState, useContext, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '@/constants/config';
import { setAuthToken, clearAuthToken } from '@/api/client';
import * as authApi from '@/api/auth';
import type { User, LoginRequest, RegisterRequest } from '@/types/api';

/**
 * Authentication Context Type
 */
interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (credentials: LoginRequest) => Promise<void>;
  register: (data: RegisterRequest) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

/**
 * Create Auth Context
 */
const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * Auth Provider Component
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  /**
   * Initialize: Load user from storage and validate token
   */
  useEffect(() => {
    loadUser();
  }, []);

  /**
   * Load user from AsyncStorage and validate token
   */
  const loadUser = async () => {
    try {
      setIsLoading(true);
      const token = await AsyncStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
      
      if (token) {
        // Token exists, fetch current user
        const userData = await authApi.getCurrentUser();
        setUser(userData);
        
        // Save to storage
        await AsyncStorage.setItem(STORAGE_KEYS.USER_DATA, JSON.stringify(userData));
      }
    } catch (error) {
      console.error('Failed to load user:', error);
      // Clear invalid token
      await clearAuthToken();
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Login with email and password
   */
  const login = async (credentials: LoginRequest) => {
    try {
      setIsLoading(true);
      
      // Call login API
      const authResponse = await authApi.login(credentials);
      
      // Save token
      await setAuthToken(authResponse.access_token);
      
      // Fetch user data
      const userData = await authApi.getCurrentUser();
      setUser(userData);
      
      // Save to storage
      await AsyncStorage.setItem(STORAGE_KEYS.USER_DATA, JSON.stringify(userData));
    } catch (error) {
      console.error('Login failed:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Register new user
   */
  const register = async (data: RegisterRequest) => {
    try {
      setIsLoading(true);
      
      // Call register API
      const authResponse = await authApi.register(data);
      
      // Save token
      await setAuthToken(authResponse.access_token);
      
      // Fetch user data
      const userData = await authApi.getCurrentUser();
      setUser(userData);
      
      // Save to storage
      await AsyncStorage.setItem(STORAGE_KEYS.USER_DATA, JSON.stringify(userData));
    } catch (error) {
      console.error('Registration failed:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Logout: Clear token and user data
   */
  const logout = async () => {
    try {
      setIsLoading(true);
      await clearAuthToken();
      setUser(null);
    } catch (error) {
      console.error('Logout failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Refresh user data
   */
  const refreshUser = async () => {
    try {
      const userData = await authApi.getCurrentUser();
      setUser(userData);
      await AsyncStorage.setItem(STORAGE_KEYS.USER_DATA, JSON.stringify(userData));
    } catch (error) {
      console.error('Failed to refresh user:', error);
      throw error;
    }
  };

  const value: AuthContextType = {
    user,
    isLoading,
    isAuthenticated: !!user,
    login,
    register,
    logout,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Custom hook to use Auth Context
 */
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

