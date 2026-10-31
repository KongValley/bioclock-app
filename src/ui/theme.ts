import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react'
import { useColorScheme } from 'react-native'

/**
 * BioClock 主题。
 * 医疗感但克制：只有一个主色，语义色仅用于状态提示，其余走中性灰阶。
 */

export interface ThemeColors {
  primary: string
  primaryMuted: string
  onPrimary: string
  background: string
  surface: string
  surfaceMuted: string
  border: string
  text: string
  textSecondary: string
  textTertiary: string
  success: string
  successMuted: string
  warning: string
  warningMuted: string
  danger: string
  dangerMuted: string
  overlay: string
}

export interface Theme {
  name: 'light' | 'dark'
  isDark: boolean
  colors: ThemeColors
  spacing: {
    xs: number
    sm: number
    md: number
    lg: number
    xl: number
    xxl: number
  }
  radius: {
    sm: number
    md: number
    lg: number
    xl: number
    pill: number
  }
  fontSize: {
    xs: number
    sm: number
    md: number
    lg: number
    xl: number
    xxl: number
    display: number
  }
  lineHeight: {
    xs: number
    sm: number
    md: number
    lg: number
    xl: number
    xxl: number
    display: number
  }
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  pill: 999,
} as const

export const fontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 26,
  display: 34,
} as const

export const lineHeight = {
  xs: 16,
  sm: 19,
  md: 22,
  lg: 24,
  xl: 28,
  xxl: 34,
  display: 42,
} as const

const shared = { spacing, radius, fontSize, lineHeight }

export const lightTheme: Theme = {
  name: 'light',
  isDark: false,
  ...shared,
  colors: {
    primary: '#2B6CB0',
    primaryMuted: '#E6EFF8',
    onPrimary: '#FFFFFF',
    background: '#F7F9FB',
    surface: '#FFFFFF',
    surfaceMuted: '#EEF2F6',
    border: '#DFE5EC',
    text: '#1A202C',
    textSecondary: '#4A5568',
    textTertiary: '#7A8797',
    success: '#2F855A',
    successMuted: '#E6F4EC',
    warning: '#B7791F',
    warningMuted: '#FBF1DF',
    danger: '#C53030',
    dangerMuted: '#FBEAEA',
    overlay: 'rgba(15, 20, 25, 0.45)',
  },
}

export const darkTheme: Theme = {
  name: 'dark',
  isDark: true,
  ...shared,
  colors: {
    primary: '#6AA9DE',
    primaryMuted: '#1B2A3A',
    onPrimary: '#0B1520',
    background: '#0F1419',
    surface: '#171E26',
    surfaceMuted: '#1F2933',
    border: '#2D3748',
    text: '#F0F4F8',
    textSecondary: '#A8B3C1',
    textTertiary: '#7A8797',
    success: '#68D391',
    successMuted: '#17301F',
    warning: '#F6C177',
    warningMuted: '#332512',
    danger: '#FC8181',
    dangerMuted: '#3A1A1A',
    overlay: 'rgba(0, 0, 0, 0.6)',
  },
}

const ThemeContext = createContext<Theme>(lightTheme)

export interface ThemeProviderProps {
  children: ReactNode
  /** 显式指定主题；不传时跟随系统深浅色。 */
  theme?: Theme
}

export function ThemeProvider({ children, theme }: ThemeProviderProps) {
  const scheme = useColorScheme()
  const value = useMemo(
    () => theme ?? (scheme === 'dark' ? darkTheme : lightTheme),
    [theme, scheme],
  )
  return createElement(ThemeContext.Provider, { value }, children)
}

export function useTheme(): Theme {
  return useContext(ThemeContext)
}
