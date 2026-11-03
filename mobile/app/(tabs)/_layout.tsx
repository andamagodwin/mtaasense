import { Tabs } from 'expo-router';
import { Camera, type Icon, Map1, TaskSquare } from 'iconsax-react-nativejs';
import type { ColorValue } from 'react-native';

import { colors } from '@/theme/tokens';

// A tab's icon fills in while it is active. The tint colours set below are plain strings.
function tabIcon(TabIcon: Icon) {
  return function TabBarIcon(props: { color: ColorValue; size: number; focused: boolean }) {
    return (
      <TabIcon
        color={props.color as string}
        size={props.size}
        variant={props.focused ? 'Bold' : 'Linear'}
      />
    );
  };
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent.DEFAULT,
        tabBarInactiveTintColor: colors.ink[3],
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line },
        tabBarLabelStyle: { fontFamily: 'Manrope_600SemiBold', fontSize: 11 },
        sceneStyle: { backgroundColor: colors.paper },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Report', tabBarIcon: tabIcon(Camera) }} />
      <Tabs.Screen
        name="reports"
        options={{ title: 'My reports', tabBarIcon: tabIcon(TaskSquare) }}
      />
      <Tabs.Screen name="map" options={{ title: 'Map', tabBarIcon: tabIcon(Map1) }} />
    </Tabs>
  );
}
