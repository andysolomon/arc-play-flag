import * as React from 'react';
export interface TextInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Small centred variant for the 3-letter player tag. */
  compact?: boolean;
}
export function TextInput(props: TextInputProps): JSX.Element;
