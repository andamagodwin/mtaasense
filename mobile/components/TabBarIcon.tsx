import FontAwesome from '@expo/vector-icons/FontAwesome';
import { ColorValue, StyleSheet } from 'react-native';

export const TabBarIcon = ({
  color,
  ...props
}: {
  name: React.ComponentProps<typeof FontAwesome>['name'];
  color: ColorValue;
}) => {
  // The tab bar passes the tint strings we configure; ColorValue also allows null and pre-processed numbers, which
  // the icon font can't take.
  const iconColor = color === null || typeof color === 'number' ? undefined : color;
  return <FontAwesome size={28} style={styles.tabBarIcon} color={iconColor} {...props} />;
};

export const styles = StyleSheet.create({
  tabBarIcon: {
    marginBottom: -3,
  },
});
