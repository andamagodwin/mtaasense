import { Text, TouchableOpacity, TouchableOpacityProps } from 'react-native';

interface ButtonProps extends TouchableOpacityProps {
  title: string;
}

// React 19 passes `ref` as an ordinary prop, so it reaches TouchableOpacity through the spread.
export function Button({ title, className, ...touchableProps }: ButtonProps) {
  return (
    <TouchableOpacity {...touchableProps} className={`${styles.button} ${className ?? ''}`}>
      <Text className={styles.buttonText}>{title}</Text>
    </TouchableOpacity>
  );
}

const styles = {
  button: 'items-center bg-indigo-500 rounded-[28px] shadow-md p-4',
  buttonText: 'text-white text-lg font-semibold text-center',
};
