import { Tabs } from 'expo-router';
import { Camera, ListChecks, Map } from 'lucide-react-native';

import { colors } from '@/theme/tokens';

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
      <Tabs.Screen
        name="index"
        options={{
          title: 'Report',
          tabBarIcon: ({ color, size }) => <Camera color={color} size={size} strokeWidth={2} />,
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          title: 'My reports',
          tabBarIcon: ({ color, size }) => <ListChecks color={color} size={size} strokeWidth={2} />,
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: 'Map',
          tabBarIcon: ({ color, size }) => <Map color={color} size={size} strokeWidth={2} />,
        }}
      />
    </Tabs>
  );
}
