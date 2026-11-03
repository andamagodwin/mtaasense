import { Link, Stack } from 'expo-router';
import { View } from 'react-native';

import { Text } from '@/components/ui/Text';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Not found' }} />
      <View className="flex-1 items-center justify-center gap-4 p-6">
        <Text className="font-bold text-[18px]">This screen doesn’t exist.</Text>
        <Link href="/">
          <Text className="font-semibold text-accent">Go to Report</Text>
        </Link>
      </View>
    </>
  );
}
